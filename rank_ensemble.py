"""Frozen 20/120-session rank ensemble. No training or network access.

Scores are relative to the SAME valid stock universe on one completed session.
Never interpret their sign or magnitude as a return or probability.
"""
from pathlib import Path
import hashlib
import json

import numpy as np
import pandas as pd
import torch

from features import FEATURE_COLS, _compute_indicators
from rank_model import TemporalRankTransformer

DEFAULT_MANIFEST = Path(__file__).parent / "models/final_rank_ensemble/manifest.json"
FORMAT = "plain-transformer-rank-ensemble-v1"
HISTORY_START = pd.Timestamp("2019-06-03")
MARKET_COLS = [f"{s}_{f}" for s in ("KPI200", "KOSPI")
               for f in ("r1", "r5", "r20", "vol20", "vrel20")]


def rank_zscore(values):
    values = np.asarray(values, dtype=np.float64)
    if values.ndim != 1 or not len(values) or not np.isfinite(values).all():
        raise ValueError("Ranks require a finite, nonempty complete cross-section")
    ranks = pd.Series(values).rank(method="average").to_numpy()
    std = ranks.std(ddof=0)
    return (ranks - ranks.mean()) / std if std > 1e-12 else np.zeros_like(ranks)


def _frame(frame, cutoff):
    if not isinstance(frame.index, pd.DatetimeIndex) or frame.index.has_duplicates or frame.index.tz is not None:
        raise ValueError("Expected unique timezone-naive daily DatetimeIndex")
    if not frame.index.equals(frame.index.normalize()):
        raise ValueError("Intraday timestamps are not daily completed bars")
    return frame.sort_index().loc[HISTORY_START:cutoff].copy()


def market_features(market_frames, as_of):
    if as_of is None or pd.isna(pd.Timestamp(as_of)):
        raise ValueError("Explicit completed-session as_of is required")
    if market_frames is None or set(market_frames) != {"KPI200", "KOSPI"}:
        raise ValueError("Both KPI200 and KOSPI daily Close/Volume histories are required")
    frames = {k: _frame(v, pd.Timestamp(as_of)) for k, v in market_frames.items()}
    calendar = frames["KPI200"].index
    if len(calendar) < 140 or not calendar.equals(frames["KOSPI"].index):
        raise ValueError("Market histories need a common calendar and 140+ sessions")
    out = pd.DataFrame(index=calendar)
    for symbol in ("KPI200", "KOSPI"):
        d = frames[symbol]
        close = d.Close.where(d.Close > 0)
        r1 = close / close.shift(1) - 1
        for h in (1, 5, 20):
            out[f"{symbol}_r{h}"] = close / close.shift(h) - 1
        out[f"{symbol}_vol20"] = r1.rolling(20).std(ddof=0)
        out[f"{symbol}_vrel20"] = d.Volume / d.Volume.rolling(20).mean().replace(0, np.nan) - 1
    if not np.isfinite(out.iloc[-1]).all():
        raise ValueError("Market features are incomplete on the signal date")
    return out[MARKET_COLS]


def prepare_inputs(ticker_dfs, market_frames, as_of):
    """Cut off before indicators; align all stocks to the index calendar, no fill."""
    context = market_features(market_frames, as_of)
    calendar, cutoff = context.index, context.index[-1]
    windows, tickers, errors = [], [], {}
    for ticker in sorted(ticker_dfs):
        try:
            d = _frame(ticker_dfs[ticker], cutoff).reindex(calendar)
            if "Ticker" in d and d.Ticker.dropna().nunique() > 1:
                raise ValueError("One ticker per frame required")
            bad = (d[["Open", "Close"]].max(axis=1) - d.High > 1) | (d.Low - d[["Open", "Close"]].min(axis=1) > 1)
            d.loc[bad, ["Open", "High", "Low", "Close"]] = np.nan
            if not (d.iloc[-1][["Open", "Close", "Volume"]] > 0).all():
                raise ValueError("No tradable bar on the common signal date")
            features = _compute_indicators(d)[FEATURE_COLS].to_numpy(dtype=np.float32)[-120:]
            if features.shape != (120, 11) or not np.isfinite(features).all():
                raise ValueError("Need 120 consecutive valid feature sessions after warmup")
            windows.append(features)
            tickers.append(ticker)
            errors[ticker] = ""
        except (ValueError, KeyError, TypeError) as exc:
            errors[ticker] = f"{type(exc).__name__}: {exc}"
    if not windows:
        raise ValueError("No stock has a valid 120-session window")
    return tickers, np.stack(windows), context.iloc[-1].to_numpy(), errors


class RankEnsemble:
    def __init__(self, manifest_path=DEFAULT_MANIFEST, device="cpu"):
        path = Path(manifest_path).resolve()
        self.manifest = m = json.loads(path.read_text(encoding="utf-8"))
        if (m["format"] != FORMAT or m["features"] != FEATURE_COLS or m["market_features"] != MARKET_COLS
                or m["lookbacks"] != [20, 120] or m["seeds"] != [42, 43, 44]
                or m["weights"] != [.5, .5] or m["score_kind"] != "rank_zscore"
                or m["minimum_universe"] != 30 or m["history_start"] != "2019-06-03"):
            raise ValueError("Unsupported frozen rank ensemble contract")
        def verified(entry):
            p = (path.parent / entry["file"]).resolve()
            if not p.is_relative_to(path.parent) or hashlib.sha256(p.read_bytes()).hexdigest() != entry["sha256"]:
                raise ValueError(f"Invalid asset or SHA256: {entry['file']}")
            return p
        with np.load(verified(m["scaler"]), allow_pickle=False) as s:
            self.scaler = {k: s[k].copy() for k in ("feature_mean", "feature_std", "market_mean", "market_std")}
        for prefix, count in (("feature", 11), ("market", 10)):
            for suffix in ("mean", "std"):
                a = self.scaler[f"{prefix}_{suffix}"]
                if a.shape != (count,) or not np.isfinite(a).all() or (suffix == "std" and (a <= 0).any()):
                    raise ValueError("Invalid frozen scaler")
        keys = [(e["lookback"], e["seed"]) for e in m["models"]]
        if sorted(keys) != [(w, s) for w in (20, 120) for s in (42, 43, 44)]:
            raise ValueError("Exactly six distinct frozen models are required")
        self.device = torch.device(device)
        self.models = []
        for entry in sorted(m["models"], key=lambda e: (e["lookback"], e["seed"])):
            model = TemporalRankTransformer().to(self.device)
            model.load_state_dict(torch.load(verified(entry), map_location=self.device, weights_only=True), strict=True)
            self.models.append((entry["lookback"], model.eval()))

    def predict_windows(self, windows, market, batch_size=128, return_raw=False):
        x = np.asarray(windows, dtype=np.float32)
        market = np.asarray(market, dtype=np.float64)
        if x.ndim != 3 or x.shape[1:] != (120, 11) or len(x) < 30 or market.shape != (10,):
            raise ValueError("Need a complete universe of 30+ stocks, shape [N,120,11], and market [10]")
        if not np.isfinite(x).all() or not np.isfinite(market).all() or batch_size < 1:
            raise ValueError("Non-finite input or invalid batch size")
        s = self.scaler
        x = ((x - s["feature_mean"]) / s["feature_std"]).astype(np.float32)
        market = ((market - s["market_mean"]) / s["market_std"]).astype(np.float32)
        context = torch.from_numpy(market[None]).to(self.device)
        raw = []
        # Match the sealed research inference path; restore the caller's global setting.
        fastpath = torch.backends.mha.get_fastpath_enabled()
        try:
            torch.backends.mha.set_fastpath_enabled(False)
            with torch.inference_mode():
                for lookback, model in self.models:
                    chunks = []
                    for start in range(0, len(x), batch_size):
                        stock = torch.from_numpy(x[start:start+batch_size, -lookback:][None]).to(self.device)
                        valid = torch.ones(stock.shape[:2], dtype=torch.bool, device=self.device)
                        chunks.append(model(stock, context, valid)["return_z"][0].cpu().numpy())
                    raw.append(np.concatenate(chunks))
        finally:
            torch.backends.mha.set_fastpath_enabled(fastpath)
        raw = np.stack(raw)
        # Rank AFTER concatenation: chunking must not change the comparison universe.
        scores = np.stack([rank_zscore(row) for row in raw]).mean(axis=0)
        return (scores, raw) if return_raw else scores

    def predict(self, ticker_dfs, market_frames, as_of):
        tickers, windows, market, errors = prepare_inputs(ticker_dfs, market_frames, as_of)
        scores = self.predict_windows(windows, market)
        result = {t: float("nan") for t in ticker_dfs}
        result.update(zip(tickers, map(float, scores)))
        result = dict(sorted(result.items(), key=lambda p: (-p[1] if np.isfinite(p[1]) else float("inf"), p[0])))
        return result, errors

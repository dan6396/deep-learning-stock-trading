# -*- coding: utf-8 -*-
"""Frozen 20/120-session relative ranking; explicit old manifests/.pt supported.

Rank mode: predict_multiple(manifest, full_universe, market_frames=..., as_of=...).
Requires both KPI200 and KOSPI context. No target inversion or percent output.
Legacy predict_next_return remains available only for return/classification assets.
See README.md for complete CLI examples and required input history.
"""

import argparse
import sys
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).parent))

from data import _compute_indicators, FEATURE_COLS, SEQ_LEN, FeatureScaler, N_FEATURES
from model import StockTransformer
from ensemble import HuberEnsemble
from rank_ensemble import DEFAULT_MANIFEST, RankEnsemble, is_rank_manifest


def _load_inference_bundle(
    ckpt_path: str,
    device_str: str = "cpu",
) -> dict[str, Any]:
    """Load checkpoint/model/scaler once for one inference batch."""
    device = torch.device(device_str)
    if is_rank_manifest(ckpt_path):
        return {"device": device, "rank_ensemble": RankEnsemble(ckpt_path, device_str), "task": "rank"}
    if Path(ckpt_path).suffix.lower() == ".json":
        return {"device": device, "ensemble": HuberEnsemble(ckpt_path, device_str), "task": "regression"}
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    sa = ckpt.get("args", {})

    model = StockTransformer(
        n_features=N_FEATURES,
        d_model=sa.get("d_model", 64),
        nhead=sa.get("nhead", 4),
        num_layers=sa.get("num_layers", 2),
        dim_feedforward=sa.get("dim_feedforward", 128),
        dropout=0.0,
        time2vec_dim=sa.get("time2vec_dim", 4),
        conv_kernel=sa.get("conv_kernel", 3),
    ).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    scaler = FeatureScaler()
    scaler.load_state_dict(ckpt["scaler"])

    return {
        "device": device,
        "model": model,
        "scaler": scaler,
        "task": sa.get("task", "regression"),
    }


def _build_window(df_ohlcv: pd.DataFrame) -> np.ndarray:
    """
    OHLCV DataFrame -> most-recent SEQ_LEN x 11 feature window, shape (20, 11).
    Raises ValueError if data is insufficient or contains NaN/inf.
    """
    df = df_ohlcv.copy()
    if not isinstance(df.index, pd.DatetimeIndex) or df.index.has_duplicates:
        raise ValueError("Expected unique daily DatetimeIndex for one ticker")
    if "Ticker" in df and df["Ticker"].nunique() > 1:
        raise ValueError("Provide only one ticker per DataFrame")
    if "Ticker" in df.columns:
        df = df.drop(columns=["Ticker"])

    df = _compute_indicators(df)
    feat = df[FEATURE_COLS].values[-SEQ_LEN:]

    if len(feat) < SEQ_LEN:
        raise ValueError(f"Insufficient data: need {SEQ_LEN} rows, got {len(feat)}. "
                         "Provide 60+ rows for reliable indicator warmup.")
    if not np.isfinite(feat).all():
        n_bad = (~np.isfinite(feat)).sum()
        raise ValueError(
            f"{n_bad} NaN/inf values in the last {SEQ_LEN}-day window. "
            "Possible cause: OHLC=0 on trading-halt days. Provide more history."
        )
    return feat.astype(np.float32)


def predict_next_return(
    ckpt_path:  str,
    df_ohlcv:   pd.DataFrame,
    device_str: str = "cpu",
) -> float:
    """
    Returns:
        regression     : predicted next-day return as a decimal (e.g. 0.012 = +1.2%)
        classification : P(up) as a decimal (e.g. 0.621 = 62.1% probability)
    """
    bundle = _load_inference_bundle(ckpt_path, device_str)
    return _predict_with_bundle(bundle, df_ohlcv)


def _predict_with_bundle(bundle: dict[str, Any], df_ohlcv: pd.DataFrame) -> float:
    """Run inference using an already-loaded model bundle."""
    device = bundle["device"]
    if "rank_ensemble" in bundle:
        raise ValueError("Rank scores require predict_multiple with the complete universe and market_frames")
    if "ensemble" in bundle:
        return float(bundle["ensemble"].predict_windows(_build_window(df_ohlcv)[None])[0])
    model = bundle["model"]
    scaler = bundle["scaler"]
    task = bundle["task"]

    window = _build_window(df_ohlcv)
    window = scaler.transform(window[np.newaxis])[0]
    x = torch.from_numpy(window).unsqueeze(0).to(device)

    with torch.no_grad():
        raw = model(x).item()

    if task == "classification":
        return float(torch.sigmoid(torch.tensor(raw)).item())  # P(up)
    return raw  # predicted return


def predict_multiple(
    ckpt_path:  str,
    ticker_dfs: dict,
    device_str: str = "cpu",
    return_errors: bool = False,
    *, market_frames: dict | None = None, as_of=None,
) -> dict | tuple[dict, dict]:
    """
    Load the checkpoint once, then run inference for each ticker.

    Returns dict sorted by score descending (relative preference for rank models).
    For regression: score = predicted return.
    For classification: score = P(up).

    If return_errors=True, returns (results, errors). The default call signature
    remains compatible with predict_multiple(ckpt_path, ticker_dfs).
    """
    results = {}
    errors = {}
    bundle = _load_inference_bundle(ckpt_path, device_str)
    if "rank_ensemble" in bundle:
        if as_of is None:
            raise ValueError("Explicit completed-session as_of is required for rank inference")
        results, errors = bundle["rank_ensemble"].predict(ticker_dfs, market_frames, as_of)
        return (results, errors) if return_errors else results
    if "ensemble" in bundle:
        windows, valid_tickers = [], []
        for ticker, df in ticker_dfs.items():
            try:
                windows.append(_build_window(df))
                valid_tickers.append(ticker)
                errors[ticker] = ""
            except (ValueError, KeyError, TypeError) as exc:
                results[ticker] = float("nan")
                errors[ticker] = f"{type(exc).__name__}: {exc}"
        if windows:
            scores = bundle["ensemble"].predict_windows(np.stack(windows))
            results.update(zip(valid_tickers, map(float, scores)))
        results = dict(sorted(results.items(), key=lambda item: (
            -item[1] if np.isfinite(item[1]) else float("inf"), str(item[0]))))
        return (results, errors) if return_errors else results
    for ticker, df in ticker_dfs.items():
        try:
            results[ticker] = _predict_with_bundle(bundle, df)
            errors[ticker] = ""
        except Exception as e:
            print(f"  [{ticker}] prediction failed: {e}")
            results[ticker] = float("nan")
            errors[ticker] = f"{type(e).__name__}: {e}"

    sorted_results = dict(
        sorted(
            results.items(),
            key=lambda x: (pd.notna(x[1]), x[1] if pd.notna(x[1]) else float("-inf")),
            reverse=True,
        )
    )
    if return_errors:
        return sorted_results, errors
    return sorted_results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Frozen 20/120-session Transformer relative ranking")
    p.add_argument("--kpi200", help="KOSPI200 index OHLCV parquet, required for rank model")
    p.add_argument("--kospi", help="KOSPI index OHLCV parquet, required for rank model")
    p.add_argument("--ckpt", default=str(DEFAULT_MANIFEST))
    p.add_argument("--data",   required=True)
    p.add_argument("--ticker", default=None)
    p.add_argument("--device", default="cpu")
    p.add_argument("--as-of", help="Use only observations on/before this closed session (YYYY-MM-DD)")
    args = p.parse_args()

    df = pd.read_parquet(args.data)
    if "Date" in df.columns:
        df = df.set_index("Date")
    if args.as_of:
        df = df.loc[df.index <= pd.Timestamp(args.as_of)]
    if is_rank_manifest(args.ckpt):
        if not (args.as_of and args.kpi200 and args.kospi and "Ticker" in df):
            p.error("Rank inference requires --as-of, --kpi200, --kospi and multi-ticker OHLCV")
        frames = {str(t).zfill(6): g for t, g in df.groupby("Ticker")}
        scores, errors = predict_multiple(args.ckpt, frames, args.device, True,
            market_frames={"KPI200": pd.read_parquet(args.kpi200), "KOSPI": pd.read_parquet(args.kospi)}, as_of=args.as_of)
        for ticker, score in scores.items():
            if args.ticker is None or ticker == args.ticker:
                print(f"{ticker}: rank_score={score:.6f} {errors.get(ticker, '')}")
        print("Relative rank score within this universe; not a return or probability.")
        return
    if "Ticker" in df.columns:
        tickers = df["Ticker"].unique()
        ticker  = args.ticker if args.ticker else tickers[0]
        if ticker not in tickers:
            print(f"Ticker {ticker} not found. Available: {tickers[:5].tolist()}")
            sys.exit(1)
        if not args.ticker:
            print(f"No ticker specified, using first: {ticker}")
        df = df[df["Ticker"] == ticker]

    # Detect task from checkpoint
    bundle = _load_inference_bundle(args.ckpt, args.device)
    task = bundle["task"]

    score = _predict_with_bundle(bundle, df)

    if task == "classification":
        print(f"\nP(up) = {score*100:.2f}%  (logit={float(torch.logit(torch.tensor(score))):.4f})")
    else:
        sign = "+" if score >= 0 else ""
        target = "next-session open-to-close" if "ensemble" in bundle else "legacy next-day"
        print(f"\nPredicted {target} return: {sign}{score*100:.2f}%  ({score:.6f}); not P(up)")


if __name__ == "__main__":
    main()

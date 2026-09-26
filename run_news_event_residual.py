"""Chronological event-residual replay on the three previously inspected regimes.

Research only: archived news bodies are not verified point-in-time snapshots.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

from news_fusion.guarded import select_top5
from portfolio_replay import simulate
from run_news_walkforward import BARS, NEWS_COLUMNS, SOURCE, feature_panel


OUT = Path("outputs/news_event_residual_v1")
NEWS_SOURCE = Path("outputs/news_regimes_calendar3_bounded")
ALPHA = 1.0
MAX_DELTA = 0.003
WARMUP_DAYS = 5
VALIDATION_DAYS = 5
MIN_VALIDATION_GAIN = 0.005
REPLACEMENT_HURDLE = 0.0025


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def prepare():
    panel = pd.read_parquet(SOURCE / "scored_panel.parquet")
    bars = pd.read_parquet(BARS)
    bars["ticker"] = bars.ticker.astype(str).str.zfill(6)
    requests = {(r["entry_date"], r["ticker"], r["parent_article_id"])
                for r in read(NEWS_SOURCE / "article_requests.json")}
    body_parents = {a["article_id"]: a["parent_article_id"]
                    for a in read(NEWS_SOURCE / "body_articles.json")}
    accepted = 0
    for row in panel.itertuples():
        for event in json.loads(row.audited_evidence):
            if event["gate"] != "accepted":
                continue
            key = (str(row.entry_date.date()), row.ticker, body_parents.get(event["article_id"]))
            if key not in requests:
                raise ValueError("Accepted article was not requested for this stock and decision date")
            accepted += 1
    if accepted != int(panel.accepted_articles.sum()):
        raise ValueError("Accepted article count mismatch")
    frame = feature_panel(panel, bars)
    if frame.entry_date.nunique() != 30 or len(frame) != 5992:
        raise ValueError("Unexpected fixed-regime universe")
    frame["residual"] = frame.target - frame.price_centered
    frame["event_presence"] = frame[NEWS_COLUMNS].gt(0).any(axis=1).astype(float)
    frame["price_context"] = frame.groupby("entry_date").huber_ensemble.rank(pct=True) - .5
    frame["presence_context"] = frame.event_presence * frame.price_context
    for name in NEWS_COLUMNS:
        frame[f"context_{name}"] = frame[name] * frame.price_context
    return frame, bars


def correction(frame, train_idx, test_idx, columns):
    model = Ridge(alpha=ALPHA, fit_intercept=False)
    model.fit(frame.iloc[train_idx][columns].to_numpy(float),
              frame.iloc[train_idx].residual.to_numpy(float))
    return np.clip(model.predict(frame.iloc[test_idx][columns].to_numpy(float)),
                   -MAX_DELTA, MAX_DELTA)


def mean_ic(group, score):
    x = group[["entry_date", "actual_oc"]].copy()
    x["score"] = np.asarray(score, float)
    return float(x.groupby("entry_date").apply(
        lambda day: day.score.corr(day.actual_oc, method="spearman"),
        include_groups=False).mean())


def forecast(frame):
    events = NEWS_COLUMNS + [f"context_{name}" for name in NEWS_COLUMNS]
    presence = ["event_presence", "presence_context"]
    dates = sorted(frame.entry_date.unique())
    forecasts, history = [], []
    for n, date in enumerate(dates):
        if n < WARMUP_DAYS:
            continue
        train = np.flatnonzero((frame.entry_date < date).to_numpy())
        test = np.flatnonzero((frame.entry_date == date).to_numpy())
        assert frame.iloc[train].entry_date.max() < frame.iloc[test].entry_date.min()
        event_delta = correction(frame, train, test, events)
        presence_delta = correction(frame, train, test, presence)
        enabled, validation = False, {}
        if n >= WARMUP_DAYS + VALIDATION_DAYS:
            valid_dates = dates[n-VALIDATION_DAYS:n]
            fit = np.flatnonzero((frame.entry_date < valid_dates[0]).to_numpy())
            valid = np.flatnonzero(frame.entry_date.isin(valid_dates).to_numpy())
            valid_frame = frame.iloc[valid]
            price = valid_frame.huber_ensemble.to_numpy(float)
            validation = {
                "price_ic": mean_ic(valid_frame, price),
                "event_ic": mean_ic(valid_frame, price + correction(frame, fit, valid, events)),
                "presence_ic": mean_ic(valid_frame, price + correction(frame, fit, valid, presence)),
            }
            enabled = (validation["event_ic"] >= validation["price_ic"] + MIN_VALIDATION_GAIN
                       and validation["event_ic"] >= validation["presence_ic"] + MIN_VALIDATION_GAIN)
        day = frame.iloc[test][["date", "entry_date", "ticker", "actual_oc",
                                "huber_ensemble", "event_presence"]].copy()
        day["price"] = day.huber_ensemble
        day["presence"] = day.price + presence_delta
        day["event_fixed"] = day.price + event_delta
        day["event_gated"] = day.event_fixed if enabled else day.price
        day["event_delta"] = event_delta
        forecasts.append(day)
        history.append({"forecast_date": str(pd.Timestamp(date).date()),
                        "training_last_date": str(pd.Timestamp(dates[n-1]).date()),
                        "training_days": n, "gate_enabled": bool(enabled),
                        "validation": validation,
                        "covered_stock_days": int(day.event_presence.sum())})
    return pd.concat(forecasts, ignore_index=True), history


def evaluate(scores, bars, out):
    protocol = read(SOURCE / "protocol.json")
    results, daily_results = [], []
    for regime, date_list in protocol["selected_entry_dates"].items():
        group = scores[scores.entry_date.dt.strftime("%Y-%m-%d").isin(date_list)].copy()
        expected = 5 if regime == "sideways" else 10
        if group.entry_date.nunique() != expected:
            raise ValueError(f"Expected {expected} scored sessions for {regime}")
        for strategy in ("price", "presence", "event_fixed", "event_gated"):
            for turnover, hurdle in (("top5", 0.0), ("cost_aware", REPLACEMENT_HURDLE)):
                chosen = select_top5(group, strategy, hurdle)
                signal = chosen[["date", "entry_date", "ticker", strategy]].rename(
                    columns={strategy: "huber_ensemble"})
                metrics, daily, orders, _ = simulate(signal, bars, cost=.00125)
                returns = daily.net_pnl / daily.start_equity
                deviation = returns.std(ddof=1)
                metrics.update(regime=regime, strategy=strategy, turnover=turnover,
                               first_session=str(group.entry_date.min().date()),
                               last_session=str(group.entry_date.max().date()),
                               mean_rank_ic=mean_ic(group, group[strategy]),
                               direction_accuracy=float((np.sign(group[strategy]) == np.sign(group.actual_oc)).mean()),
                               selected_news_stock_days=int(chosen.event_presence.sum()),
                               sharpe_annualized=float(returns.mean() / deviation * np.sqrt(252)) if deviation > 0 else np.nan,
                               orders=int(len(orders)))
                results.append(metrics)
                daily["regime"] = regime
                daily["strategy"] = strategy
                daily["turnover"] = turnover
                daily_results.append(daily)
    result = pd.DataFrame(results)
    result.to_csv(out / "metrics.csv", index=False, encoding="utf-8-sig")
    pd.concat(daily_results, ignore_index=True).to_csv(out / "daily.csv", index=False, encoding="utf-8-sig")
    return result


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    frame, bars = prepare()
    scores, history = forecast(frame)
    metrics = evaluate(scores, bars, OUT)
    scores.to_parquet(OUT / "scores.parquet", index=False)
    (OUT / "fit_history.json").write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    protocol = {"version": "event-residual-v1", "alpha": ALPHA, "max_delta": MAX_DELTA,
                "warmup_days": WARMUP_DAYS, "validation_days": VALIDATION_DAYS,
                "min_validation_gain": MIN_VALIDATION_GAIN,
                "replacement_hurdle": REPLACEMENT_HURDLE,
                "source_hashes": {str(p): sha(p) for p in
                                  (SOURCE / "scored_panel.parquet", SOURCE / "protocol.json",
                                   NEWS_SOURCE / "article_requests.json", NEWS_SOURCE / "body_articles.json",
                                   BARS, Path(__file__))},
                "interpretation": "Exploratory previously inspected dates; historical news versions not PIT verified"}
    (OUT / "protocol.json").write_text(json.dumps(protocol, ensure_ascii=False, indent=2), encoding="utf-8")
    print(metrics[["regime", "strategy", "turnover", "days", "mean_rank_ic",
                   "final_equity", "mdd", "total_fees"]].to_string(index=False))


if __name__ == "__main__":
    run()

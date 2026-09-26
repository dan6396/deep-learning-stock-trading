"""Export a text-free local feature/target panel for regime experiments.

Input data must be acquired and stored locally by the user. Generated files go
under outputs/ (ignored by Git); this script never copies source data into Git.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


REGIME_DATES = {
    "sideways": [
        "2026-06-01", "2026-06-02", "2026-06-04", "2026-06-05", "2026-06-08",
        "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-15",
    ],
    "down": [
        "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-06",
        "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-13",
    ],
    "up": [
        "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-03", "2026-08-04",
        "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-10", "2026-08-11",
    ],
}
EVENTS = ("earnings", "contract", "capital_raise", "legal", "dividend", "buyback", "product")
SENTIMENTS = ("positive", "negative")


def parse_accepted_counts(value: object) -> dict[str, int]:
    counts = {f"news_{event}_{sentiment}": 0 for event in EVENTS for sentiment in SENTIMENTS}
    if not isinstance(value, str) or not value:
        return counts
    for item in json.loads(value):
        if item.get("gate") != "accepted":
            continue
        key = f"news_{item.get('event_type')}_{item.get('sentiment')}"
        if key in counts:
            counts[key] += 1
    return counts


def build(panel_path: Path, bars_path: Path, out_dir: Path) -> None:
    panel = pd.read_parquet(panel_path)
    bars = pd.read_parquet(bars_path)
    panel["ticker"] = panel.ticker.astype(str).str.zfill(6)
    bars["ticker"] = bars.ticker.astype(str).str.zfill(6)
    panel["entry_date"] = pd.to_datetime(panel.entry_date).dt.normalize()
    panel["date"] = pd.to_datetime(panel.date).dt.normalize()
    bars["date"] = pd.to_datetime(bars.date).dt.normalize()

    date_to_regime = {
        pd.Timestamp(date): regime
        for regime, dates in REGIME_DATES.items()
        for date in dates
    }
    frame = panel.loc[panel.entry_date.isin(date_to_regime)].copy()
    frame["regime"] = frame.entry_date.map(date_to_regime)
    if len(frame) != 5992:
        raise ValueError(f"Expected 5,992 stock-session rows for the fixed dates; found {len(frame)}")

    counts = pd.DataFrame(frame.audited_evidence.map(parse_accepted_counts).tolist(), index=frame.index)
    frame = pd.concat([frame, counts], axis=1)
    realized = bars[["date", "ticker", "Open", "Close"]].rename(columns={"date": "entry_date"})
    frame = frame.merge(realized, on=["entry_date", "ticker"], how="left", validate="one_to_one")
    if frame[["Open", "Close"]].isna().any().any() or (frame.Open <= 0).any():
        raise ValueError("Missing or invalid next-session OHLC values in local bars")
    frame["realized_open_close_return"] = frame.Close / frame.Open - 1.0

    columns = [
        "date", "entry_date", "ticker", "regime", "huber_ensemble", "price_rank",
        "news_delta", "adjusted_score", "usable_articles", "accepted_articles",
        "news_missing", "realized_open_close_return",
        *[f"news_{event}_{sentiment}" for event in EVENTS for sentiment in SENTIMENTS],
    ]
    out_dir.mkdir(parents=True, exist_ok=True)
    for regime in ("sideways", "down", "up"):
        dest = out_dir / f"{regime}.csv.gz"
        frame.loc[frame.regime == regime, columns].sort_values(
            ["entry_date", "ticker"]
        ).to_csv(dest, index=False, compression="gzip", date_format="%Y-%m-%d")
        print(f"{dest}: {int((frame.regime == regime).sum())} rows")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", type=Path, required=True, help="Local scored_panel.parquet")
    parser.add_argument("--bars", type=Path, required=True, help="Local daily OHLCV parquet")
    parser.add_argument("--out", type=Path, default=Path("outputs/regime_benchmark_data"))
    args = parser.parse_args()
    build(args.panel, args.bars, args.out)


if __name__ == "__main__":
    main()

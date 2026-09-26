"""Join the published derived features to each teammate's authorized local bars.

The result remains under outputs/ and must not be committed or distributed.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd


DEFAULT_FEATURES = Path("research/regime_benchmark/published/numeric_features.csv.gz")
DEFAULT_OUTPUT = Path("outputs/regime_benchmark_data/joined_features.csv.gz")


def join(features_path: Path, bars_path: Path, output_path: Path) -> pd.DataFrame:
    features = pd.read_csv(features_path, dtype={"ticker": str})
    bars = pd.read_parquet(bars_path) if bars_path.suffix == ".parquet" else pd.read_csv(bars_path)
    required = {"date", "ticker", "Open", "Close"}
    if not required.issubset(bars.columns):
        raise ValueError(f"Local bars require columns: {', '.join(sorted(required))}")
    features["ticker"] = features.ticker.str.zfill(6)
    bars["ticker"] = bars.ticker.astype(str).str.zfill(6)
    features["entry_date"] = pd.to_datetime(features.entry_date).dt.normalize()
    bars["entry_date"] = pd.to_datetime(bars.date).dt.normalize()
    prices = bars[["entry_date", "ticker", "Open", "Close"]]
    joined = features.merge(prices, on=["entry_date", "ticker"], how="left", validate="one_to_one")
    if joined[["Open", "Close"]].isna().any().any() or (joined.Open <= 0).any():
        raise ValueError("Missing or invalid local entry-session prices")
    joined["realized_open_close_return"] = joined.Close / joined.Open - 1
    joined = joined.drop(columns=["Open", "Close"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    joined.to_csv(output_path, index=False, compression="gzip", date_format="%Y-%m-%d")
    return joined


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bars", required=True, type=Path, help="Authorized local OHLCV CSV/parquet")
    parser.add_argument("--features", type=Path, default=DEFAULT_FEATURES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    rows = join(args.features, args.bars, args.out)
    print(f"{len(rows)} stock-session rows written to {args.out}")


if __name__ == "__main__":
    main()

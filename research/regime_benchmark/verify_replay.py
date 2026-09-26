"""Verify committed replay files, then reproduce results with authorized prices.

Run from the repository root with ``python -m research.regime_benchmark.verify_replay``.
Pass ``--bars`` for the exact numeric fusion and share-based portfolio replay.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from .freeze_replay_inputs import ROOT, canonical_bars_hash, sha256


FROZEN = ROOT / "research/regime_benchmark/published/frozen_replay"
PUBLISHED = FROZEN.parent
DEFAULT_OUT = ROOT / "outputs/regime_benchmark_exact_replay"


def check_published() -> tuple[dict, pd.DataFrame]:
    manifest = json.loads((FROZEN / "manifest.json").read_text(encoding="utf-8"))
    if manifest["version"] != "text-free-event-replay-v1":
        raise ValueError("Unexpected frozen replay version")
    for name, expected in manifest["frozen_files_sha256"].items():
        actual = sha256(FROZEN / name)
        if actual != expected:
            raise ValueError(f"Published frozen input checksum mismatch: {name}")
    public = json.loads((PUBLISHED / "manifest.json").read_text(encoding="utf-8"))
    for name, expected in public["files_sha256"].items():
        if sha256(PUBLISHED / name) != expected:
            raise ValueError(f"Published result checksum mismatch: {name}")
    panel = pd.read_parquet(FROZEN / "scored_panel.parquet")
    if len(panel) != manifest["panel_rows"] or int(panel.accepted_articles.sum()) != manifest["accepted_events"]:
        raise ValueError("Frozen panel row/event count mismatch")
    if set(panel.columns) != {"date", "entry_date", "ticker", "huber_ensemble",
                              "accepted_articles", "audited_evidence"}:
        raise ValueError("Unexpected column in text-free panel")
    return manifest, panel


def compare_frames(actual: pd.DataFrame, reference: pd.DataFrame,
                   keys: list[str], label: str) -> None:
    if set(actual.columns) != set(reference.columns):
        raise AssertionError(f"{label}: column mismatch")
    for frame in (actual, reference):
        for column in ("date", "entry_date"):
            if column in frame:
                frame[column] = pd.to_datetime(frame[column]).dt.strftime("%Y-%m-%d")
        if "ticker" in frame:
            frame["ticker"] = frame.ticker.astype(str).str.zfill(6)
    columns = sorted(reference.columns)
    left = actual.sort_values(keys).reset_index(drop=True)[columns]
    right = reference.sort_values(keys).reset_index(drop=True)[columns]
    pd.testing.assert_frame_equal(left, right, check_dtype=False, check_exact=False,
                                  rtol=1e-10, atol=1e-6, obj=label)


def replay(bars_path: Path, out: Path) -> None:
    manifest, panel = check_published()
    bars_path = bars_path.resolve()
    bars = pd.read_parquet(bars_path) if bars_path.suffix.lower() == ".parquet" else pd.read_csv(bars_path)
    price_hash, price_rows = canonical_bars_hash(bars, panel)
    if price_rows != manifest["required_price_rows"] or price_hash != manifest["required_prices_canonical_sha256"]:
        raise ValueError("Local bars differ from the frozen 5,992 stock-session prices. "
                         "Check source, adjustments, dates, tickers and Volume; exact results cannot be claimed.")
    out = out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if bars_path.suffix.lower() != ".parquet":
        bars_path = out / "authorized_local_bars.parquet"
        bars.to_parquet(bars_path, index=False)
    import run_news_event_residual as experiment

    experiment.SOURCE = FROZEN
    experiment.NEWS_SOURCE = FROZEN
    experiment.BARS = bars_path
    experiment.OUT = out
    experiment.run()
    compare_frames(pd.read_csv(out / "metrics.csv"), pd.read_csv(PUBLISHED / "metrics.csv"),
                   ["regime", "strategy", "turnover"], "aggregate metrics")
    compare_frames(pd.read_csv(out / "daily.csv"), pd.read_csv(PUBLISHED / "daily_equity.csv"),
                   ["regime", "strategy", "turnover", "date"], "daily portfolio equity")
    score_columns = ["date", "entry_date", "ticker", "price", "presence", "event_fixed",
                     "event_gated", "event_delta", "event_presence"]
    scores = pd.read_parquet(out / "scores.parquet")[score_columns]
    reference = pd.read_csv(PUBLISHED / "model_scores.csv.gz", dtype={"ticker": str})
    compare_frames(scores, reference, ["entry_date", "ticker"], "model scores")
    history = json.loads((out / "fit_history.json").read_text(encoding="utf-8"))
    if len(history) != 25 or any(day["gate_enabled"] for day in history):
        raise AssertionError("Expected 25 evaluation sessions with the news gate disabled")
    print("PASS: 4,992 model scores, 24 strategy/regime metrics, 200 daily equity rows, 25 gate decisions")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bars", type=Path, help="Authorized local daily OHLCV CSV or parquet")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    if args.bars:
        replay(args.bars, args.out)
    else:
        manifest, _ = check_published()
        print(f"PASS: published checksums, {manifest['panel_rows']} frozen stock-session rows, "
              f"{manifest['accepted_events']} extracted event labels")
        print("Supply --bars PATH to replay predictions and the identical portfolio ledger")


if __name__ == "__main__":
    main()

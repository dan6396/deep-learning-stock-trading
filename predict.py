"""Inference for the fixed 20/120-session Transformer rank ensemble."""
import argparse
from pathlib import Path

import pandas as pd

from rank_ensemble import DEFAULT_MANIFEST, RankEnsemble


def _load_inference_bundle(ckpt_path=DEFAULT_MANIFEST, device_str="cpu"):
    """Validate and load the final six-model bundle."""
    return {"rank_ensemble": RankEnsemble(ckpt_path, device_str), "task": "rank"}


def predict_multiple(ckpt_path, ticker_dfs, device_str="cpu", return_errors=False,
                     *, market_frames=None, as_of=None, bundle=None):
    """Rank the whole common-date stock universe; scores are not returns."""
    if as_of is None:
        raise ValueError("Explicit completed-session as_of is required for rank inference")
    bundle = bundle or _load_inference_bundle(ckpt_path, device_str)
    results, errors = bundle["rank_ensemble"].predict(ticker_dfs, market_frames, as_of)
    return (results, errors) if return_errors else results


def _read_frame(path):
    frame = pd.read_parquet(path)
    if "Date" in frame.columns:
        frame = frame.set_index("Date")
    return frame


def main():
    parser = argparse.ArgumentParser(description="20/120-session Transformer relative ranking")
    parser.add_argument("--ckpt", default=str(DEFAULT_MANIFEST), help="Final model manifest")
    parser.add_argument("--data", required=True, help="Whole stock universe OHLCV parquet")
    parser.add_argument("--kpi200", required=True, help="KOSPI200 index history parquet")
    parser.add_argument("--kospi", required=True, help="KOSPI index history parquet")
    parser.add_argument("--as-of", required=True, help="Completed session cutoff YYYY-MM-DD")
    parser.add_argument("--ticker", help="Filter display after ranking the complete universe")
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    frame = _read_frame(args.data)
    if "Ticker" not in frame:
        parser.error("Stock OHLCV needs a Ticker column for the complete universe")
    tickers = {str(t).zfill(6): group for t, group in frame.groupby("Ticker")}
    if args.ticker and args.ticker not in tickers:
        parser.error("Requested ticker is not in the input universe")
    scores, errors = predict_multiple(args.ckpt, tickers, args.device, True,
        market_frames={"KPI200": _read_frame(args.kpi200), "KOSPI": _read_frame(args.kospi)}, as_of=args.as_of)
    for ticker, score in scores.items():
        if not args.ticker or ticker == args.ticker:
            print(f"{ticker}: rank_score={score:.6f} {errors.get(ticker, '')}")
    print("Relative rank within this universe; not a return or probability.")


if __name__ == "__main__":
    main()

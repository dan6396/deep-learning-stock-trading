"""Offline regression test: frozen predictions, Top-5 selections and cash ledger."""
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from ensemble import HuberEnsemble, DEFAULT_MANIFEST
from predict import predict_multiple, _build_window
from portfolio_replay import simulate, self_check

ROOT = Path(__file__).resolve().parent


def main():
    torch.set_num_threads(2)
    fixtures = ROOT / "tests/fixtures/ensemble"
    for name, digest in json.loads((fixtures / "sha256.json").read_text()).items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest, name
    model = HuberEnsemble()
    assert not any(isinstance(m, torch.nn.Conv1d) for n in model.models for m in n.modules())
    x = np.load(fixtures / "windows.npz")["windows"]
    ref = pd.read_parquet(fixtures / "reference.parquet")
    scores = model.predict_windows(x)
    error = float(np.max(np.abs(scores - ref.huber_ensemble.to_numpy())))
    np.testing.assert_allclose(scores, ref.huber_ensemble, rtol=1e-6, atol=1e-7)
    ranked = lambda values: ref.assign(score=values).sort_values(
        ["entry_date", "score", "ticker"], ascending=[True, False, True]
    ).groupby("entry_date").head(5).reset_index(drop=True)
    pd.testing.assert_frame_equal(ranked(scores)[["entry_date", "ticker"]],
                                  ranked(ref.huber_ensemble)[["entry_date", "ticker"]])
    raw = pd.read_parquet(fixtures / "raw_ohlcv.parquet")
    checked = 0
    for day in ["2026-05-29", "2026-07-01", "2026-09-11"]:
        ticker_dfs = {ticker: g.loc[:day] for ticker, g in raw.groupby("Ticker")}
        result, errors = predict_multiple(str(DEFAULT_MANIFEST), ticker_dfs, return_errors=True)
        assert not any(errors.values()), errors
        for ticker, score in result.items():
            hit = ref.index[(ref.date == day) & (ref.ticker == ticker)][0]
            np.testing.assert_array_equal(_build_window(ticker_dfs[ticker]), x[hit])
            np.testing.assert_allclose(score, ref.huber_ensemble.iloc[hit], rtol=1e-6, atol=1e-7)
            checked += 1
    # Invalid windows must not produce a plausible zero or a probability.
    good = raw[raw.Ticker == "005930"]
    bad = good.copy(); bad.iloc[-1, bad.columns.get_loc("Close")] = np.nan
    result, errors = predict_multiple(str(DEFAULT_MANIFEST), {"bad": bad, "short": good.tail(2)}, return_errors=True)
    assert all(np.isnan(v) for v in result.values()) and all(errors.values())
    out = ROOT / "docs/validation"
    expected = json.loads((out / "results.json").read_text())
    bars = pd.read_parquet(out / "daily_bars.parquet")
    self_check()
    for name, metrics in expected["models"].items():
        signals = (ranked(scores).rename(columns={"score": "predicted"}) if name == "huber_ensemble" else
                   pd.read_parquet(out / f"signals_{name}.parquet"))
        if name == "huber_ensemble":
            signals["huber_ensemble"] = signals["predicted"]
        actual = simulate(signals, bars)[0]
        assert actual == metrics, name
        print(f"{name}: final equity KRW {actual['final_equity']:,.2f}")
    print(f"PASS: {len(ref):,} predictions, {ref.entry_date.nunique()} daily Top-5 rankings, "
          f"{checked} raw-history cases and both portfolio ledgers. Max return error {error:.3g}.")


if __name__ == "__main__":
    main()

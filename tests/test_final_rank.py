"""Offline parity and integration checks; no market/broker calls or training."""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
import torch

from rank_ensemble import DEFAULT_MANIFEST, RankEnsemble, prepare_inputs, rank_zscore
from predict import predict_multiple, predict_next_return

FIXTURES = Path(__file__).parent / "fixtures/final_rank"


def histories():
    dates = pd.bdate_range("2019-06-03", periods=200)
    t = np.arange(len(dates))
    frames = {}
    for i in range(32):
        price = 100 + t * .08 + 3 * np.sin(t * .15 + i)
        frames[f"{100000+i}"] = pd.DataFrame(dict(Open=price, High=price+2,
            Low=price-2, Close=price+.3, Volume=1000+t*3+i), index=dates)
    market = {s: pd.DataFrame(dict(Close=300+t*.1+np.sin(t*.1), Volume=10000+t*3), index=dates)
              for s in ("KPI200", "KOSPI")}
    return frames, market, dates[-1]


class FinalRankTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(4)
        cls.model = RankEnsemble()

    def test_frozen_research_predictions_on_three_full_cross_sections(self):
        checks = json.loads((FIXTURES / "provenance.json").read_text())
        for name, digest in checks["fixtures"].items():
            path = FIXTURES / name
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
            with np.load(path, allow_pickle=False) as f:
                scores, raw = self.model.predict_windows(f["windows"], f["market"], return_raw=True)
                np.testing.assert_allclose(raw, f["expected_raw"], atol=2e-5, rtol=2e-4)
                np.testing.assert_allclose(scores, f["expected_score"], atol=1e-12, rtol=0)

    def test_batching_and_universe_order_do_not_change_scores(self):
        with np.load(FIXTURES / "day_212.npz") as f:
            scores = self.model.predict_windows(f["windows"][::-1].copy(), f["market"], batch_size=47)
            np.testing.assert_allclose(scores[::-1], f["expected_score"], atol=1e-12, rtol=0)

    def test_ties_and_constant_rank_outputs(self):
        np.testing.assert_allclose(rank_zscore([2, 2, 2]), 0)
        r = rank_zscore([1, 1, 3, 4])
        self.assertEqual(r[0], r[1])
        self.assertAlmostEqual(r.std(), 1)
        with self.assertRaises(ValueError):
            rank_zscore([1, np.nan])

    def test_no_future_data_and_no_gap_filling(self):
        frames, market, cutoff = histories()
        ticks, windows, context, _ = prepare_inputs(frames, market, cutoff)
        later = cutoff + pd.offsets.BDay()
        for df in [*frames.values(), *market.values()]:
            df.loc[later] = 1e12
        ticks2, windows2, context2, _ = prepare_inputs(frames, market, cutoff)
        self.assertEqual(ticks, ticks2)
        np.testing.assert_array_equal(windows, windows2)
        np.testing.assert_array_equal(context, context2)
        frames[ticks[0]] = frames[ticks[0]].drop(cutoff - pd.offsets.BDay(3))
        valid, _, _, errors = prepare_inputs(frames, market, cutoff)
        self.assertNotIn(ticks[0], valid)
        self.assertIn("120 consecutive", errors[ticks[0]])

    def test_refuses_missing_market_single_ticker_and_corrupted_assets(self):
        frames, market, cutoff = histories()
        with self.assertRaises(ValueError):
            prepare_inputs(frames, None, cutoff)
        with self.assertRaises(ValueError):
            self.model.predict(dict(list(frames.items())[:1]), market, cutoff)
        with self.assertRaisesRegex(ValueError, "complete universe"):
            predict_next_return(str(DEFAULT_MANIFEST), next(iter(frames.values())))
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / "model"
            shutil.copytree(DEFAULT_MANIFEST.parent, folder)
            asset = next(folder.glob("*.pt"))
            asset.write_bytes(asset.read_bytes() + b"corrupted")
            with self.assertRaisesRegex(ValueError, "SHA256"):
                RankEnsemble(folder / "manifest.json")

    def test_pipeline_exports_rank_scores_without_return_or_broker_access(self):
        import integrated_pipeline as pipeline
        frames, market, cutoff = histories()
        candidates = pd.DataFrame({"ticker": list(frames), "company_name": list(frames)})
        bundle = {"rank_ensemble": self.model, "task": "rank", "device": torch.device("cpu")}
        with patch("predict._load_inference_bundle", return_value=bundle), \
             patch.object(pipeline, "_fetch_market_history", return_value=market), \
             patch.object(pipeline, "_fetch_raw_ohlcv", side_effect=lambda ticker, days, as_of: frames[ticker]), \
             patch.object(pipeline, "create_token_manager", side_effect=RuntimeError("offline test")):
            rank, _, selected = pipeline.step2_attach_ensemble(candidates, DEFAULT_MANIFEST,
                Path(pipeline.__file__).parent / "predict.py", final_max=5)
        self.assertEqual(len(rank), 32)
        self.assertTrue(rank.prediction_status.eq("ok").all())
        self.assertTrue(rank.ensemble_pred_return.isna().all())
        self.assertTrue(rank.score_kind.eq("rank_zscore").all())
        self.assertTrue(rank.rank_score.is_monotonic_decreasing)
        self.assertEqual(selected.ticker.tolist(), rank.ticker.iloc[:5].tolist())
        self.assertTrue(rank.prediction_base_date.eq(str(cutoff.date())).all())
        with patch("predict._load_inference_bundle", return_value=bundle):
            expected = predict_multiple(str(DEFAULT_MANIFEST), frames, market_frames=market, as_of=cutoff)
        np.testing.assert_allclose(rank.rank_score, [expected[t] for t in rank.ticker], atol=1e-12)


if __name__ == "__main__":
    unittest.main()

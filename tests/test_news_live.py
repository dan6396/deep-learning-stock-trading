"""The live validation gate must not silently change the price ranking."""
from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from news_fusion.live import MANIFEST, _event_features, rank_with_news


class LiveNewsRankingTest(unittest.TestCase):
    def test_inactive_gate_preserves_price_top_five_without_api_key(self):
        scores = [0.005, 0.014, -0.002, 0.012, 0.003, 0.007]
        rows = pd.DataFrame({
            "ticker": [f"{i:06d}" for i in range(1, 7)],
            "company_name": [f"Company {i}" for i in range(1, 7)],
            "ensemble_pred_return": scores,
            "prediction_status": ["ok"] * 6,
            "prediction_base_date": ["2026-09-25"] * 6,
        })
        with tempfile.TemporaryDirectory() as directory, \
             patch("news_fusion.live._discover_independent", return_value=[]), \
             patch("news_fusion.live.load_key", side_effect=ValueError("missing")):
            top, details = rank_with_news(rows, Path(directory))
        self.assertEqual(top.ticker.tolist(), ["000002", "000004", "000006", "000001", "000005"])
        self.assertTrue((top.news_delta == 0).all())
        self.assertTrue((top.final_pred_return == top.ensemble_pred_return).all())
        self.assertEqual(details["000002"]["status"], "api_key_missing")

    def test_event_feature_rejects_news_after_target_session(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        item = {"event_type": "earnings", "sentiment": "positive", "relevance": "direct",
                "evidence_quote": "sales rose", "pub_date": "2026-09-30T10:00:00+09:00"}
        features, accepted = _event_features([item], date(2026, 9, 29), manifest, 0.1)
        self.assertFalse(accepted)
        self.assertTrue(all(value == 0 for value in features.values()))


if __name__ == "__main__":
    unittest.main()

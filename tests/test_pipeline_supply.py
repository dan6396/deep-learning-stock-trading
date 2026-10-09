"""Daily combined flow is counted from measured daily amounts; no network calls."""
import unittest
from types import SimpleNamespace
from integrated_pipeline import _fetch_supply_trend


class SupplyCombinedDaysTest(unittest.TestCase):
    def fetch(self, rows, window=3):
        response = SimpleNamespace(status_code=200, text="fixture", json=lambda: {"rt_cd": "0", "output": rows})
        manager = SimpleNamespace(auth_headers=lambda _: {}, session=SimpleNamespace(get=lambda *args, **kwargs: response))
        return _fetch_supply_trend("005930", manager, "2026-10-08", window, 2)

    def row(self, date, foreign, institution):
        return {"stck_bsop_date": date, "frgn_ntby_tr_pbmn": str(foreign), "orgn_ntby_tr_pbmn": str(institution)}

    def test_counts_sum_positive_each_day_including_offsetting_flows(self):
        result = self.fetch([self.row("20261008", 10, -2), self.row("20261007", -10, 2), self.row("20261006", 1, -1)])
        self.assertEqual(result["combined_positive_days"], 1)
        self.assertEqual(result["foreign_positive_days"], 2)
        self.assertEqual(result["inst_positive_days"], 1)
        self.assertTrue(result["supply_data_enough"])

    def test_counts_duplicate_dates_once_and_filters_future_rows(self):
        row = self.row("20261008", 2, 1)
        result = self.fetch([row, row, self.row("20261009", 10, 10)], window=2)
        self.assertEqual(result["combined_positive_days"], 1)
        self.assertEqual(result["supply_data_days"], 1)
        self.assertFalse(result["supply_data_enough"])

    def test_rejects_conflicting_daily_evidence(self):
        result = self.fetch([self.row("20261008", 1, 2), self.row("20261008", 2, 2)])
        self.assertEqual(result["supply_status"], "fetch_failed")

    def test_missing_daily_amounts_cannot_turn_into_valid_zero(self):
        result = self.fetch([self.row("20261008", "", 2)])
        self.assertEqual(result["supply_status"], "insufficient_data")
        self.assertFalse(result["supply_data_enough"])


if __name__ == "__main__":
    unittest.main()

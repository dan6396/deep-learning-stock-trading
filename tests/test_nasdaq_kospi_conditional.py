"""Offline synthetic tests for the macro reference-statistics calculation."""
from datetime import date, datetime, timezone
import unittest
from unittest.mock import patch
from urllib.error import URLError

from scripts.analysis.nasdaq_kospi_conditional import (
    DataError, align_sessions, fetch_daily, parse_chart, summarize,
)


def row(day, opening, close):
    return {"date": day, "open": opening, "close": close}


class NasdaqKospiConditionalTests(unittest.TestCase):
    def setUp(self):
        self.us = [row("2026-01-15", 100, 100), row("2026-01-16", 100, 110),
                   row("2026-01-20", 110, 99), row("2026-01-21", 99, 999)]
        self.kr = [row("2026-01-16", 100, 100), row("2026-01-19", 110, 105),
                   row("2026-01-20", 100, 102), row("2026-01-21", 100, 101)]

    def test_weekend_holiday_no_future_leak_and_native_previous_close(self):
        pairs, excluded = align_sessions(self.us, self.kr, date(2026, 1, 19), date(2026, 1, 21))
        self.assertEqual(excluded, {})
        self.assertEqual([p["nasdaq_date"] for p in pairs], ["2026-01-16", "2026-01-16", "2026-01-20"])
        self.assertAlmostEqual(pairs[0]["nasdaq_return"], .1)
        self.assertAlmostEqual(pairs[0]["close_to_close"], .05)
        self.assertAlmostEqual(pairs[0]["open_to_close"], 105 / 110 - 1)
        self.assertAlmostEqual(pairs[2]["nasdaq_return"], -.1)
        self.assertAlmostEqual(pairs[2]["close_to_close"], 101 / 102 - 1)
        strict, excluded = align_sessions(self.us, self.kr, date(2026, 1, 19), date(2026, 1, 21), "previous_calendar_day")
        self.assertEqual([p["kospi_date"] for p in strict], ["2026-01-21"])
        self.assertEqual(excluded["no_previous_calendar_day_us_session"], 2)

    def test_korean_holiday_uses_latest_us_session_not_previous_joined_row(self):
        us = [row("2026-02-13", 100, 100), row("2026-02-17", 100, 110), row("2026-02-18", 110, 99)]
        kr = [row("2026-02-13", 100, 100), row("2026-02-19", 105, 110)]
        pairs, _ = align_sessions(us, kr, date(2026, 2, 19), date(2026, 2, 19))
        self.assertEqual(pairs[0]["nasdaq_date"], "2026-02-18")
        self.assertAlmostEqual(pairs[0]["nasdaq_return"], -.1)
        self.assertAlmostEqual(pairs[0]["close_to_close"], .1)

    def test_quadrants_flats_baseline_and_reproducible_bootstrap(self):
        pairs = [{"nasdaq_return": u, "open_to_close": k} for u, k in
                 [(1, 2), (1, -1), (-1, -2), (-1, 1), (1, 0), (0, 1)]]
        result = summarize(pairs, "open_to_close", repetitions=100)
        self.assertEqual(result, summarize(pairs, "open_to_close", repetitions=100))
        self.assertEqual(result["sample_count"], 6)
        self.assertEqual(result["flat_count"], 2)
        self.assertEqual(sum(q["count"] for q in result["quadrants"].values()), 4)
        m = result["metrics"]
        self.assertEqual(m["kospi_up_baseline"]["value"], 50)
        self.assertAlmostEqual(m["kospi_up_given_nasdaq_up"]["value"], 100 / 3)
        self.assertAlmostEqual(m["up_lift_vs_baseline"]["value"], 100 / 3 - 50)
        self.assertAlmostEqual(m["same_direction"]["value"], 100 / 3)
        for metric in m.values():
            self.assertLessEqual(metric["ci95"][0], metric["ci95"][1])

    def test_network_failure_is_explicit(self):
        with patch("scripts.analysis.nasdaq_kospi_conditional.urlopen", side_effect=URLError("offline")):
            with self.assertRaisesRegex(DataError, "download failed"):
                fetch_daily("^IXIC", date(2026, 1, 1), date(2026, 1, 21))

    def test_missing_price_retained_and_not_bridged(self):
        payload = {"chart": {"result": [{"meta": {"exchangeTimezoneName": "Asia/Seoul"},
                   "timestamp": [1768780800], "indicators": {"quote": [{"open": [100], "close": [None]}]}}]}}
        self.assertIsNone(parse_chart(payload, "^KS11")[0]["close"])
        self.us[1]["close"] = None
        pairs, excluded = align_sessions(self.us, self.kr, date(2026, 1, 19), date(2026, 1, 21))
        self.assertEqual(pairs, [])
        self.assertEqual(excluded["missing_required_price"], 3)

    def test_empty_sample_rejected(self):
        with self.assertRaisesRegex(DataError, "No aligned observations"):
            summarize([], "open_to_close", repetitions=100)

    def test_exchange_dates_across_dst_and_utc_boundary(self):
        stamps = [int(datetime(2026, 3, 6, 14, 30, tzinfo=timezone.utc).timestamp()),
                  int(datetime(2026, 3, 9, 13, 30, tzinfo=timezone.utc).timestamp())]
        result = {"meta": {"exchangeTimezoneName": "America/New_York"}, "timestamp": stamps,
                  "indicators": {"quote": [{"open": [100, 101], "close": [101, 102]}]}}
        rows = parse_chart({"chart": {"result": [result]}}, "^IXIC")
        self.assertEqual([r["date"] for r in rows], ["2026-03-06", "2026-03-09"])
        result["meta"]["exchangeTimezoneName"] = "Asia/Seoul"
        result["timestamp"] = [int(datetime(2026, 3, 8, 23, tzinfo=timezone.utc).timestamp())]
        result["indicators"]["quote"] = [{"open": [100], "close": [101]}]
        self.assertEqual(parse_chart({"chart": {"result": [result]}}, "^KS11")[0]["date"], "2026-03-09")

    def test_korean_missing_close_does_not_bridge_next_day(self):
        self.kr[1]["close"] = None
        pairs, excluded = align_sessions(self.us, self.kr, date(2026, 1, 19), date(2026, 1, 21))
        self.assertEqual([p["kospi_date"] for p in pairs], ["2026-01-21"])
        self.assertEqual(excluded["missing_required_price"], 2)


if __name__ == "__main__":
    unittest.main()

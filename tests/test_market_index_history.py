"""Index-provider/cache regression tests; no network or real credentials."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np
import pandas as pd

import market_index_history as history


class Pages:
    def __init__(self, dates, size=5):
        self.rows = {code: [{"stck_bsop_date": d.strftime("%Y%m%d"),
                             "bstp_nmix_prpr": str(300 + i), "acml_vol": str(1000 + i)}
                            for i, d in enumerate(dates)] for code in history.INDEX_CODES.values()}
        self.size, self.calls, self.requests = size, 0, []

    def page(self, code, start, end):
        self.calls += 1
        self.requests.append((code, start, end))
        rows = [r for r in self.rows[code] if start.strftime("%Y%m%d") <= r["stck_bsop_date"] <= end.strftime("%Y%m%d")]
        return list(reversed(rows[-self.size:]))


class MarketHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.dates = pd.bdate_range("2019-06-03", periods=23)

    def fetch(self, client=None, end=None):
        return history.fetch_kis_history(end or self.dates[-1], self.folder, client or Pages(self.dates))

    def test_backward_pagination_deduplicates_and_returns_same_daily_frame_shape(self):
        client = Pages(self.dates)
        page = client.page
        def duplicate(*args):
            rows = page(*args)
            return rows + rows[:1]
        client.page = duplicate
        frames = self.fetch(client)
        self.assertEqual(set(frames), {"KPI200", "KOSPI"})
        for frame in frames.values():
            self.assertIsInstance(frame.index, pd.DatetimeIndex)
            self.assertIsNone(frame.index.tz)
            self.assertEqual(list(frame.columns), ["Close", "Volume"])
            self.assertEqual(frame.index.tolist(), self.dates.tolist())
            self.assertFalse(frame.index.has_duplicates)
        requests = [r for r in client.requests if r[0] == "2001"]
        self.assertEqual(len(requests), 5)
        self.assertTrue(all(a[2] > b[2] for a, b in zip(requests, requests[1:])))
        metadata = json.loads((self.folder / "latest-request.json").read_text())
        self.assertEqual(metadata["market_index_source"], "kis")
        self.assertEqual(metadata["calls"], {"KPI200": 5, "KOSPI": 5})

    def test_incremental_fetch_refetches_last_five_and_overwrites_corrections(self):
        self.fetch(end=self.dates[-3])
        client = Pages(self.dates, size=50)
        for rows in client.rows.values():
            rows[-4]["bstp_nmix_prpr"] = "999"
        frames = self.fetch(client)
        self.assertEqual(len(client.requests), 2)
        self.assertTrue(all(r[1] == self.dates[-7] for r in client.requests))
        self.assertEqual(frames["KPI200"].loc[self.dates[-4], "Close"], 999)
        self.assertEqual(len(frames["KPI200"]), 23)
        second = Pages(self.dates, size=50)
        self.fetch(second)
        self.assertTrue(all(r[1] == self.dates[-5] for r in second.requests))

    def test_corrupt_cache_is_rebuilt_without_changing_other_index_refresh(self):
        self.fetch()
        (self.folder / "KPI200.csv").write_text("invalid,csv\nbroken,value")
        client = Pages(self.dates, size=50)
        self.fetch(client)
        self.assertEqual(client.requests[0][1], history.HISTORY_START)
        self.assertEqual(client.requests[1][1], self.dates[-5])
        self.assertIsNotNone(history._read_cache(self.folder / "KPI200.csv"))

    def test_refresh_omissions_preserve_cached_sessions_and_report_reduced_coverage(self):
        self.fetch()
        original = history._read_cache(self.folder / "KPI200.csv")
        client = Pages(self.dates, size=50)
        for rows in client.rows.values():
            rows[-5]["bstp_nmix_prpr"] = "999"
            rows[-4]["bstp_nmix_prpr"] = None
            rows.pop(-3)
        with self.assertWarnsRegex(RuntimeWarning, "refresh omitted 1/5 cached sessions; preserving"):
            frames = self.fetch(client)
        for symbol, frame in frames.items():
            self.assertEqual(frame.index.tolist(), self.dates.tolist())
            self.assertEqual(frame.loc[self.dates[-3], "Close"], original.loc[self.dates[-3], "Close"])
            self.assertEqual(frame.loc[self.dates[-5], "Close"], 999)
            self.assertTrue(np.isnan(frame.loc[self.dates[-4], "Close"]))
            saved = history._read_cache(self.folder / f"{symbol}.csv")
            self.assertEqual(saved.loc[self.dates[-3], "collected_at"], original.loc[self.dates[-3], "collected_at"])

    def test_empty_refresh_fails_without_overwriting_existing_cache(self):
        self.fetch()
        originals = {symbol: (self.folder / f"{symbol}.csv").read_bytes() for symbol in history.INDEX_CODES}
        client = Pages(self.dates); client.page = lambda *_: []
        with self.assertRaisesRegex(ValueError, "No completed index history"):
            self.fetch(client)
        for symbol in history.INDEX_CODES:
            self.assertEqual((self.folder / f"{symbol}.csv").read_bytes(), originals[symbol])

    def test_historical_end_preserves_newer_disk_rows_and_only_slices_return(self):
        self.fetch()
        originals = {symbol: history._read_cache(self.folder / f"{symbol}.csv") for symbol in history.INDEX_CODES}
        end = self.dates[-8]
        client = Pages(self.dates, size=50)
        for rows in client.rows.values():
            rows[-9]["bstp_nmix_prpr"] = "999"
        frames = self.fetch(client, end=end)
        for symbol, frame in frames.items():
            self.assertEqual(frame.index[-1], end)
            self.assertEqual(len(frame), 16)
            self.assertEqual(frame.loc[self.dates[-9], "Close"], 999)
            saved = history._read_cache(self.folder / f"{symbol}.csv")
            self.assertEqual(len(saved), 23)
            self.assertEqual(saved.index[-1], self.dates[-1])
            pd.testing.assert_frame_equal(saved.loc[saved.index > end], originals[symbol].loc[originals[symbol].index > end])
        incremental = Pages(self.dates, size=50)
        self.fetch(incremental)
        self.assertTrue(all(request[1] == self.dates[-5] for request in incremental.requests))

    def test_calendar_disagreement_refuses_to_commit_either_cache(self):
        client = Pages(self.dates)
        client.rows["0001"].pop(4)
        with self.assertRaisesRegex(ValueError, "calendars disagree"):
            self.fetch(client)
        self.assertFalse((self.folder / "KPI200.csv").exists())

    def test_pykrx_blank_dash_zero_convention_and_explicit_nulls_preserve_all_rows(self):
        client = Pages(self.dates)
        for rows in client.rows.values():
            rows[3]["acml_vol"] = ""
            rows[4]["acml_vol"] = "0"
            rows[5]["bstp_nmix_prpr"] = None
            rows[6]["acml_vol"] = None
            rows[7]["acml_vol"] = "-"
        frame = self.fetch(client)["KPI200"]
        self.assertEqual(frame.iloc[3].Volume, 0)
        self.assertEqual(frame.iloc[4].Volume, 0)
        self.assertTrue(np.isnan(frame.iloc[5].Close))
        self.assertTrue(np.isnan(frame.iloc[6].Volume))
        self.assertEqual(frame.iloc[7].Volume, 0)
        self.assertEqual(len(frame), 23)
        pd.testing.assert_frame_equal(frame, history._read_cache(self.folder / "KPI200.csv")[["Close", "Volume"]])

    def test_failed_pagination_and_malformed_rows_are_rejected(self):
        client = Pages(self.dates)
        client.page = lambda *_: [{"stck_bsop_date": "20200101", "bstp_nmix_prpr": "300", "acml_vol": "100"}]
        with self.assertRaisesRegex(ValueError, "did not move backwards"):
            self.fetch(client)
        for field, value in [("stck_bsop_date", "20190230"), ("acml_vol", "not-a-number"), ("acml_vol", "-1")]:
            client = Pages(self.dates)
            client.rows["2001"][-1][field] = value
            client.page = Mock(return_value=[client.rows["2001"][-1]])
            with self.assertRaisesRegex(ValueError, "Malformed"):
                self.fetch(client)

    def test_retry_backoff_is_bounded_and_never_echoes_provider_secrets(self):
        good = Mock(); good.json.return_value = {"rt_cd": "0", "output2": []}
        manager = SimpleNamespace(base_url="https://fixture.invalid", auth_headers=Mock(return_value={"authorization": "fixture-secret"}), session=Mock())
        manager.session.get.side_effect = [RuntimeError("fixture-secret"), RuntimeError("fixture-secret"), good]
        sleeps = []
        client = history.KisIndexClient(manager, sleep=sleeps.append, clock=lambda: 0)
        self.assertEqual(client.page("2001", self.dates[0], self.dates[-1]), [])
        self.assertEqual(client.calls, 3)
        self.assertIn(1, sleeps); self.assertIn(2, sleeps)
        self.assertEqual(manager.auth_headers.call_args.args, ("FHKUP03500100",))
        self.assertEqual(manager.session.get.call_args.kwargs["params"]["FID_COND_MRKT_DIV_CODE"], "U")
        manager.session.get.side_effect = RuntimeError("fixture-secret")
        with self.assertRaisesRegex(RuntimeError, "after 3 attempts") as caught:
            client.page("2001", self.dates[0], self.dates[-1])
        self.assertNotIn("fixture-secret", str(caught.exception))
        self.assertEqual(client.calls, 6)

    def test_external_value_errors_cannot_impersonate_invalid_response_messages(self):
        cases = [
            ("invalid_response fixture-private-marker", "ValueError"),
            ("invalid_response_like fixture-private-marker", "ValueError"),
            ("invalid_response EGW00133suffix fixture-private-marker", "ValueError"),
            ("invalid_response EGW001333 fixture-private-marker", "ValueError"),
            ("invalid_response EGW00133 fixture-private-marker", "EGW00133"),
            ("invalid_response 403 Client Error: EGW00133 fixture-private-marker", "HTTP 403 EGW00133"),
        ]
        for stage in ("get", "json"):
            for message, reason in cases:
                with self.subTest(stage=stage, message=message):
                    response = Mock()
                    manager = SimpleNamespace(base_url="https://fixture.invalid", session=Mock(),
                                              auth_headers=Mock(return_value={}))
                    manager.session.get.return_value = response
                    target = manager.session.get if stage == "get" else response.json
                    target.side_effect = ValueError(message)
                    client = history.KisIndexClient(manager, sleep=lambda _: None, clock=lambda: 0)
                    with self.assertRaises(history.KisIndexError) as caught:
                        client.page("2001", self.dates[0], self.dates[-1])
                    self.assertEqual(str(caught.exception),
                        f"KIS index 2001 {self.dates[0].date()}..{self.dates[-1].date()}: "
                        f"request_or_response_failed: {reason} after 3 attempts")
                    self.assertNotIn("fixture-private-marker", str(caught.exception))
                    self.assertEqual(client.calls, 3)

    def test_invalid_response_only_accepts_complete_provider_codes(self):
        for code, suffix in (("EGW00133", " EGW00133"), ("OPSQ1234", " OPSQ1234"),
                             ("EGW00133suffix", ""), ("EGW001333", ""),
                             ("EGW00133 fixture-private-marker", ""),
                             ("403 Client Error: EGW00133", ""), ("fixture-private-marker", "")):
            with self.subTest(code=code):
                response = Mock()
                response.json.return_value = {"rt_cd": "1", "msg_cd": code,
                                              "msg1": "fixture-private-marker"}
                manager = SimpleNamespace(base_url="https://fixture.invalid", session=Mock(),
                                          auth_headers=Mock(return_value={}))
                manager.session.get.return_value = response
                client = history.KisIndexClient(manager, sleep=lambda _: None, clock=lambda: 0)
                with self.assertRaises(history.KisIndexError) as caught:
                    client.page("2001", self.dates[0], self.dates[-1])
                self.assertEqual(str(caught.exception),
                    f"KIS index 2001 {self.dates[0].date()}..{self.dates[-1].date()}: "
                    f"request_or_response_failed: invalid_response{suffix} after 3 attempts")
                self.assertEqual(client.calls, 3)

    def test_fe_token_is_reused_without_issuance_and_shared_with_python_supply(self):
        import config
        credentials = config.KISCredentials("fixture-key", "fixture-secret")
        fe = self.folder / "FE"; fe.mkdir()
        (fe / ".kis-token-cache.json").write_text(json.dumps({"accessToken": "fixture-token",
            "expiresAt": (history.time.time() + 3600) * 1000,
            "cacheKey": "real:https://fixture.invalid:fixture-key"}))
        with patch.object(history, "ROOT", self.folder), patch.object(config, "TOKEN_CACHE_FILE", self.folder / "python-token.json"), \
             patch.object(config.KISTokenManager, "_issue_token") as issue:
            manager = history._shared_token_manager({"KIS_ENV": "real", "KIS_APP_KEY": "fixture-key", "KIS_APP_SECRET": "fixture-secret", "KIS_BASE_URL": "https://fixture.invalid"})
            self.assertEqual(manager.get_access_token(), "fixture-token")
            other = config.KISTokenManager(credentials, base_url="https://fixture.invalid")
            self.assertEqual(other.get_access_token(), "fixture-token")
            issue.assert_not_called()

    def test_provider_selection_preserves_pykrx_calls_and_rejects_unknown_source(self):
        import integrated_pipeline as pipeline
        from pykrx import stock
        sample = pd.DataFrame({"\uc885\uac00": [300.0], "\uac70\ub798\ub7c9": [1234]}, index=pd.DatetimeIndex(["2019-06-03"]))
        with patch.dict("os.environ", {"MARKET_INDEX_SOURCE": "pykrx"}), \
             patch.object(pipeline, "_EXTERNAL_MARKET_ENV", {}), \
             patch.object(stock, "get_index_ohlcv_by_date", return_value=sample) as get, \
             patch.object(history, "record_metadata"):
            frames = pipeline._fetch_market_history()
            self.assertEqual([c.args[2] for c in get.call_args_list], ["1028", "1001"])
            self.assertTrue(all(c.args[0] == "20190603" for c in get.call_args_list))
            self.assertEqual(list(frames["KOSPI"].columns), ["Close", "Volume"])
        with patch.dict("os.environ", {"MARKET_INDEX_SOURCE": "unknown"}), patch.object(pipeline, "_EXTERNAL_MARKET_ENV", {}):
            with self.assertRaisesRegex(ValueError, "must be kis or pykrx"):
                pipeline._fetch_market_history()

    def test_external_snapshot_is_only_used_by_index_client_without_restoring_global_environment(self):
        import integrated_pipeline as pipeline
        snapshot = {"KIS_ENV": "real", "KIS_APP_KEY": "fixture-real", "MARKET_INDEX_SOURCE": "kis"}
        with patch.dict("os.environ", {"KIS_ENV": "mock", "KIS_APP_KEY": "fixture-mock"}), \
             patch.object(pipeline, "_EXTERNAL_MARKET_ENV", snapshot), patch.object(history, "fetch_kis_history", return_value={}) as fetch:
            pipeline._fetch_market_history()
            self.assertEqual(fetch.call_args.kwargs["env"]["KIS_ENV"], "real")
            self.assertEqual(fetch.call_args.kwargs["env"]["KIS_APP_KEY"], "fixture-real")
            import os
            self.assertEqual(os.environ["KIS_ENV"], "mock")
            self.assertEqual(os.environ["KIS_APP_KEY"], "fixture-mock")

    def test_kis_failure_explains_configuration_without_echoing_upstream_errors(self):
        import integrated_pipeline as pipeline
        with patch.object(pipeline, "_EXTERNAL_MARKET_ENV", {"MARKET_INDEX_SOURCE": "kis"}), \
             patch.object(history, "fetch_kis_history", side_effect=RuntimeError("fixture-secret")):
            with self.assertRaisesRegex(RuntimeError, "MARKET_INDEX_SOURCE=kis") as caught:
                pipeline._fetch_market_history()
            self.assertIn("KIS_ENV=mock 또는 real", str(caught.exception))
            self.assertIn("MARKET_INDEX_SOURCE=pykrx", str(caught.exception))
            self.assertNotIn("fixture-secret", str(caught.exception))


    def test_kis_failure_reports_safe_reason_codes_only(self):
        import integrated_pipeline as pipeline
        manager = SimpleNamespace(base_url="https://fixture.invalid", session=Mock(),
                                  auth_headers=Mock(side_effect=RuntimeError("403 Client Error: Forbidden fixture-secret EGW00133")))
        client = history.KisIndexClient(manager, sleep=lambda _: None, clock=lambda: 0)
        with self.assertRaises(history.KisIndexError) as caught:
            client.page("2001", self.dates[0], self.dates[-1])
        self.assertEqual(str(caught.exception), "KIS index authentication failed: HTTP 403 EGW00133")
        with self.assertRaises(history.KisIndexError) as caught:
            history.KisIndexClient(env={"KIS_ENV": "mock"}).page("2001", self.dates[0], self.dates[-1])
        self.assertEqual(str(caught.exception), "KIS index authentication configuration failed: KIS index credentials are missing")
        bad = Mock(); bad.json.return_value = {"rt_cd": "1", "msg_cd": "EGW00201", "msg1": "fixture-secret"}
        manager = SimpleNamespace(base_url="https://fixture.invalid", auth_headers=Mock(return_value={}), session=Mock())
        manager.session.get.return_value = bad
        with self.assertRaises(history.KisIndexError) as caught:
            history.KisIndexClient(manager, sleep=lambda _: None, clock=lambda: 0).page("2001", self.dates[0], self.dates[-1])
        self.assertIn("invalid_response EGW00201 after 3 attempts", str(caught.exception))
        self.assertIn(f"KIS index 2001 {self.dates[0].date()}..{self.dates[-1].date()}:", str(caught.exception))
        self.assertNotIn("fixture-secret", str(caught.exception))
        bad.json.return_value = {"rt_cd": "1", "msg_cd": "fixture-secret"}
        with self.assertRaises(history.KisIndexError) as caught:
            history.KisIndexClient(manager, sleep=lambda _: None, clock=lambda: 0).page("2001", self.dates[0], self.dates[-1])
        self.assertIn(f"KIS index 2001 {self.dates[0].date()}..{self.dates[-1].date()}: request_or_response_failed: invalid_response after 3 attempts", str(caught.exception))
        self.assertNotIn("fixture-secret", str(caught.exception))
        with patch.object(pipeline, "_EXTERNAL_MARKET_ENV", {"MARKET_INDEX_SOURCE": "kis"}),              patch.object(history, "fetch_kis_history", side_effect=history.KisIndexError("KIS index authentication failed: HTTP 403 EGW00133")):
            with self.assertRaisesRegex(RuntimeError, r"KIS 지수 이력 수집 실패 \(KIS index authentication failed: HTTP 403 EGW00133\)"):
                pipeline._fetch_market_history()

class KisIndexEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "FE").mkdir()

    def test_environment_selects_its_own_credentials_and_default_server(self):
        import config
        for mode in ("mock", "real"):
            with self.subTest(mode=mode):
                env = {"KIS_ENV": mode, "KIS_MOCK_APP_KEY": "fixture-mock-key",
                       "KIS_MOCK_APP_SECRET": "fixture-mock-secret", "KIS_REAL_APP_KEY": "fixture-real-key",
                       "KIS_REAL_APP_SECRET": "fixture-real-secret", "KIS_APP_KEY": "fixture-generic-key",
                       "KIS_APP_SECRET": "fixture-generic-secret"}
                manager = history._shared_token_manager(env)
                self.assertEqual(manager.base_url, config.KIS_BASE_URLS[mode])
                self.assertEqual(manager.credentials.app_key, f"fixture-{mode}-key")
                self.assertEqual(manager.credentials.app_secret, f"fixture-{mode}-secret")

    def test_default_is_mock_and_common_credential_names_still_work(self):
        import config
        for key_name, secret_name in (("KIS_APP_KEY", "KIS_APP_SECRET"), ("APP_KEY", "APP_SECRET")):
            with self.subTest(key_name=key_name):
                manager = history._shared_token_manager({key_name: "fixture-key", secret_name: "fixture-secret"})
                self.assertEqual(manager.base_url, config.KIS_BASE_URLS["mock"])
                self.assertEqual(manager.credentials.app_key, "fixture-key")
                self.assertEqual(manager.credentials.app_secret, "fixture-secret")

    def test_other_environment_credentials_are_never_used_as_fallback(self):
        for mode, other in (("mock", "REAL"), ("real", "MOCK")):
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, "credentials are missing"):
                history._shared_token_manager({"KIS_ENV": mode, f"KIS_{other}_APP_KEY": "fixture-key",
                                               f"KIS_{other}_APP_SECRET": "fixture-secret"})

    def test_empty_environment_defaults_to_mock(self):
        import config
        for mode in ("", " \t "):
            with self.subTest(mode=mode):
                manager = history._shared_token_manager({"KIS_ENV": mode, "KIS_MOCK_APP_KEY": "fixture-mock-key",
                                                        "KIS_MOCK_APP_SECRET": "fixture-mock-secret",
                                                        "KIS_REAL_APP_KEY": "fixture-real-key", "KIS_REAL_APP_SECRET": "fixture-real-secret"})
                self.assertEqual(manager.base_url, config.KIS_BASE_URLS["mock"])
                self.assertEqual(manager.credentials.app_key, "fixture-mock-key")
                self.assertEqual(manager.credentials.app_secret, "fixture-mock-secret")

    def test_invalid_environment_and_opposite_official_server_are_rejected(self):
        import config
        for mode, url, message in (("typo", "https://fixture.invalid", "environment must be mock or real"),
                                   ("mock", config.KIS_BASE_URLS["real"], "base URL does not match KIS_ENV"),
                                   ("real", config.KIS_BASE_URLS["mock"], "base URL does not match KIS_ENV")):
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, message):
                history._shared_token_manager({"KIS_ENV": mode, "KIS_APP_KEY": "fixture-key",
                                               "KIS_APP_SECRET": "fixture-secret", "KIS_BASE_URL": url})

    def test_mock_index_request_uses_mock_server_and_the_official_tr_id(self):
        import config
        manager = history._shared_token_manager({"KIS_ENV": "mock", "KIS_MOCK_APP_KEY": "fixture-key",
                                                "KIS_MOCK_APP_SECRET": "fixture-secret"})
        response = Mock()
        response.json.return_value = {"rt_cd": "0", "output2": [{"stck_bsop_date": "20261030"}]}
        with patch.object(manager, "auth_headers", return_value={"tr_id": history.TR_ID}) as auth, \
             patch.object(manager.session, "get", return_value=response) as request:
            rows = history.KisIndexClient(manager).page("2001", pd.Timestamp("20261001"), pd.Timestamp("20261030"))
        self.assertEqual(rows, [{"stck_bsop_date": "20261030"}])
        auth.assert_called_once_with("FHKUP03500100")
        self.assertEqual(request.call_args.args[0], config.KIS_BASE_URLS["mock"] + history.API_PATH)
        self.assertEqual(request.call_args.kwargs["params"]["FID_INPUT_ISCD"], "2001")

    def test_fe_tokens_are_reused_only_for_the_selected_environment(self):
        import config
        for mode in ("mock", "real"):
            for cached_mode in ("mock", "real"):
                with self.subTest(mode=mode, cached_mode=cached_mode):
                    python_cache = self.root / f"{mode}-{cached_mode}.json"
                    fe_cache = self.root / "FE" / ".kis-token-cache.json"
                    fe_cache.write_text(json.dumps({"accessToken": "fixture-cached-token",
                        "expiresAt": (history.time.time() + 3600) * 1000,
                        "cacheKey": f"{cached_mode}:https://fixture.invalid:fixture-key"}))
                    with patch.object(history, "ROOT", self.root), patch.object(config, "TOKEN_CACHE_FILE", python_cache), \
                         patch.object(config.KISTokenManager, "_issue_token", return_value={
                             "access_token": "fixture-issued-token", "expires_in": 3600}) as issue:
                        manager = history._shared_token_manager({"KIS_ENV": mode, "KIS_APP_KEY": "fixture-key",
                            "KIS_APP_SECRET": "fixture-secret", "KIS_BASE_URL": "https://fixture.invalid"})
                        token = manager.get_access_token()
                        self.assertEqual(token, "fixture-cached-token" if mode == cached_mode else "fixture-issued-token")
                        self.assertEqual(issue.call_count, int(mode != cached_mode))
                        self.assertEqual(json.loads(fe_cache.read_text())["cacheKey"],
                                         f"{mode}:https://fixture.invalid:fixture-key")


class LocalMarketScalerParityTests(unittest.TestCase):
    def test_training_period_market_scaler_matches_local_completed_history(self):
        root = Path(__file__).resolve().parents[1]
        paths = {symbol: root / "outputs" / "market_index_history" / f"{symbol}.csv" for symbol in history.INDEX_CODES}
        scaler_path = root / "models" / "final_rank_ensemble" / "scaler.npz"
        if not scaler_path.is_file() or not all(path.is_file() for path in paths.values()):
            self.skipTest("Local index history and frozen market scaler are optional")
        from rank_ensemble import MARKET_COLS, market_features
        frames = {symbol: pd.read_csv(path, parse_dates=["date"]).set_index("date")[["Close", "Volume"]]
                  for symbol, path in paths.items()}
        sample = market_features(frames, "2024-09-26").loc["2019-12-20":"2024-09-26"]
        self.assertEqual(sample.shape, (1174, 10))
        self.assertEqual(list(sample.columns), MARKET_COLS)
        self.assertTrue(np.isfinite(sample.to_numpy()).all())
        with np.load(scaler_path, allow_pickle=False) as scaler:
            np.testing.assert_array_almost_equal(sample.mean().to_numpy(), scaler["market_mean"], decimal=5)
            np.testing.assert_array_almost_equal(sample.std(ddof=0).to_numpy(), scaler["market_std"], decimal=5)


if __name__ == "__main__":
    unittest.main()

"""Completed KIS index daily bars, with a shared OAuth cache and atomic local history.

Index Volume retains the provider's native unit. Only vrel20 uses it in the
frozen model. Like pykrx, blank/dash numeric fields become zero; explicit
nulls remain missing, and daily rows are never filled or dropped.
"""
from __future__ import annotations

import json
import math
import os
import tempfile
import time
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
HISTORY_START = pd.Timestamp("2019-06-03")
DEFAULT_CACHE_DIR = ROOT / "outputs" / "market_index_history"
INDEX_CODES = {"KPI200": "2001", "KOSPI": "0001"}
API_PATH = "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice"
TR_ID = "FHKUP03500100"
KIS_CONFIGURATION_HINT = ("MARKET_INDEX_SOURCE=kis 사용 시 KIS_ENV=real, 유효한 KIS 앱 키·시크릿과 실전 도메인 구성을 확인하세요. "
                          "KRX 인증 환경에서 기존 출처를 사용하려면 MARKET_INDEX_SOURCE=pykrx를 설정하세요. README.md 실행 요건을 참고하세요.")


def _atomic_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _shared_token_manager(env=None):
    # Reuse Python's credentials, session, token issuer and auth_headers. Bridge
    # the FE cache before issuance so FE -> Python -> supply uses the same token.
    from config import KISTokenManager, KISCredentials, KIS_BASE_URLS
    env = os.environ if env is None else env
    if env.get("KIS_ENV", "mock").strip().lower() != "real":
        raise ValueError("KIS index history requires KIS_ENV=real")
    key = (env.get("KIS_REAL_APP_KEY") or env.get("KIS_APP_KEY") or env.get("APP_KEY") or "").strip()
    secret = (env.get("KIS_REAL_APP_SECRET") or env.get("KIS_APP_SECRET") or env.get("APP_SECRET") or "").strip()
    if not key or not secret:
        raise ValueError("KIS index credentials are missing")

    class SharedTokenManager(KISTokenManager):
        def _load_cached_token(self):
            try:
                data = json.loads((ROOT / "FE" / ".kis-token-cache.json").read_text(encoding="utf-8"))
                expected = f"real:{self.base_url}:{self.credentials.app_key}"
                token, expires = data.get("accessToken"), float(data.get("expiresAt", 0)) / 1000
                if data.get("cacheKey") == expected and isinstance(token, str) and token and math.isfinite(expires) and expires - time.time() > 300:
                    self._access_token = token
                    self._expires_at_monotonic = time.monotonic() + expires - time.time()
                    super()._save_cached_token(token, expires)
                    return token
            except (OSError, ValueError, TypeError, AttributeError):
                pass
            token = super()._load_cached_token()
            if token:
                self._save_cached_token(token, time.time() + self._expires_at_monotonic - time.monotonic())
            return token

        def _save_cached_token(self, access_token, expires_at_epoch):
            super()._save_cached_token(access_token, expires_at_epoch)
            # If Python issued the token first, FE can reuse it on its next read.
            try:
                _atomic_text(ROOT / "FE" / ".kis-token-cache.json", json.dumps({
                    "accessToken": access_token,
                    "expiresAt": expires_at_epoch * 1000,
                    "cacheKey": f"real:{self.base_url}:{self.credentials.app_key}",
                }))
            except OSError:
                pass

    return SharedTokenManager(KISCredentials(key, secret), base_url=env.get("KIS_BASE_URL", KIS_BASE_URLS["real"]).rstrip("/"))


class KisIndexClient:
    def __init__(self, manager=None, interval=0.6, sleep=time.sleep, clock=time.monotonic, env=None):
        self.manager = manager
        self.env = env
        self.interval, self.sleep, self.clock = interval, sleep, clock
        self.last_request = None
        self.calls = 0

    def page(self, code: str, start: pd.Timestamp, end: pd.Timestamp):
        if self.manager is None:
            try:
                self.manager = _shared_token_manager(self.env)
            except Exception:
                raise RuntimeError("KIS index authentication configuration failed") from None
        try:
            headers = self.manager.auth_headers(TR_ID)
        except Exception:
            raise RuntimeError("KIS index authentication failed") from None
        params = {"FID_COND_MRKT_DIV_CODE": "U", "FID_INPUT_ISCD": code,
                  "FID_INPUT_DATE_1": start.strftime("%Y%m%d"),
                  "FID_INPUT_DATE_2": end.strftime("%Y%m%d"), "FID_PERIOD_DIV_CODE": "D"}
        reason = "request_failed"
        for attempt in range(3):
            if self.last_request is not None:
                self.sleep(max(0, self.interval - (self.clock() - self.last_request)))
            self.last_request = self.clock()
            self.calls += 1
            try:
                response = self.manager.session.get(self.manager.base_url + API_PATH,
                                                    headers=headers, params=params, timeout=20)
                response.raise_for_status()
                body = response.json()
                if not isinstance(body, dict) or body.get("rt_cd") != "0" or not isinstance(body.get("output2"), list):
                    raise ValueError("invalid_response")
                return body["output2"]
            except Exception:
                # Provider bodies, exceptions and headers can echo secrets.
                reason = "request_or_response_failed"
                if attempt < 2:
                    self.sleep(2 ** attempt)
        raise RuntimeError(f"KIS index {code} {start.date()}..{end.date()}: {reason} after 3 attempts") from None


def _number(value):
    if value is None:
        return float("nan")
    if isinstance(value, str) and value.strip() in {"", "-"}:
        return 0.0
    if isinstance(value, bool):
        raise ValueError("Malformed KIS index numeric field")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError("Malformed KIS index numeric field")
    return number


def _read_cache(path: Path):
    try:
        data = pd.read_csv(path, dtype={"date": str, "source": str, "collected_at": str})
        if list(data.columns) != ["date", "Close", "Volume", "source", "collected_at"] or data.empty:
            return None
        raw_dates = data.pop("date")
        dates = pd.to_datetime(raw_dates, format="%Y-%m-%d", errors="raise")
        if not dates.dt.strftime("%Y-%m-%d").eq(raw_dates).all():
            return None
        data.index = pd.DatetimeIndex(dates, name="Date")
        if data.index.has_duplicates or not data.index.is_monotonic_increasing or data.index[0] != HISTORY_START:
            return None
        if not data.source.eq("kis").all() or pd.to_datetime(data.collected_at, utc=True, errors="coerce").isna().any():
            return None
        for column in ("Close", "Volume"):
            data[column] = pd.to_numeric(data[column], errors="raise")
            if np.isinf(data[column]).any() or data[column].dropna().lt(0).any():
                return None
        return data
    except (OSError, ValueError, TypeError, KeyError):
        return None


def validate_calendars(frames):
    if not frames["KPI200"].index.equals(frames["KOSPI"].index):
        raise ValueError("Index calendars disagree; refusing a mixed-date ranking")


def record_metadata(frames, source, end, cache_dir=DEFAULT_CACHE_DIR, calls=None):
    _atomic_text(Path(cache_dir) / "latest-request.json", json.dumps({
        "market_index_source": source, "requestedEnd": str(pd.Timestamp(end).date()),
        "collectedAt": datetime.now(timezone.utc).isoformat(), "calls": calls,
        "indices": {symbol: {"rows": len(frame), "first": str(frame.index[0].date()),
                              "last": str(frame.index[-1].date()),
                              "missingClose": int(frame.Close.isna().sum()),
                              "missingVolume": int(frame.Volume.isna().sum()),
                              "zeroVolume": int(frame.Volume.eq(0).sum())}
                    for symbol, frame in frames.items()},
    }, indent=2))


def fetch_kis_history(end, cache_dir=DEFAULT_CACHE_DIR, client=None, env=None):
    end, cache_dir = pd.Timestamp(end).normalize(), Path(cache_dir)
    if end < HISTORY_START:
        raise ValueError("Completed index date precedes history anchor")
    client = client or KisIndexClient(env=env)
    collected_at = datetime.now(timezone.utc).isoformat()
    histories, persisted, calls = {}, {}, {}
    for symbol, code in INDEX_CODES.items():
        existing = _read_cache(cache_dir / f"{symbol}.csv")
        cached = existing.loc[:end] if existing is not None else None
        start = cached.index[-min(5, len(cached))] if cached is not None and len(cached) else HISTORY_START
        cursor, rows, seen, initial_calls = end, [], set(), client.calls
        while cursor >= start:
            page = client.page(code, start, cursor)
            if not page:
                break
            dates = []
            for row in page:
                try:
                    if not all(key in row for key in ("stck_bsop_date", "bstp_nmix_prpr", "acml_vol")):
                        raise ValueError()
                    raw_date = row["stck_bsop_date"]
                    if not isinstance(raw_date, str) or len(raw_date) != 8 or not raw_date.isdigit():
                        raise ValueError()
                    date = pd.to_datetime(raw_date, format="%Y%m%d", errors="raise")
                    if date.strftime("%Y%m%d") != raw_date:
                        raise ValueError()
                    dates.append(date)
                    if start <= date <= cursor and date not in seen:
                        rows.append({"date": date, "Close": _number(row.get("bstp_nmix_prpr")),
                                     "Volume": _number(row.get("acml_vol")),
                                     "source": "kis", "collected_at": collected_at})
                        seen.add(date)
                except (ValueError, TypeError, KeyError, OverflowError):
                    raise ValueError(f"Malformed KIS index daily bar: {symbol}") from None
            oldest = min(dates)
            if oldest > cursor:
                raise ValueError(f"KIS index pagination did not move backwards: {symbol}")
            cursor = oldest - timedelta(days=1)
        if not rows:
            raise ValueError(f"No completed index history: {symbol}")
        fresh = pd.DataFrame(rows).set_index("date").sort_index()
        fresh.index = pd.DatetimeIndex(fresh.index, name="Date")
        if cached is not None:
            recent = cached.loc[start:end]
            missing = recent.index.difference(fresh.index)
            if len(missing):
                warnings.warn(f"KIS {symbol} refresh omitted {len(missing)}/{len(recent)} cached sessions; preserving existing rows", RuntimeWarning, stacklevel=2)
            # Replace only rows actually returned; explicit nulls still overwrite older values.
            history = pd.concat([cached.loc[~cached.index.isin(fresh.index)], fresh]).sort_index()
        else:
            history = fresh
        if history.index[0] != HISTORY_START:
            raise ValueError(f"Incomplete KIS index history anchor: {symbol}")
        histories[symbol] = history
        # Historical requests only slice their return value, never truncate newer cache rows.
        persisted[symbol] = pd.concat([history, existing.loc[existing.index > end]]).sort_index() if existing is not None else history
        calls[symbol] = client.calls - initial_calls
        print(f"  [시장 이력] {symbol} source=kis rows={len(history)} {history.index[0].date()}..{history.index[-1].date()} requests={calls[symbol]}", flush=True)
    frames = {symbol: history[["Close", "Volume"]].copy() for symbol, history in histories.items()}
    validate_calendars(frames)
    validate_calendars(persisted)
    for symbol, history in persisted.items():
        _atomic_text(cache_dir / f"{symbol}.csv", history.reset_index().rename(columns={"Date": "date"}).to_csv(index=False))
    record_metadata(frames, "kis", end, cache_dir, calls)
    return frames

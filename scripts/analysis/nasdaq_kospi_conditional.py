"""Reproduce historical Nasdaq -> KOSPI conditional ratios (no trading calls)."""
from __future__ import annotations

import argparse
from bisect import bisect_left
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import random
import statistics
import sys
from urllib.error import URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


ROOT = Path(__file__).resolve().parents[2]
MODES = ("latest_prior", "previous_calendar_day")
TARGETS = ("close_to_close", "open_to_close")
TEAM = {
    "sample_count": 214,
    "quadrants": {
        "up_up": {"count": 85, "nasdaq_mean_pct": 1.01, "kospi_mean_pct": 2.62},
        "down_down": {"count": 53, "nasdaq_mean_pct": -1.06, "kospi_mean_pct": -3.4},
        "up_down": {"count": 31, "nasdaq_mean_pct": 0.71, "kospi_mean_pct": -2.45},
        "down_up": {"count": 45, "nasdaq_mean_pct": -0.69, "kospi_mean_pct": 1.73},
    },
    "source": "User-supplied team summary; raw observations and exact period unavailable",
}


class DataError(RuntimeError):
    """Missing, malformed, or unavailable source data."""


def parse_chart(payload, symbol):
    chart = payload.get("chart", {})
    if chart.get("error") or not chart.get("result"):
        raise DataError(f"{symbol}: Yahoo chart error or empty result")
    try:
        result = chart["result"][0]
        expected_zone = {"^IXIC": "America/New_York", "^KS11": "Asia/Seoul"}[symbol]
        if result["meta"]["exchangeTimezoneName"] != expected_zone:
            raise DataError(f"{symbol}: unexpected exchange timezone")
        zone = ZoneInfo(expected_zone)
        timestamps = result["timestamp"]
        quotes = result["indicators"]["quote"][0]
        if not timestamps or any(len(quotes[k]) != len(timestamps) for k in ("open", "close")):
            raise DataError(f"{symbol}: missing or unequal OHLC arrays")
        rows = []
        for stamp, opening, close in zip(timestamps, quotes["open"], quotes["close"]):
            day = datetime.fromtimestamp(stamp, zone).date().isoformat()
            if any(v is not None and (not math.isfinite(v) or v <= 0) for v in (opening, close)):
                raise DataError(f"{symbol} {day}: invalid open/close")
            # Retain null sessions so previous-close calculations cannot bridge them.
            rows.append({"date": day, "open": float(opening) if opening is not None else None,
                         "close": float(close) if close is not None else None})
        if len({r["date"] for r in rows}) != len(rows):
            raise DataError(f"{symbol}: duplicate session dates")
        return sorted(rows, key=lambda r: r["date"])
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        raise DataError(f"{symbol}: invalid Yahoo daily OHLC response") from exc


def fetch_daily(symbol, start, end):
    # UTC midnight minus one day includes Asian sessions at the lower boundary.
    params = {"period1": int(datetime.combine(start - timedelta(days=1), time(), timezone.utc).timestamp()),
              "period2": int(datetime.combine(end + timedelta(days=1), time(), timezone.utc).timestamp()),
              "interval": "1d", "includePrePost": "false", "events": "history"}
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol, safe='')}?{urlencode(params)}"
    try:
        with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as response:
            body = response.read()
        rows = parse_chart(json.loads(body), symbol)
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise DataError(f"{symbol}: Yahoo daily download failed ({type(exc).__name__}); no result written") from exc
    rows = [r for r in rows if start.isoformat() <= r["date"] <= end.isoformat()]
    if not rows:
        raise DataError(f"{symbol}: no daily observations in requested interval")
    if (end - date.fromisoformat(rows[-1]["date"])).days > 10:
        raise DataError(f"{symbol}: source ends at {rows[-1]['date']}; requested end {end} is not covered")
    return {"symbol": symbol, "url": url, "response_sha256": hashlib.sha256(body).hexdigest(),
            "retrieved_at_utc": datetime.now(timezone.utc).isoformat(), "rows": rows,
            "first_date": rows[0]["date"], "last_date": rows[-1]["date"], "count": len(rows),
            "missing_price_dates": [r["date"] for r in rows if r["open"] is None or r["close"] is None]}


def align_sessions(nasdaq, kospi, start, end, mode="latest_prior"):
    """Only US dates strictly before Korean D can be used; never shift joined rows."""
    if mode not in MODES:
        raise ValueError(f"Unknown alignment: {mode}")
    nasdaq = sorted(nasdaq, key=lambda r: r["date"])
    kospi = sorted(kospi, key=lambda r: r["date"])
    us_dates = [r["date"] for r in nasdaq]
    pairs = []
    excluded = Counter()
    for index, kr in enumerate(kospi):
        day = date.fromisoformat(kr["date"])
        if not start <= day <= end:
            continue
        us_index = bisect_left(us_dates, kr["date"]) - 1
        if index == 0 or us_index < 1:
            excluded["missing_previous_close"] += 1
            continue
        us = nasdaq[us_index]
        lag = (day - date.fromisoformat(us["date"])).days
        if mode == "previous_calendar_day" and lag != 1:
            excluded["no_previous_calendar_day_us_session"] += 1
            continue
        if any(v is None for v in (kr["open"], kr["close"], kospi[index - 1]["close"],
                                    us["close"], nasdaq[us_index - 1]["close"])):
            excluded["missing_required_price"] += 1
            continue
        pairs.append({"kospi_date": kr["date"], "nasdaq_date": us["date"], "lag_calendar_days": lag,
                      "nasdaq_return": us["close"] / nasdaq[us_index - 1]["close"] - 1,
                      "close_to_close": kr["close"] / kospi[index - 1]["close"] - 1,
                      "open_to_close": kr["close"] / kr["open"] - 1})
    return pairs, dict(excluded)


def sign(value):
    return "up" if value > 0 else "down" if value < 0 else "flat"


def ratio_values(signs):
    n = len(signs)
    if not n:
        return {}
    up = sum(k > 0 for _, k in signs) / n
    down = sum(k < 0 for _, k in signs) / n
    nu = sum(u > 0 for u, _ in signs)
    nd = sum(u < 0 for u, _ in signs)
    uu = sum(u > 0 and k > 0 for u, k in signs) / nu if nu else None
    dd = sum(u < 0 and k < 0 for u, k in signs) / nd if nd else None
    return {"kospi_up_baseline": up, "kospi_down_baseline": down,
            "kospi_up_given_nasdaq_up": uu, "kospi_down_given_nasdaq_down": dd,
            "up_lift_vs_baseline": uu - up if uu is not None else None,
            "down_lift_vs_baseline": dd - down if dd is not None else None,
            "same_direction": sum(u * k > 0 for u, k in signs) / n}


def percentile(values, p):
    values = sorted(values)
    position = (len(values) - 1) * p
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def summarize(pairs, target, repetitions=2000, seed=20261023, block_length=5):
    signs = [(1 if p["nasdaq_return"] > 0 else -1 if p["nasdaq_return"] < 0 else 0,
              1 if p[target] > 0 else -1 if p[target] < 0 else 0) for p in pairs]
    if not signs:
        raise DataError(f"No aligned observations for {target}")
    quadrants = {}
    for key in ("up_up", "down_down", "up_down", "down_up"):
        group = [p for p in pairs if f"{sign(p['nasdaq_return'])}_{sign(p[target])}" == key]
        quadrants[key] = {"count": len(group),
                          "nasdaq_mean_pct": statistics.fmean(p["nasdaq_return"] for p in group) * 100 if group else None,
                          "kospi_mean_pct": statistics.fmean(p[target] for p in group) * 100 if group else None}
    values = ratio_values(signs)
    boot = {key: [] for key in values}
    rng = random.Random(seed)
    # Circular moving blocks preserve short runs and repeated holiday mappings.
    n = len(signs)
    for _ in range(repetitions):
        sample = []
        while len(sample) < n:
            offset = rng.randrange(n)
            sample.extend(signs[(offset + j) % n] for j in range(min(block_length, n - len(sample))))
        for key, value in ratio_values(sample).items():
            if value is not None:
                boot[key].append(value * 100)
    metrics = {}
    for key, value in values.items():
        metrics[key] = {"value": value * 100 if value is not None else None,
                        "unit": "percentage_points" if "lift" in key else "percent",
                        "ci95": [percentile(boot[key], .025), percentile(boot[key], .975)] if boot[key] else None,
                        "bootstrap_valid_replicates": len(boot[key])}
    denominators = {"kospi_up_given_nasdaq_up": sum(u > 0 for u, _ in signs),
                    "kospi_down_given_nasdaq_down": sum(u < 0 for u, _ in signs)}
    numerators = {"kospi_up_given_nasdaq_up": quadrants["up_up"]["count"],
                  "kospi_down_given_nasdaq_down": quadrants["down_down"]["count"]}
    for key in ("kospi_up_baseline", "kospi_down_baseline", "same_direction"):
        denominators[key] = n
        numerators[key] = (sum(k > 0 for _, k in signs) if key == "kospi_up_baseline" else
                           sum(k < 0 for _, k in signs) if key == "kospi_down_baseline" else
                           sum(u * k > 0 for u, k in signs))
    for key in denominators:
        metrics[key].update(numerator=numerators[key], denominator=denominators[key])
    return {"sample_count": n, "flat_count": sum(u == 0 or k == 0 for u, k in signs),
            "quadrants": quadrants, "metrics": metrics}


def build_result(start, end, sources, repetitions, seed, block_length):
    nasdaq, kospi = sources["nasdaq"]["rows"], sources["kospi"]["rows"]
    try:
        three_year_start = end.replace(year=end.year - 3)
    except ValueError:
        three_year_start = end.replace(year=end.year - 3, day=28)
    periods = []
    for name, lower in (("requested", start), ("three_year", three_year_start)):
        alignments = {}
        for mode in MODES:
            pairs, excluded = align_sessions(nasdaq, kospi, lower, end, mode)
            alignments[mode] = {"excluded": excluded, "sample_count": len(pairs),
                                "first_kospi_date": pairs[0]["kospi_date"] if pairs else None,
                                "last_kospi_date": pairs[-1]["kospi_date"] if pairs else None,
                                "lag_calendar_days_counts": dict(sorted(Counter(p["lag_calendar_days"] for p in pairs).items())),
                                "unique_nasdaq_sessions": len({p["nasdaq_date"] for p in pairs}),
                                "definitions": {t: summarize(pairs, t, repetitions, seed, block_length) for t in TARGETS}}
        periods.append({"name": name, "start": lower.isoformat(), "end": end.isoformat(),
                        "bounds": "inclusive", "alignments": alignments})
    result = {"schema_version": 1, "generated_at_utc": datetime.now(timezone.utc).isoformat(),
              "status": "partial_missing_prices" if any(s.get("missing_price_dates") for s in sources.values()) else "ok",
              "source": "Yahoo Finance v8 chart daily unadjusted open/close",
              "sources": sources, "definitions": {
                  "nasdaq_return": "close(U) / close(previous US session) - 1",
                  "close_to_close": "close(D) / close(previous KOSPI session) - 1",
                  "open_to_close": "close(D) / open(D) - 1; same horizon as next_session_open_to_close",
                  "latest_prior": "U = max(US session date < Korean session date D); holidays/weekends carry latest US session",
                  "previous_calendar_day": "U must equal D minus one calendar day; otherwise exclude D",
                  "flat_policy": "Exact zero is flat: kept in baseline/conditional denominators, excluded from four quadrants and directional agreement numerator",
                  "baseline": "Unconditional KOSPI sign ratio on exactly the same aligned sample; down lift uses the down baseline",
                  "missing_policy": "Keep null source rows; exclude a matched pair if either target or either native previous close is missing. Both targets use identical complete-case samples; never fill prices or bridge a null session",
                  "units": "Returns in percent; ratio value and CI in percent; lift in percentage points"},
              "confidence_interval": {"method": "circular moving-block percentile bootstrap", "confidence": .95,
                                      "repetitions": repetitions, "seed": seed, "block_length_observations": block_length,
                                      "limitations": "Exploratory; overlapping 1y/3y periods; no multiple-testing correction; block length is a sensitivity assumption"},
              "team_claim": TEAM, "periods": periods,
              "limitations": ["Past association, not causality or a guarantee of future performance",
                              "Yahoo is a single vendor; missing entire sessions cannot be distinguished from exchange holidays without an independent exchange calendar",
                              "Holiday carry-forward can reuse US sessions; close-to-close includes the already-realized Korean opening gap",
                              "No transaction costs, individual-stock transfer, or out-of-sample predictive test"]}
    result["team_comparison"] = {}
    for mode, alignment in periods[0]["alignments"].items():
        for target, summary in alignment["definitions"].items():
            result["team_comparison"][f"{mode}/{target}"] = {
                "sample_count_delta": summary["sample_count"] - TEAM["sample_count"],
                "quadrant_deltas": {key: {field: actual[field] - claimed[field]
                                          if actual[field] is not None else None for field in claimed}
                                    for key, claimed in TEAM["quadrants"].items()
                                    for actual in [summary["quadrants"][key]]}}
    primary = periods[0]["alignments"]["latest_prior"]["definitions"]["open_to_close"]
    m = primary["metrics"]
    u = m["kospi_up_given_nasdaq_up"]
    b = m["kospi_up_baseline"]
    result["briefing_recommendation"] = (
        f"참고 통계: {start}~{end} 코스피 {primary['sample_count']}거래일에서, 직전 나스닥 상승 후 코스피 시가→종가 상승 비율은 "
        f"{u['value']:.1f}%({u['numerator']}/{u['denominator']}일, 95% 블록 부트스트랩 구간 {u['ci95'][0]:.1f}~{u['ci95'][1]:.1f}%)였고, "
        f"같은 표본의 전체 상승일 비율은 {b['value']:.1f}%였습니다. "
        "휴장일에는 가장 최근 미국장을 연결하고 결측 가격이 있는 관측은 제외한 과거 통계이며, 인과관계나 향후 예측을 보장하지 않습니다.") if u['value'] is not None else "표본 내 나스닥 상승일이 없어 조건부 상승 비율을 산출할 수 없습니다."
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2025, 10, 22))
    parser.add_argument("--end", type=date.fromisoformat, default=date(2026, 10, 22))
    parser.add_argument("--output", type=Path, default=ROOT / "materials/reports/macro-nasdaq-kospi/result.json")
    parser.add_argument("--bootstrap", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=20261023)
    parser.add_argument("--block-length", type=int, default=5)
    parser.add_argument("--source-json", type=Path, help="Replay embedded daily observations from a prior result, without network")
    args = parser.parse_args(argv)
    if args.start > args.end or args.bootstrap < 100 or args.block_length < 1:
        parser.error("start must not exceed end; bootstrap >= 100; block-length >= 1")
    if args.end >= datetime.now(timezone(timedelta(hours=9))).date():
        parser.error("end must be before today's Korean date to avoid incomplete sessions")
    try:
        three_start = args.end.replace(year=args.end.year - 3, day=28 if args.end.month == 2 and args.end.day == 29 else args.end.day)
        fetch_start = min(args.start, three_start) - timedelta(days=30)
        if args.source_json:
            sources = json.loads(args.source_json.read_text(encoding="utf-8"))["sources"]
            for source in sources.values():
                if source["first_date"] >= min(args.start, three_start).isoformat() or source["last_date"] < (args.end - timedelta(days=10)).isoformat():
                    raise DataError("Saved source observations do not cover the requested period and warmup")
        else:
            sources = {"nasdaq": fetch_daily("^IXIC", fetch_start, args.end),
                       "kospi": fetch_daily("^KS11", fetch_start, args.end)}
        result = build_result(args.start, args.end, sources, args.bootstrap, args.seed, args.block_length)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(f"Wrote {args.output}")
        print(result["briefing_recommendation"])
        return 0
    except (DataError, ZoneInfoNotFoundError, OSError, KeyError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

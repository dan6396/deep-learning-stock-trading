"""Freeze text-free event labels for an authorized-price exact replay.

This does not publish article bodies, headlines, links, or market prices.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "outputs/news_guarded_calendar3_v2"
NEWS_SOURCE = ROOT / "outputs/news_regimes_calendar3_bounded"
BARS = (ROOT / "../../outputs/validation_report/inputs/daily_bars.parquet").resolve()
DEST = ROOT / "research/regime_benchmark/published/frozen_replay"
EVENT_KEYS = ("article_id", "event_type", "sentiment", "age_calendar_days", "gate")
PANEL_COLUMNS = ("date", "entry_date", "ticker", "huber_ensemble", "accepted_articles", "audited_evidence")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_bars_hash(bars: pd.DataFrame, panel: pd.DataFrame) -> tuple[str, int]:
    """Hash all needed entry-session prices, independent of CSV/parquet bytes."""
    required = {"date", "ticker", "Open", "Close", "Volume"}
    if not required.issubset(bars):
        raise ValueError(f"Bars require {sorted(required)}")
    keys = panel[["entry_date", "ticker"]].copy()
    keys["entry_date"] = pd.to_datetime(keys.entry_date).dt.normalize()
    keys["ticker"] = keys.ticker.astype(str).str.zfill(6)
    if keys.duplicated().any():
        raise ValueError("Duplicate panel stock-session key")
    prices = bars[["date", "ticker", "Open", "Close", "Volume"]].copy()
    prices["entry_date"] = pd.to_datetime(prices.date).dt.normalize()
    prices["ticker"] = prices.ticker.astype(str).str.zfill(6)
    prices = prices.drop(columns="date")
    if prices[["entry_date", "ticker"]].duplicated().any():
        raise ValueError("Duplicate local price stock-session key")
    joined = keys.merge(prices, on=["entry_date", "ticker"], how="left", validate="one_to_one")
    if joined[["Open", "Close", "Volume"]].isna().any().any():
        raise ValueError("Local bars do not cover every frozen stock-session")
    if (joined[["Open", "Close"]] <= 0).any().any() or (joined.Volume < 0).any():
        raise ValueError("Local bars contain non-positive prices or negative volume")
    digest = hashlib.sha256()
    for row in joined.sort_values(["entry_date", "ticker"]).itertuples(index=False):
        fields = (row.entry_date.strftime("%Y-%m-%d"), row.ticker,
                  format(float(row.Open), ".17g"), format(float(row.Close), ".17g"),
                  format(float(row.Volume), ".17g"))
        digest.update((",".join(fields) + "\n").encode("ascii"))
    return digest.hexdigest(), len(joined)


def freeze() -> dict:
    source_panel = SOURCE / "scored_panel.parquet"
    source_protocol = SOURCE / "protocol.json"
    source_requests = NEWS_SOURCE / "article_requests.json"
    source_bodies = NEWS_SOURCE / "body_articles.json"
    panel = pd.read_parquet(source_panel)
    accepted_count = 0
    cleaned_audit = []
    for raw in panel.audited_evidence:
        accepted = [{key: event[key] for key in EVENT_KEYS}
                    for event in json.loads(raw) if event["gate"] == "accepted"]
        accepted_count += len(accepted)
        cleaned_audit.append(json.dumps(accepted, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    if accepted_count != int(panel.accepted_articles.sum()):
        raise ValueError("Accepted event count mismatch")
    frozen = panel[list(PANEL_COLUMNS)].copy()
    frozen["audited_evidence"] = cleaned_audit
    frozen["ticker"] = frozen.ticker.astype(str).str.zfill(6)
    requests = json.loads(source_requests.read_text(encoding="utf-8"))
    bodies = json.loads(source_bodies.read_text(encoding="utf-8"))
    frozen_requests = [{key: item[key] for key in ("entry_date", "ticker", "parent_article_id")}
                       for item in requests]
    frozen_bodies = [{key: item[key] for key in ("article_id", "parent_article_id")}
                     for item in bodies]
    protocol = json.loads(source_protocol.read_text(encoding="utf-8"))
    frozen_protocol = {"version": "text-free-event-replay-v1",
                       "selected_entry_dates": protocol["selected_entry_dates"]}
    bars_hash, bar_rows = canonical_bars_hash(pd.read_parquet(BARS), frozen)
    DEST.mkdir(parents=True, exist_ok=True)
    files = {
        "scored_panel.parquet": frozen,
        "article_requests.json": frozen_requests,
        "body_articles.json": frozen_bodies,
        "protocol.json": frozen_protocol,
    }
    for name, value in files.items():
        path = DEST / name
        if isinstance(value, pd.DataFrame):
            value.to_parquet(path, index=False)
        else:
            path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                            encoding="utf-8")
    manifest = {
        "version": "text-free-event-replay-v1",
        "panel_rows": len(frozen),
        "accepted_events": accepted_count,
        "article_request_rows": len(frozen_requests),
        "body_link_rows": len(frozen_bodies),
        "required_price_rows": bar_rows,
        "required_price_columns": ["date", "ticker", "Open", "Close", "Volume"],
        "required_prices_canonical_sha256": bars_hash,
        "frozen_files_sha256": {name: sha256(DEST / name) for name in files},
        "original_source_sha256": {"scored_panel.parquet": sha256(source_panel),
                                   "protocol.json": sha256(source_protocol),
                                   "article_requests.json": sha256(source_requests),
                                   "body_articles.json": sha256(source_bodies),
                                   "daily_bars.parquet": sha256(BARS)},
        "exclusions": ["article text", "headlines", "URLs", "raw prices", "per-stock realized returns", "API keys"],
        "scope": "Exact numeric fusion and portfolio replay with identical authorized prices; not raw-news extraction",
    }
    (DEST / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


if __name__ == "__main__":
    result = freeze()
    print(f"Frozen {result['panel_rows']} stock-session rows and {result['accepted_events']} text-free events")

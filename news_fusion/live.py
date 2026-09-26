"""Live, bounded news evidence for the frozen Huber ranking.

The LLM extracts article facts only. An inactive validation gate keeps final
ranking equal to Huber until a future, independent news test supports activation.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .gemini import GeminiExtractor, load_key
from .guarded import AGE_STRENGTH
from .news import digest, normalize_title

KST = timezone(timedelta(hours=9))
MANIFEST = Path(__file__).resolve().parents[1] / "models/news_event_residual_v1/manifest.json"
PRICE_CANDIDATES = 20
INDEPENDENT_CANDIDATES = 10
MAX_ARTICLES_PER_CANDIDATE = 1
MAX_LLM_CALLS = 30
BROAD_QUERIES = ("상장사 실적 발표", "상장사 신규 수주", "상장사 자사주 배당")


def _float(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _discover_independent(pool, decision_at, count, days):
    """One small broad headline pass can introduce names outside price top20."""
    from crolling import clean_html, fetch_naver_news_once, parse_naver_pubdate

    names = [(str(row.ticker).zfill(6), str(row.company_name).strip()) for row in pool.itertuples()]
    hits = {}
    for query in BROAD_QUERIES:
        try:
            raw = fetch_naver_news_once(query, display=100)
        except Exception:
            continue
        for item in raw:
            published = parse_naver_pubdate(item.get("pubDate", ""))
            if published is None or not (decision_at - timedelta(days=days) <= published < decision_at):
                continue
            headline = clean_html(item.get("title", ""))
            for ticker, company in names:
                if len(company) >= 3 and company in headline:
                    hits.setdefault(ticker, set()).add(normalize_title(headline))
    return [ticker for ticker, _ in sorted(hits.items(), key=lambda x: (-len(x[1]), x[0]))[:count]]


def _news_for_stock(ticker, company, decision_at, extractor, days, max_articles):
    from crolling import fetch_article_body, fetch_recent_news_for_stock

    articles = fetch_recent_news_for_stock(ticker, company, custom_query=company,
                                           days=days, max_news=5, fetch_body=False)
    seen = set()
    selected = []
    for article in articles:
        published = datetime.fromisoformat(article["pub_date"])
        if not (decision_at - timedelta(days=days) <= published < decision_at):
            continue
        title_key = normalize_title(article["title"])
        if title_key in seen:
            continue
        seen.add(title_key)
        body = fetch_article_body(article["url"])
        if not body or len(body) > 30000:
            continue  # Never substitute a headline for a missing body.
        payload = {"article_id": digest({"ticker": ticker, "url": article["url"],
                                         "published": article["pub_date"], "body": body}),
                   "ticker": ticker, "company_name": company, "text": body,
                   "text_scope": "publisher_body"}
        try:
            extracted = extractor.extract(payload)["result"]
        except RuntimeError:
            break
        selected.append({"title": article["title"], "url": article["url"],
                         "source": article["source"], "pub_date": article["pub_date"],
                         "sentiment": extracted["sentiment"], "relevance": extracted["relevance"],
                         "event_type": extracted["event_type"], "reason": extracted["reason"],
                         "evidence_quote": extracted["evidence_quote"]})
        if len(selected) >= max_articles:
            break
    return selected


def _event_features(items, target_date, manifest, price_context):
    features = {name: 0.0 for name in manifest["feature_columns"]}
    accepted = []
    for item in items:
        if item["relevance"] != "direct" or item["sentiment"] not in ("positive", "negative"):
            continue
        name = f"{item['event_type']}_{item['sentiment']}"
        if name not in manifest["event_columns"]:
            continue
        age = (target_date - datetime.fromisoformat(item["pub_date"]).date()).days
        if age not in AGE_STRENGTH or not item["evidence_quote"]:
            continue
        features[name] = min(2.0, features[name] + AGE_STRENGTH[age])
        accepted.append(item)
    for name in manifest["event_columns"]:
        features[f"context_{name}"] = features[name] * price_context
    return features, accepted


def rank_with_news(rank_df: pd.DataFrame, output_dir: Path, days: int = 3,
                   max_news: int = 1) -> tuple[pd.DataFrame, dict]:
    """Return final top-five rows and UI evidence keyed by ticker."""
    output_dir = Path(output_dir)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest["version"] != "event-residual-v1" or len(manifest["coefficients"]) != len(manifest["feature_columns"]):
        raise ValueError("Invalid frozen news model manifest")
    valid = rank_df.loc[rank_df.prediction_status.eq("ok")].copy()
    valid["ticker"] = valid.ticker.astype(str).str.zfill(6)
    valid = valid.sort_values(["ensemble_pred_return", "ticker"], ascending=[False, True])
    if len(valid) < 5:
        raise ValueError("At least five valid Huber forecasts are required")
    days = max(1, min(int(days), 3))
    max_articles = max(1, min(int(max_news), MAX_ARTICLES_PER_CANDIDATE))
    valid["price_context"] = valid.ensemble_pred_return.rank(pct=True) - .5
    base_dates = pd.to_datetime(valid.prediction_base_date, errors="coerce").dt.date.dropna().unique()
    if len(base_dates) != 1:
        raise ValueError("News cutoff requires one common price prediction_base_date")
    target_date = (pd.Timestamp(base_dates[0]) + pd.offsets.BDay(1)).date()
    # A historical/late refresh must not consume articles published after the
    # next intended session opened. Holidays may make this cutoff conservative.
    next_open = datetime.combine(target_date, time(8, 59, 59), tzinfo=KST)
    decision_at = min(datetime.now(KST), next_open)
    try:
        api_key = load_key(".env.news_fusion")
    except ValueError:
        api_key = None
    candidates = list(valid.ticker.head(PRICE_CANDIDATES))
    extras = _discover_independent(valid, decision_at, INDEPENDENT_CANDIDATES, days) if api_key else []
    candidates += [ticker for ticker in extras if ticker not in candidates]
    by_ticker = valid.set_index("ticker")
    extractor = (GeminiExtractor(api_key, output_dir / "news_event_cache", max_calls=MAX_LLM_CALLS, interval=3)
                 if api_key else None)
    details = {}
    corrections = {}
    for ticker in candidates:
        row = by_ticker.loc[ticker]
        items = []
        status = "api_key_missing" if extractor is None else "no_usable_article"
        if extractor is not None and not extractor.stopped and extractor.calls < extractor.max_calls:
            try:
                items = _news_for_stock(ticker, str(row.company_name), decision_at, extractor, days, max_articles)
                status = "analyzed" if items else "no_usable_article"
            except Exception:
                status = "news_fetch_failed"
        elif extractor is not None:
            status = "api_budget_reached"
        features, accepted = _event_features(items, target_date, manifest, float(row.price_context))
        vector = np.array([features[name] for name in manifest["feature_columns"]], float)
        raw_delta = float(np.clip(vector @ np.array(manifest["coefficients"], float),
                                  -float(manifest["max_delta"]), float(manifest["max_delta"])))
        applied = bool(manifest["active"] and accepted)
        corrections[ticker] = raw_delta if applied else 0.0
        details[ticker] = {"ticker": ticker, "company_name": str(row.company_name),
                           "news": items, "news_count": len(items), "accepted_events": len(accepted),
                           "status": status, "applied": applied, "raw_news_delta": raw_delta,
                           "news_delta": corrections[ticker],
                           "activation_reason": manifest["activation_reason"],
                           "decision_at": decision_at.isoformat(),
                           "prediction_target_date_approx": target_date.isoformat()}
    valid["news_delta"] = valid.ticker.map(corrections).fillna(0.0)
    valid["final_pred_return"] = valid.ensemble_pred_return + valid.news_delta
    valid = valid.sort_values(["final_pred_return", "ticker"], ascending=[False, True]).reset_index(drop=True)
    valid["final_rank"] = np.arange(1, len(valid) + 1)
    valid["final_rank_percentile"] = 100 * (len(valid) - valid.final_rank) / max(len(valid) - 1, 1)
    top = valid.head(5).copy()
    for row in valid.itertuples():
        if row.ticker in details:
            details[row.ticker].update(price_score=float(row.ensemble_pred_return),
                                       final_score=float(row.final_pred_return),
                                       final_rank=int(row.final_rank),
                                       final_rank_percentile=float(row.final_rank_percentile))
    return top, details

"""Price-independent news discovery and bounded, auditable late fusion.

These are frozen heuristic ranking experiments, not trained return forecasts.
Candidate selection never receives return labels or post-decision articles.
"""
from __future__ import annotations
import json
import re
from difflib import SequenceMatcher
import numpy as np
import pandas as pd
from .news import digest, eligible, normalize_title, timestamp

EVENT_TERMS = {
    'earnings': ['실적', '영업이익', '순이익', '매출', '흑자', '적자'],
    'contract': ['수주', '공급계약', '계약 체결', '계약체결'],
    'capital': ['유상증자', '전환사채', '자사주', '배당', '인수', '합병'],
    'legal': ['소송', '과징금', '압수수색', '횡령', '배임', '영업정지'],
    'product': ['품목허가', '임상', '리콜', '생산중단', '공장 가동'],
}
IRRELEVANT = ['프로농구', '프로야구', '농구단', '축구단', '경기 승리', '시구']


def headline_priority(article, decision, mode='exploratory'):
    """Unsigned event importance, NOT sentiment or price momentum."""
    title = article['title']
    name = normalize_title(article['company_name'])
    if not name or name not in normalize_title(title) or any(x in title for x in IRRELEVANT):
        return 0.
    events = sum(any(term in title for term in terms) for terms in EVENT_TERMS.values())
    if not events:
        return 0.
    age = (timestamp(decision).normalize()-timestamp(article['published_at']).normalize()).days*24. if mode == 'calendar_lookback' else max(0., (timestamp(decision) - timestamp(article['published_at'])).total_seconds()/3600)
    return float(events + .25 * np.exp(-age/24.))


def representatives(articles):
    """Conservative near-headline dedup; distinct numeric facts stay distinct.

    Only articles eligible at the current decision may be passed here. This is
    lexical deduplication, not a claim of complete semantic event clustering.
    """
    kept = []
    for article in sorted(articles, key=lambda a: (timestamp(a['published_at']), a['article_id'])):
        title = normalize_title(article['title'])
        numbers = re.findall(r'\d+(?:[.,]\d+)*', article['title'])
        duplicate = any(a['ticker'] == article['ticker'] and
            re.findall(r'\d+(?:[.,]\d+)*', a['title']) == numbers and
            SequenceMatcher(None, title, normalize_title(a['title'])).ratio() >= .85 for a in kept)
        if not duplicate:
            kept.append(article)
    return kept


def candidate_plan(predictions, articles, price_n=20, news_n=10, mode='exploratory'):
    cols = ['date', 'entry_date', 'ticker', 'huber_ensemble']
    p = predictions[cols].copy()
    p['ticker'] = p.ticker.astype(str).str.zfill(6)
    if p.duplicated(['entry_date', 'ticker']).any() or not np.isfinite(p.huber_ensemble).all():
        raise ValueError('Invalid price panel')
    if not (pd.to_datetime(p.date) < pd.to_datetime(p.entry_date)).all():
        raise ValueError('Price signal must precede decision')
    by_ticker = {}
    for article in articles:
        by_ticker.setdefault(article['ticker'], []).append(article)
    rows, requests, chosen = [], [], {}
    for date, group in p.groupby('entry_date', sort=True):
        decision = timestamp(date) + pd.Timedelta(hours=8, minutes=30)
        group = group.sort_values(['huber_ensemble', 'ticker'], ascending=[False, True]).copy()
        group['price_rank'] = np.arange(1, len(group)+1)
        # Price percentile in [-1,1], same fixed range as sentiment, no test fitting.
        group['price_score'] = 1 - 2*(group.price_rank-1)/max(1, len(group)-1)
        matches, priorities = {}, {}
        for ticker in group.ticker:
            raw = [a for a in by_ticker.get(ticker, []) if eligible(a, decision, mode=mode)]
            matches[ticker] = representatives(raw)
            matches[ticker].sort(key=lambda a: (-headline_priority(a, decision, mode),
                -timestamp(a['published_at']).timestamp(), a['article_id']))
            priorities[ticker] = max((headline_priority(a, decision, mode) for a in matches[ticker]), default=0.)
        news = sorted((t for t in group.ticker if priorities[t] > 0), key=lambda t: (-priorities[t], t))[:news_n]
        for record in group.to_dict('records'):
            ticker = record['ticker']
            record.update(decision_at=decision.isoformat(), in_price_pool=record['price_rank'] <= price_n,
                in_news_pool=ticker in news, news_discovery_priority=priorities[ticker],
                discovered_representatives=len(matches[ticker]))
            rows.append(record)
            if record['in_price_pool'] or record['in_news_pool']:
                for slot, article in enumerate(matches[ticker][:2], 1):
                    chosen[article['article_id']] = article
                    requests.append({'entry_date':str(pd.Timestamp(date).date()), 'ticker':ticker,
                        'decision_at':decision.isoformat(), 'parent_article_id':article['article_id'],
                        'slot':slot, 'headline_priority':headline_priority(article, decision, mode)})
    return pd.DataFrame(rows), requests, list(chosen.values())


def features_for(plan, requests, bodies, extractions, pool, article_count, mode='exploratory'):
    if pool not in ['price20', 'union'] or article_count not in [1, 2]:
        raise ValueError('Unsupported candidate or article policy')
    body_map = {r['parent_article_id']:r for r in bodies}
    label_map = {r['article_id']:r for r in extractions}
    req = {}
    for record in requests:
        if record['slot'] <= article_count:
            req.setdefault((record['entry_date'], record['ticker']), []).append(record)
    result = []
    for row in plan.to_dict('records'):
        candidate = row['in_price_pool'] or (pool == 'union' and row['in_news_pool'])
        statuses, evidence, signals, weights, body_ids, parent_ids = [], [], [], [], [], []
        key = (str(pd.Timestamp(row['entry_date']).date()), row['ticker'])
        for request in req.get(key, []) if candidate else []:
            parent_ids.append(request['parent_article_id'])
            body = body_map.get(request['parent_article_id'])
            if not body or body['status'] != 'body_extracted':
                statuses.append('body_unavailable'); continue
            article = body['article']
            if not eligible(article, row['decision_at'], mode=mode):
                statuses.append('time_excluded'); continue
            if article['article_id'] in body_ids:
                continue
            body_ids.append(article['article_id'])
            extracted = label_map.get(article['article_id'])
            if extracted is None:
                statuses.append('analysis_rejected'); continue
            if extracted['input_sha256'] != digest(article['text']):
                raise ValueError('Cached analysis text does not match body')
            label = extracted['result']
            if label['insufficient_context'] or label['relevance'] not in ['direct', 'indirect'] or label['sentiment'] == 'unclear':
                statuses.append('insufficient_or_irrelevant'); continue
            value = {'positive':1., 'neutral':0., 'negative':-1.}[label['sentiment']]
            relevance = 1. if label['relevance'] == 'direct' else .5
            age = (timestamp(row['decision_at']).normalize()-timestamp(article['published_at']).normalize()).days*24. if mode == 'calendar_lookback' else (timestamp(row['decision_at'])-timestamp(article['published_at'])).total_seconds()/3600
            signals.append(value*relevance); weights.append(np.exp(-age/24.))
            statuses.append('usable')
            evidence.append({'article_id':article['article_id'], 'title':article['title'], 'url':article['url'],
                'sentiment':label['sentiment'], 'event_type':label['event_type'], 'relevance':label['relevance'],
                'evidence_quote':label['evidence_quote'], 'reason':label['reason']})
        row.update(candidate=candidate, news_signal=float(np.average(signals, weights=weights)) if signals else 0.,
            usable_articles=len(signals), news_missing=not bool(signals),
            news_state='|'.join(statuses) if statuses else ('no_discovered_article' if candidate else 'not_requested'),
            evidence=json.dumps(evidence, ensure_ascii=False), body_ids=json.dumps(body_ids),
            parent_ids=json.dumps(parent_ids), requested_articles=len(parent_ids))
        result.append(row)
    return pd.DataFrame(result)


def score(features, news_weight):
    if not 0 <= news_weight < 1:
        raise ValueError('Use 0 <= news weight < 1; no calibrated news-only predictor exists')
    f = features.copy()
    f['price_contribution'] = (1-news_weight)*f.price_score
    f['news_contribution'] = news_weight*f.news_signal
    # Zero contribution on missing news is an explicit fallback, not a neutral label.
    f['final_score'] = f.price_contribution + f.news_contribution
    f = f.sort_values(['entry_date','final_score','price_rank','ticker'], ascending=[True,False,True,True])
    f['final_rank'] = 0
    candidates = f[f.candidate].copy()
    f.loc[candidates.index, 'final_rank'] = candidates.groupby('entry_date').cumcount()+1
    f['selected'] = f.candidate & f.final_rank.between(1,5)
    if f.groupby('entry_date').selected.sum().ne(5).any():
        raise ValueError('Insufficient candidates')
    np.testing.assert_allclose(f.final_score, f.price_contribution+f.news_contribution)
    return f


def configurations():
    return [{'id':f'{pool}_a{count}_w{int(weight*100)}', 'pool':pool, 'articles':count, 'weight':weight}
        for pool in ['price20', 'union'] for count in [1,2] for weight in [.25,.50,.75]]

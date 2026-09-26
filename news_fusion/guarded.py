"""Conservative, auditable news overlay in predicted return units.

This is a frozen heuristic for exploratory replay, not a fitted return model.
No realized returns or future articles enter these functions.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .news import normalize_title, timestamp


EVENT_STRENGTH = {
    'earnings': 1.0, 'contract': 1.0, 'capital_raise': 1.0,
    'legal': 1.0, 'dividend': 0.8, 'buyback': 0.8, 'product': 0.6,
}
AGE_STRENGTH = {1: 1.0, 2: 0.65, 3: 0.4}
MAX_NEWS_RETURN = 0.001  # 10 basis points, fixed before replay


def first_seen_titles(discovered):
    """Earliest sampled publication date for an exact normalized ticker headline.

    This is only a repeat-headline proxy; RSS discovery is not exhaustive.
    """
    first = {}
    for article in discovered:
        key = (article['ticker'], normalize_title(article['title']))
        day = timestamp(article['published_at']).normalize()
        if key not in first or day < first[key]:
            first[key] = day
    return first


def overlay(features, bodies, discovered):
    """Apply evidence gates to a panel produced by ``features_for``.

    The LLM's sentiment/event labels are fixed inputs. An absent/invalid article
    contributes zero, so it cannot implicitly penalize a company.
    """
    body_by_id = {record['article']['article_id']: record
                  for record in bodies if record['status'] == 'body_extracted'}
    first = first_seen_titles(discovered)
    rows = []
    for record in features.to_dict('records'):
        accepted = []
        audited = []
        decision_day = timestamp(record['decision_at']).normalize()
        for item in json.loads(record['evidence']):
            body = body_by_id[item['article_id']]
            article = body['article']
            published_day = timestamp(article['published_at']).normalize()
            age = int((decision_day - published_day).days)
            reason = None
            if age not in AGE_STRENGTH:
                reason = 'outside_previous_three_calendar_days'
            elif item['relevance'] != 'direct':
                reason = 'not_direct_company_news'
            elif item['sentiment'] not in ('positive', 'negative'):
                reason = 'no_directional_event'
            elif item['event_type'] not in EVENT_STRENGTH:
                reason = 'not_specific_event'
            elif article.get('modified_at') and timestamp(article['modified_at']) > timestamp(record['decision_at']):
                reason = 'known_later_revision'
            elif first.get((record['ticker'], normalize_title(body['title'])), published_day) < published_day:
                reason = 'repeated_exact_headline'
            value = 0.0 if reason else ((1.0 if item['sentiment'] == 'positive' else -1.0)
                                        * EVENT_STRENGTH[item['event_type']] * AGE_STRENGTH[age])
            if reason is None:
                accepted.append(value)
            audited.append({**item, 'published_at': article['published_at'],
                            'age_calendar_days': age, 'gate': reason or 'accepted',
                            'signed_strength': value})
        delta = MAX_NEWS_RETURN * float(np.mean(accepted)) if accepted else 0.0
        record['news_delta'] = float(np.clip(delta, -MAX_NEWS_RETURN, MAX_NEWS_RETURN))
        record['adjusted_score'] = float(record['huber_ensemble'] + record['news_delta'])
        record['accepted_articles'] = len(accepted)
        record['audited_evidence'] = json.dumps(audited, ensure_ascii=False)
        rows.append(record)
    result = pd.DataFrame(rows)
    if not np.isfinite(result.adjusted_score).all():
        raise ValueError('Nonfinite adjusted return')
    return result


def select_top5(panel, score_col, replacement_hurdle=0.0):
    """Select five stocks per day; replace a held name only above the cost hurdle.

    A holding missing from the current universe must be exited. No realized
    prices/returns are inspected here. The portfolio replay remains unchanged.
    """
    if replacement_hurdle < 0:
        raise ValueError('Negative replacement hurdle')
    chosen = []
    holdings = set()
    for date, group in panel.groupby('entry_date', sort=True):
        if group.ticker.duplicated().any() or len(group) < 5:
            raise ValueError('Invalid daily universe')
        ranked = group.sort_values([score_col, 'ticker'], ascending=[False, True])
        values = dict(zip(ranked.ticker, ranked[score_col]))
        if not all(np.isfinite(list(values.values()))):
            raise ValueError('Nonfinite scores')
        current = holdings.intersection(values)
        forced_exits = holdings - current
        for ticker in ranked.ticker:
            if len(current) >= 5:
                break
            current.add(ticker)
        swaps = []
        while True:
            weakest = min(current, key=lambda t: (values[t], t))
            challenger = next((t for t in ranked.ticker if t not in current), None)
            if challenger is None or values[challenger] - values[weakest] <= replacement_hurdle:
                break
            current.remove(weakest)
            current.add(challenger)
            swaps.append({'out': weakest, 'in': challenger,
                          'predicted_return_gain': float(values[challenger] - values[weakest])})
        if len(current) != 5:
            raise ValueError('Did not select five stocks')
        selection = ranked[ranked.ticker.isin(current)].copy()
        selection['forced_exits'] = len(forced_exits)
        selection['hurdle_swaps'] = len(swaps)
        selection['selection_explanation'] = json.dumps(swaps, ensure_ascii=False)
        chosen.append(selection)
        holdings = current
    return pd.concat(chosen, ignore_index=True)

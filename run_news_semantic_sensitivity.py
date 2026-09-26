"""Exploratory text-only guard for clearly nonbinding/nonbusiness news.

The patterns address factual event-state errors, not observed returns. They are
not a substitute for verified entity/event extraction or an independent test.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path
import json

import pandas as pd

from news_fusion.news import save_json, now
from run_news_walkforward import BARS, SOURCE, feature_panel, walkforward, evaluate


OUT = Path('outputs/news_semantic_sensitivity_v1')
PENDING = ('수주 총력', '수주 추진', '수주전', '수주를 위한', '수주 목표',
           '입찰 참여', '계약 추진', '계약 협의', '수주 기대')
CONFIRMED = ('수주 확정', '수주 성공', '수주 계약', '계약 체결', '공급계약 체결',
             '최종 낙찰', '최종 선정')
SPORTS = ('프로농구', '프로축구', 'KBL', '선수 등록', '선수등록', '농구단', '축구단')


def guarded_panel(panel):
    result = panel.copy()
    counts = Counter()
    evidence = []
    for raw in panel.audited_evidence:
        items = json.loads(raw)
        for item in items:
            if item['gate'] != 'accepted':
                continue
            title = item['title']
            quote = item['evidence_quote']
            if any(word in title for word in SPORTS):
                item['gate'] = 'semantic_sports_not_operating_event'
            elif item['event_type'] == 'contract' and item['sentiment'] == 'positive' and (
                    any(word in title or word in quote for word in PENDING)
                    and not any(word in title for word in CONFIRMED)):
                item['gate'] = 'semantic_contract_not_awarded'
            else:
                continue
            counts[item['gate']] += 1
        evidence.append(json.dumps(items, ensure_ascii=False))
    result['audited_evidence'] = evidence
    return result, dict(counts)


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    panel = pd.read_parquet(SOURCE/'scored_panel.parquet')
    guarded, counts = guarded_panel(panel)
    bars = pd.read_parquet(BARS)
    bars['ticker'] = bars.ticker.astype(str).str.zfill(6)
    frame = feature_panel(guarded, bars)
    source_protocol = json.loads(Path('outputs/news_walkforward_v1/protocol.json').read_text(encoding='utf-8'))
    forecasts, fits = walkforward(frame, source_protocol)
    metrics = evaluate(OUT, forecasts, bars, source_protocol)
    save_json(OUT/'summary.json', {'at': now(), 'excluded_evidence_instances': counts,
                                   'status': 'post-hoc exploratory semantic sensitivity; not a validated strategy'})
    forecasts.to_parquet(OUT/'forecasts.parquet', index=False)
    save_json(OUT/'fit_history.json', fits)
    print('Excluded article instances:',counts,flush=True)
    print(metrics[['regime','strategy','turnover','mean_daily_rank_ic','final_equity']].to_string(index=False),flush=True)


if __name__ == '__main__':
    run()

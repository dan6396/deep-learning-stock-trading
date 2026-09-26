"""Bounded semantic audit of cached articles, without accessing return labels."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import requests

from news_fusion.event_v3 import MODEL, VERSION, INSTRUCTION, output_schema, request_body, validate_response
from news_fusion.news import now, save_json


SOURCE = Path('outputs/news_regimes_calendar3_bounded')
PANEL = Path('outputs/news_guarded_calendar3_v2/scored_panel.parquet')
OUT = Path('outputs/news_event_audit_v3')
BUDGET_USD = .10
BATCH_SIZE = 5
KNOWN_CASES = {
    'pending_bid': '잠수함 수주 총력',
    'other_company_penalty': '브로드컴, 공정위 과징금',
    'sports_team_dispute': '라건아 세금문제',
}


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sample_articles():
    import pandas as pd
    frame = pd.read_parquet(PANEL)
    accepted = {event['article_id'] for raw in frame.audited_evidence
                for event in json.loads(raw) if event['gate'] == 'accepted'}
    bodies = [a for a in read(SOURCE/'body_articles.json') if a['article_id'] in accepted]
    known = {}
    for name, phrase in KNOWN_CASES.items():
        matches = [a for a in bodies if phrase in a['title']]
        if len(matches) != 1:
            raise ValueError(f'Expected one cached example: {name}')
        known[name] = matches[0]
    extras = sorted((a for a in bodies if a['article_id'] not in {v['article_id'] for v in known.values()}),
                    key=lambda a: hashlib.sha256(('event-audit-v3:'+a['article_id']).encode()).hexdigest())[:12]
    return list(known.values())+extras, {key: article['article_id'] for key, article in known.items()}


def reserve(body):
    # Conservative local ceiling, not a guarantee about provider billing.
    return (len(json.dumps(body, ensure_ascii=False).encode('utf-8'))+8192)*.4/1e6+6000*1.6/1e6


def key_from_file(path):
    values = [line.strip().split('=',1)[1].strip().strip('"\'')
              for line in Path(path).read_text(encoding='utf-8-sig').splitlines()
              if line.strip().startswith('OPENAI_API_KEY=')]
    if not values or not values[-1]:
        raise ValueError('OPENAI_API_KEY missing from ignored local settings')
    return values[-1]


def run(out=OUT, env_file='.env.news_fusion'):
    out.mkdir(parents=True, exist_ok=True)
    articles, cases = sample_articles()
    batches = [articles[i:i+BATCH_SIZE] for i in range(0, len(articles), BATCH_SIZE)]
    bodies = [request_body(batch) for batch in batches]
    ceiling = sum(reserve(body) for body in bodies)
    protocol = {'version': VERSION, 'created_at': now(), 'model': MODEL,
                'sample_article_ids': [a['article_id'] for a in articles], 'known_cases': cases,
                'source_sha256': {str(p): sha(p) for p in [SOURCE/'body_articles.json', PANEL,
                                    Path('news_fusion/event_v3.py'), Path(__file__)]},
                'instruction_sha256': hashlib.sha256(INSTRUCTION.encode()).hexdigest(),
                'schema_sha256': hashlib.sha256(json.dumps(output_schema([]), sort_keys=True).encode()).hexdigest(),
                'budget_usd': BUDGET_USD, 'reserved_ceiling_usd': ceiling,
                'purpose': 'semantic extraction quality audit only; no price or return sent to API'}
    destination = out/'protocol.json'
    if destination.exists():
        old = read(destination); protocol['created_at'] = old['created_at']
        if old != protocol:
            raise ValueError('Frozen semantic audit protocol changed')
    else:
        save_json(destination, protocol)
    if ceiling > BUDGET_USD:
        raise ValueError('Planned API ceiling exceeds budget')
    print('Audit preflight:',len(articles),'articles',len(batches),'calls, ceiling USD',round(ceiling,4),flush=True)
    key = key_from_file(env_file)
    ledger_path = out/'api_ledger.json'
    ledger = read(ledger_path) if ledger_path.exists() else []
    results = []
    for i, (batch, body) in enumerate(zip(batches,bodies)):
        cache = out/f'batch_{i+1}.json'
        if cache.exists():
            obj = read(cache)
        else:
            charge = reserve(body)
            if sum(item['accounted_usd'] for item in ledger)+charge > BUDGET_USD:
                raise RuntimeError('Local API budget reached')
            entry = {'batch': i+1, 'at': now(), 'accounted_usd': charge, 'status': 'reserved'}
            ledger.append(entry); save_json(ledger_path, ledger)
            try:
                response = requests.post('https://api.openai.com/v1/responses',
                                         headers={'Authorization': 'Bearer '+key,
                                                  'Content-Type': 'application/json'},
                                         json=body, timeout=60)
                if response.status_code != 200:
                    entry.update(status='http_error', http_status=response.status_code)
                    save_json(ledger_path, ledger)
                    raise RuntimeError(f'OpenAI HTTP {response.status_code}; stopped')
                obj = response.json()
                save_json(cache, obj)
                usage = obj.get('usage')
                entry.update(status='received', usage=usage)
                if usage:
                    cached = usage.get('input_tokens_details',{}).get('cached_tokens',0)
                    entry['accounted_usd'] = ((usage['input_tokens']-cached)*.4+cached*.1+
                                               usage['output_tokens']*1.6)/1e6
                save_json(ledger_path, ledger)
            except requests.RequestException:
                entry['status'] = 'network_error'; save_json(ledger_path, ledger)
                raise RuntimeError('Network failure; stopped without retry') from None
        parsed = validate_response(obj,batch)
        results.extend(parsed)
        save_json(out/'results.json', results)
        print('Semantic audit batch',i+1,'/',len(batches),'validated',len(parsed),flush=True)
    save_json(out/'status.json', {'completed_at':now(), 'articles':len(results),
                                  'estimated_accounted_usd':sum(x['accounted_usd'] for x in ledger),
                                  'known_cases':{name:next(r['result'] for r in results if r['article_id']==ident)
                                                 for name,ident in cases.items()}})
    print('Semantic audit complete',len(results),'articles',flush=True)


if __name__ == '__main__':
    run()

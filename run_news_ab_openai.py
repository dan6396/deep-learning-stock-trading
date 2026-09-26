"""Run the frozen news risk filter using a single pinned OpenAI model throughout."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import time
import requests
from run_news_ab import read,make_batches,parse_batch,replay,BATCH_INSTRUCTION,SCHEMA
from news_fusion.news import save_json,now,digest

MODEL='gpt-4.1-mini-2025-04-14'
VERSION='independent-articles-openai-v2-required-ids'
MAX_OUTPUT=12000
INPUT_RATE=.4/1e6
CACHED_RATE=.1/1e6
OUTPUT_RATE=1.6/1e6
BUDGET=1.

def load_openai_key(path):
    values=[line.strip().split('=',1)[1].strip().strip('\"\'')
            for line in Path(path).read_text(encoding='utf-8-sig').splitlines()
            if line.strip().startswith('OPENAI_API_KEY=')]
    if not values or not values[-1]:raise ValueError('OPENAI_API_KEY missing in local settings file')
    return values[-1]

def output_schema(article_ids=()):
    properties={}
    for name,value in SCHEMA['properties'].items():
        properties[name]={**value,'type':value['type'].lower()}
    item={'type':'object','properties':properties,'required':list(properties),'additionalProperties':False}
    keyed={'type':'object','properties':{ident:item for ident in article_ids},
           'required':list(article_ids),'additionalProperties':False}
    return {'type':'object','properties':{'articles':keyed},
            'required':['articles'],'additionalProperties':False}

def request_body(batch):
    payload=[{k:a[k] for k in ['article_id','ticker','company_name','text']} for a in batch]
    return {'model':MODEL,'store':False,'temperature':0,'max_output_tokens':MAX_OUTPUT,
            'instructions':BATCH_INSTRUCTION+'\nFor this output format, articles must be an object keyed by EVERY exact supplied article_id. Each value contains only the six extraction fields. No article may be omitted.',
            'input':json.dumps(payload,ensure_ascii=False),
            'text':{'format':{'type':'json_schema','name':'company_news','strict':True,'schema':output_schema([a['article_id'] for a in batch])}}}

def cost_reservation(body):
    # Each input UTF-8 byte is an upper bound of one BPE token; add envelope headroom.
    return (len(json.dumps(body,ensure_ascii=False).encode('utf-8'))+8192)*INPUT_RATE+MAX_OUTPUT*OUTPUT_RATE

def usage_cost(usage):
    cached=usage.get('input_tokens_details',{}).get('cached_tokens',0)
    return (usage['input_tokens']-cached)*INPUT_RATE+cached*CACHED_RATE+usage['output_tokens']*OUTPUT_RATE

def response_text(obj):
    if obj.get('status')!='completed':raise ValueError('Incomplete OpenAI response')
    parts=[p for item in obj.get('output',[]) if item.get('type')=='message' for p in item.get('content',[])]
    if any(p.get('type')=='refusal' for p in parts):raise ValueError('OpenAI refused extraction')
    text=''.join(p.get('text','') for p in parts if p.get('type')=='output_text')
    data=json.loads(text)
    if not isinstance(data,dict) or set(data)!= {'articles'}:raise ValueError('Invalid response root')
    if not isinstance(data['articles'],dict):raise ValueError('Expected article-ID keyed response')
    return json.dumps([dict(value,article_id=ident) for ident,value in data['articles'].items()],ensure_ascii=False)

def prepare(source,out):
    names=['candidates.parquet','companies.json','article_requests.json','selected_headlines.json',
           'body_articles.json','body_audit.json','collection_audit.json','discovered_articles.json']
    hashes={name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in names}
    protocol=read(source/'protocol.json')
    protocol.update(provider='openai',model=MODEL,prompt_version=VERSION,
        prompt_digest=digest(request_body([])['instructions']),response_schema_digest=digest(output_schema()),
        parent_protocol_sha256=digest(read(source/'protocol.json')),source_file_sha256=hashes,
        migration_reason='User supplied an OpenAI key after Gemini quota exhaustion; reclassify all articles, no label mixing',
        migration_at=now(),api_budget_usd=BUDGET,max_output_tokens=MAX_OUTPUT,
        pricing_usd_per_million={'input':.4,'cached_input':.1,'output':1.6},
        pricing_source='https://developers.openai.com/api/docs/models/gpt-4.1-mini',
        baseline_already_observed=True,investment_rule_changed=False)
    target=out/'protocol.json'
    if target.exists():
        saved=read(target);protocol['migration_at']=saved['migration_at']
        if protocol!=saved:raise ValueError('Frozen OpenAI protocol or source data changed')
    else:save_json(target,protocol)
    for name in names:
        dest=out/name
        if dest.exists():
            if hashlib.sha256(dest.read_bytes()).hexdigest()!=hashes[name]:raise ValueError('Copied data changed: '+name)
        else:shutil.copy2(source/name,dest)

def analyze(out,env_file):
    key=load_openai_key(env_file)
    batches,rejected,count=make_batches(read(out/'body_articles.json'),read(out/'article_requests.json'))
    bodies=[request_body(b) for b in batches]
    planned=sum(cost_reservation(body) for body in bodies)
    save_json(out/'api_preflight.json',{'at':now(),'articles':count,'calls':len(batches),
               'conservative_cost_bound_usd':planned,'budget_usd':BUDGET,'model':MODEL})
    if planned>BUDGET:raise ValueError('Planned API expense exceeds experiment budget')
    print('API preflight:',count,'articles',len(batches),'calls, reserved ceiling USD',round(planned,4),flush=True)
    cache=out/'openai_cache';cache.mkdir(exist_ok=True)
    ledger_path=out/'api_cost_ledger.json';ledger=read(ledger_path) if ledger_path.exists() else []
    if not ledger_path.exists():
        prior=out.parent/'news_ab_openai_20260601_0615'/'api_cost_ledger.json'
        if prior.exists() and prior.resolve()!=ledger_path.resolve():
            ledger=[{'state':'prior_schema_validation_attempt','accounted_cost_usd':sum(r['accounted_cost_usd'] for r in read(prior))}]
            save_json(ledger_path,ledger)
    results=[];usages=[];calls=0;failure=None
    for i,(batch,body) in enumerate(zip(batches,bodies)):
        ident=digest({'version':VERSION,'body':body});path=cache/(ident+'.json')
        if path.exists():obj=read(path)
        else:
            reserve=cost_reservation(body)
            if sum(r['accounted_cost_usd'] for r in ledger)+reserve>BUDGET:
                failure='Local cost cap reached';break
            if calls:time.sleep(2)
            attempt={'at':now(),'batch_id':ident,'accounted_cost_usd':reserve,'state':'reserved_before_request'}
            ledger.append(attempt);save_json(ledger_path,ledger);calls+=1
            try:
                response=requests.post('https://api.openai.com/v1/responses',headers={'Authorization':'Bearer '+key,
                    'Content-Type':'application/json'},json=body,timeout=55)
                if response.status_code!=200:
                    attempt['state']='http_error';attempt['http_status']=response.status_code
                    # Leave a conservative reservation on failed/uncertain calls; do not retry automatically.
                    save_json(ledger_path,ledger);failure='OpenAI HTTP '+str(response.status_code);break
                obj=response.json()
                # Only response data is cached; request headers and key are never logged.
                save_json(path,obj)
                attempt['state']='response_received';attempt['usage']=obj.get('usage')
                if obj.get('usage'):
                    attempt['accounted_cost_usd']=usage_cost(obj['usage'])
                save_json(ledger_path,ledger)
            except (requests.RequestException,ValueError) as exc:
                failure=type(exc).__name__;break
        try:good,bad=parse_batch(response_text(obj),batch)
        except (ValueError,TypeError,KeyError) as exc:failure=type(exc).__name__+': invalid structured response';break
        results.extend([{**g,'provider':'openai','model':MODEL,'response_model':obj.get('model'),
                         'prompt_version':VERSION,'batch_id':ident} for g in good])
        rejected.extend(bad);usages.append(obj['usage'])
        save_json(out/'extractions.json',results);save_json(out/'rejected_extractions.json',rejected)
        print('OpenAI batch',i+1,len(batches),'validated',len(good),'rejected',len(bad),flush=True)
    status={'status':'stopped' if failure else 'complete','failure':failure,'provider':'openai','model':MODEL,
        'calls_this_run':calls,'requested_articles':count,'validated':len(results),'rejected':len(rejected),
        'input_tokens':sum(u['input_tokens'] for u in usages),'output_tokens':sum(u['output_tokens'] for u in usages),
        'total_tokens':sum(u['total_tokens'] for u in usages),'estimated_cost_usd':sum(usage_cost(u) for u in usages),
        'accounted_cost_including_uncertain_calls_usd':sum(r['accounted_cost_usd'] for r in ledger),'budget_usd':BUDGET}
    save_json(out/'extraction_status.json',status)
    if failure:raise RuntimeError(failure+'; stopped, no automatic retry')
    print(json.dumps(status,ensure_ascii=False),flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',default='outputs/news_ab_20260601_0615')
    p.add_argument('--out',default='outputs/news_ab_openai_20260601_0615_v2');p.add_argument('--env-file',default='.env.news_fusion')
    p.add_argument('--bars',default='../../outputs/validation_report/inputs/daily_bars.parquet')
    p.add_argument('--stage',choices=['prepare','analyze','replay','all'],default='all')
    a=p.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    prepare(Path(a.source),out)
    if a.stage in ['analyze','all']:analyze(out,a.env_file)
    if a.stage in ['replay','all']:
        labels=read(out/'extractions.json')
        if any(r['model']!=MODEL or r['response_model']!=MODEL or r['prompt_version']!=VERSION for r in labels):
            raise ValueError('Mixed model or protocol detected')
        replay(out,a.bars)
        old=read(Path(a.source)/'price_only_metrics.json')
        new=read(out/'summary.json')['metrics']['price_only']
        errors={k:abs(old[k]-new[k]) for k in ['final_equity','net_return','mdd','total_fees']}
        if max(errors.values())>1e-6:raise ValueError('Original price baseline failed reproduction')
        save_json(out/'verification.json',{'original_price_baseline_max_error':max(errors.values()),
                                         'all_labels_same_model':True,'news_input_truncations':sum(r['input_truncated'] for r in labels)})

if __name__=='__main__':main()

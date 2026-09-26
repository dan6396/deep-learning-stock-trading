"""Frozen 12-arm news efficiency pilot; secrets stay in the local ignored env file."""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import shutil
import time
import numpy as np
import pandas as pd
import requests
from news_fusion.news import digest, now, save_json, eligible, timestamp
from news_fusion.body import fetch_article_body
from news_fusion.efficient import candidate_plan, configurations, features_for, score
from run_news_ab import read, collect, make_batches, parse_batch
from run_news_ab_openai import (MODEL, VERSION, request_body, cost_reservation,
    usage_cost, response_text, load_openai_key)

BUDGET = 1.


def prepare(out, predictions, source):
    panel = pd.read_parquet(predictions, columns=['date','entry_date','ticker','huber_ensemble'])
    dates = sorted(panel.entry_date.unique())[:10]
    panel = panel[panel.entry_date.isin(dates)].copy()
    panel['ticker'] = panel.ticker.astype(str).str.zfill(6)
    names = dict(re.findall(r'code: "([^"]+)", name: "([^"]+)"', Path('FE/server/kospi200Pool.ts').read_text(encoding='utf-8')))
    # Frozen benchmark includes four codes absent from the application's pool.
    names.update({'000990':'DB하이텍','267270':'HD건설기계','456040':'OCI','483650':'달바글로벌'})
    missing = sorted(set(panel.ticker)-set(names))
    if missing:
        raise ValueError('Missing universe names: '+str(missing))
    protocol = {'version':'news-efficiency-v1', 'created_at':now(), 'start':str(pd.Timestamp(dates[0]).date()),
        'end':str(pd.Timestamp(dates[-1]).date()), 'purpose':'exploratory fixed-rule comparison, not independent test',
        'universe':'All feature-valid stocks in frozen KOSPI200 price panel; historical membership not reconstituted',
        'period_selection':'First 10 sessions of already observed evaluation, no outcome-based period selection',
        'decision':'08:30 Asia/Seoul', 'lookback_days':3, 'price_candidates':20, 'independent_news_candidates':10,
        'news_candidate_rule':'Exact normalized company title mention plus corporate event keywords, unsigned event count and recency; ties ticker',
        'article_rule':'Eligible headlines only, lexical near-duplicate removal with numeric facts preserved; priority then recency; no replacement after body failure',
        'configs':configurations(), 'price_score':'1-2*(price_rank-1)/(daily_universe_size-1)',
        'news_score':'24-hour exponential age weighted mean of sentiment {-1,0,1} times direct1/indirect0.5 relevance',
        'fusion':'(1-w)*price_score+w*news_score; missing contribution0 explicitly flagged; candidate union before final Top5',
        'tie_break':'price_rank then ticker', 'model':MODEL, 'prompt_version':VERSION,
        'prompt_digest':digest(request_body([])['instructions']), 'additional_api_budget_usd':BUDGET,
        'pricing_usd_per_million':{'input':.4,'cached_input':.1,'output':1.6},
        'pricing_source':'https://developers.openai.com/api/docs/models/gpt-4.1-mini',
        'capital':10000000, 'one_way_cost':.00125,
        'portfolio':'Original fractional-share engine; initial equal cash; retain quantity, replace exits at open; terminal close liquidation',
        'metrics':'Same-universe policy RankIC, Top5 gross O-C, net keep/replace wealth, MDD, Sharpe, fees, turnover, text/call costs',
        'direction_accuracy':'Not reported for ordinal blended scores; sign is not a calibrated return prediction',
        'learned_fusion':'Not fit: missing pre-evaluation historical news and honest OOF training panel; 10 days insufficient',
        'limitations':['Previously observed interval and multiple comparisons: no unbiased winning-strategy claim',
            'Historical search incomplete; article original versions unverified; exploration only',
            'Keyword candidate gate and limited representative articles can miss important events',
            'Sentiment is not expected return; 50:50 matches numeric range, not equal information content',
            'Holding retained names overnight differs from pure daily O-C diagnostic',
            'LLM labels not human-validated; article text can contain irrelevant events'],
        'predictions_sha256':hashlib.sha256(Path(predictions).read_bytes()).hexdigest(),
        'candidate_code_sha256':hashlib.sha256(Path('news_fusion/efficient.py').read_bytes()).hexdigest(),
        'source_protocol_sha256':digest(read(source/'protocol.json'))}
    protocol['company_mapping_sha256'] = digest({t:names[t] for t in sorted(panel.ticker.unique())})
    dest = out/'protocol.json'
    if dest.exists():
        old = read(dest); protocol['created_at'] = old['created_at']
        if old != protocol:
            raise ValueError('Frozen protocol changed; use a separate experiment directory')
    else:
        save_json(dest, protocol)
    panel.to_parquet(out/'candidates.parquet', index=False)
    save_json(out/'companies.json', {t:names[t] for t in sorted(panel.ticker.unique())})
    # Public-data caches, never environment/settings files.
    original = Path('outputs/news_ab_20260601_0615')
    for folder in ['rss_cache','body_cache']:
        if (original/folder).exists():
            shutil.copytree(original/folder, out/folder, dirs_exist_ok=True)
    print('Frozen:',len(panel),'stock-days;',panel.ticker.nunique(),'companies; 12 arms; extra API cap USD',BUDGET,flush=True)


def plan(out):
    rows, requests_, headlines = candidate_plan(pd.read_parquet(out/'candidates.parquet'), read(out/'discovered_articles.json'))
    rows.to_parquet(out/'candidate_plan.parquet', index=False)
    save_json(out/'article_requests.json',requests_)
    save_json(out/'selected_headlines.json',headlines)
    save_json(out/'plan_summary.json',{'stock_days':len(rows), 'price_candidate_days':int(rows.in_price_pool.sum()),
        'news_candidate_days':int(rows.in_news_pool.sum()),
        'news_only_candidate_days':int((rows.in_news_pool & ~rows.in_price_pool).sum()),
        'requested_article_slots':len(requests_), 'unique_headlines':len(headlines),
        'candidate_plan_sha256':hashlib.sha256((out/'candidate_plan.parquet').read_bytes()).hexdigest()})
    print('Candidate plan:',read(out/'plan_summary.json'),flush=True)


def bodies(out):
    selected = read(out/'selected_headlines.json'); records=[]; start=time.perf_counter()
    with ThreadPoolExecutor(max_workers=3) as executor:
        jobs = {executor.submit(fetch_article_body,a,out/'body_cache'):a['article_id'] for a in selected}
        for job in as_completed(jobs):
            records.append(job.result())
            save_json(out/'body_audit.json',records)
            if len(records)%20==0 or len(records)==len(selected):
                print('Bodies:',len(records),'/',len(selected),'usable:',sum(r['status']=='body_extracted' for r in records),flush=True)
    save_json(out/'body_articles.json',[r['article'] for r in records if r['status']=='body_extracted'])
    save_json(out/'body_timing.json',{'seconds_including_cache':time.perf_counter()-start})


def reusable(source, articles, requests_, eligibility_mode='exploratory'):
    """Reuse identical model/text only when its original batch was not later."""
    source_requests = read(source/'article_requests.json')
    source_articles = read(source/'body_articles.json')
    old_first = {}; new_first = {}
    for dest, aa, rr in [(old_first,source_articles,source_requests),(new_first,articles,requests_)]:
        for article in aa:
            dates=[r['decision_at'] for r in rr if r['parent_article_id']==article['parent_article_id']
                and eligible(article,r['decision_at'],mode='exploratory' if dest is old_first else eligibility_mode)]
            if dates: dest[article['article_id']]=min(dates,key=timestamp)
    old_articles={a['article_id']:a for a in source_articles}; new_articles={a['article_id']:a for a in articles}
    allowed={ident for ident in new_first if ident in old_first and timestamp(old_first[ident])<=timestamp(new_first[ident])
        and old_articles[ident]['text']==new_articles[ident]['text']}
    labels=[r for r in read(source/'extractions.json') if r['article_id'] in allowed and r['model']==MODEL
        and r.get('response_model')==MODEL and r['prompt_version']==VERSION]
    rejected=[r for r in read(source/'rejected_extractions.json') if r['article_id'] in allowed]
    return labels,rejected


def analyze(out, source, env_file):
    articles=read(out/'body_articles.json'); requests_=read(out/'article_requests.json')
    protocol=read(out/'protocol.json') if (out/'protocol.json').exists() else {}
    eligibility_mode=protocol.get('eligibility_mode','exploratory')
    budget=protocol.get('additional_api_budget_usd',BUDGET)
    # Several RSS links may resolve to one identical publisher body. Keep the
    # parent mapping with the earliest eligible decision, and pay only once.
    distinct={}; first={}
    for article in articles:
        dates=[r['decision_at'] for r in requests_ if r['parent_article_id']==article['parent_article_id']
            and eligible(article,r['decision_at'],mode=eligibility_mode)]
        if not dates: continue
        date=min(dates,key=timestamp); ident=article['article_id']
        if ident not in first or timestamp(date)<timestamp(first[ident]):
            distinct[ident]=article;first[ident]=date
    articles=list(distinct.values())
    good,bad=reusable(source,articles,requests_,eligibility_mode)
    reused_good=len(good); reused_bad=len(bad); done={r['article_id'] for r in good+bad}
    batches,overlong,_=make_batches([a for a in articles if a['article_id'] not in done],requests_,eligibility_mode=eligibility_mode)
    bad.extend(overlong)
    cache=out/'openai_cache'; cache.mkdir(exist_ok=True)
    ledger_path=out/'api_cost_ledger.json'; ledger=read(ledger_path) if ledger_path.exists() else []
    payloads=[request_body(batch) for batch in batches]
    save_json(out/'api_preflight.json',{'model':MODEL,'new_or_cached_batches':len(batches),
        'new_articles':sum(map(len,batches)), 'reused_valid':reused_good,'reused_rejected':reused_bad,
        'all_batches_conservative_bound_usd':sum(cost_reservation(p) for p in payloads),
        'additional_budget_usd':budget,'at':now()})
    print('Analysis preflight:',read(out/'api_preflight.json'),flush=True)
    key=load_openai_key(env_file); failure=None; calls=0; started=time.perf_counter()
    for i,(batch,body) in enumerate(zip(batches,payloads)):
        ident=digest({'version':VERSION,'body':body}); dest=cache/(ident+'.json')
        if dest.exists():
            obj=read(dest)
        else:
            reserve=cost_reservation(body)
            if sum(r['accounted_cost_usd'] for r in ledger)+reserve > budget:
                failure='Local USD1 cap reached'; break
            attempt={'at':now(),'batch_id':ident,'article_ids':[a['article_id'] for a in batch],
                'accounted_cost_usd':reserve,'state':'reserved_before_request'}
            ledger.append(attempt); save_json(ledger_path,ledger); calls+=1
            try:
                response=requests.post('https://api.openai.com/v1/responses',
                    headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},json=body,timeout=55)
                if response.status_code!=200:
                    attempt.update(state='http_error',http_status=response.status_code)
                    save_json(ledger_path,ledger); failure='HTTP '+str(response.status_code); break
                obj=response.json(); save_json(dest,obj)
                attempt.update(state='response_received',usage=obj.get('usage'))
                if obj.get('usage'): attempt['accounted_cost_usd']=usage_cost(obj['usage'])
                save_json(ledger_path,ledger)
            except (requests.RequestException,ValueError) as exc:
                failure=type(exc).__name__; break
        try:
            if obj.get('model')!=MODEL: raise ValueError('Unexpected model snapshot')
            accepted,rejected=parse_batch(response_text(obj),batch)
        except (ValueError,KeyError,TypeError):
            failure='Invalid structured response'; break
        good.extend([{**r,'provider':'openai','model':MODEL,'response_model':obj['model'],
            'prompt_version':VERSION,'batch_id':ident} for r in accepted]); bad.extend(rejected)
        save_json(out/'extractions.json',good); save_json(out/'rejected_extractions.json',bad)
        print('Batch',i+1,'/',len(batches),'accepted',len(accepted),'rejected',len(rejected),
            'USD',round(sum(r['accounted_cost_usd'] for r in ledger),4),flush=True)
    save_json(out/'extractions.json',good); save_json(out/'rejected_extractions.json',bad)
    classified={r['article_id'] for r in good+bad}
    if not failure and classified != {a['article_id'] for a in articles}:
        failure='Incomplete or unexpected article IDs'
    status={'status':'stopped' if failure else 'complete','failure':failure,'calls_this_run':calls,
        'reused_valid':reused_good,'reused_rejected':reused_bad,'validated':len(good),'rejected':len(bad),
        'additional_accounted_cost_usd':sum(r['accounted_cost_usd'] for r in ledger),
        'api_wall_seconds_this_run':time.perf_counter()-started,'additional_budget_usd':budget}
    save_json(out/'extraction_status.json',status)
    if failure: raise RuntimeError(failure+'; no automatic retry; full comparison not run')
    print('Analysis complete:',status,flush=True)


def replay(out, predictions, bars_path, source):
    from portfolio_replay import simulate
    if read(out/'extraction_status.json')['status']!='complete':
        raise ValueError('Incomplete news analysis; cannot report full experiment')
    plan_=pd.read_parquet(out/'candidate_plan.parquet')
    requests_=read(out/'article_requests.json'); bodies_=read(out/'body_audit.json'); labels=read(out/'extractions.json')
    protocol=read(out/'protocol.json')
    if hashlib.sha256(Path('news_fusion/efficient.py').read_bytes()).hexdigest()!=protocol['candidate_code_sha256']:
        raise ValueError('Candidate/scoring code changed after protocol freeze')
    if hashlib.sha256(Path(predictions).read_bytes()).hexdigest()!=protocol['predictions_sha256']:
        raise ValueError('Price panel changed after protocol freeze')
    if hashlib.sha256((out/'candidate_plan.parquet').read_bytes()).hexdigest()!=read(out/'plan_summary.json')['candidate_plan_sha256']:
        raise ValueError('Candidate plan changed')
    expected=set()
    for record in bodies_:
        if record['status']!='body_extracted':continue
        article=record['article']
        if any(r['parent_article_id']==record['parent_article_id'] and eligible(article,r['decision_at'],mode='exploratory') for r in requests_):
            expected.add(article['article_id'])
    if expected!={r['article_id'] for r in labels+read(out/'rejected_extractions.json')}:
        raise ValueError('News analysis coverage differs from replay inputs')
    if any(r['model']!=MODEL or r['response_model']!=MODEL or r['prompt_version']!=VERSION for r in labels):
        raise ValueError('Mixed news model or prompt')
    targets=pd.read_parquet(predictions,columns=['entry_date','ticker','return_1']); targets['ticker']=targets.ticker.astype(str).str.zfill(6)
    bars=pd.read_parquet(bars_path); bars['ticker']=bars.ticker.astype(str).str.zfill(6)
    features={}; metrics=[]; daily_frames=[]; selections={}
    companies=read(out/'companies.json'); collection=read(out/'collection_audit.json')
    configs=[{'id':'price_only','pool':'price20','articles':1,'weight':0.}]+configurations()
    for config in configs:
        key=(config['pool'],config['articles'])
        if key not in features:
            features[key]=features_for(plan_,requests_,bodies_,labels,*key)
        selected=score(features[key],config['weight'])
        selected=selected.merge(targets,on=['entry_date','ticker'],how='left',validate='one_to_one')
        if selected.return_1.isna().any(): raise ValueError('Missing evaluation labels')
        top=selected[selected.selected]
        signals=top[['date','entry_date','ticker','final_score']].rename(columns={'final_score':'huber_ensemble'})
        met,daily,trades,holdings=simulate(signals,bars)
        pnl=daily.net_pnl/daily.start_equity
        met['sharpe_annualized']=float(pnl.mean()/pnl.std(ddof=1)*np.sqrt(252)) if pnl.std(ddof=1)>0 else None
        # A restricted candidate policy ranks non-candidates below candidates;
        # preserve their original price order for a common-universe diagnostic.
        selected['policy_score']=np.where(selected.candidate,selected.final_score+3,selected.price_score-3)
        ics=[g.policy_score.corr(g.return_1,method='spearman') for _,g in selected.groupby('entry_date')]
        met['rank_ic_full_universe_policy']=float(np.mean(ics))
        met['top5_mean_gross_oc']=float(top.groupby('entry_date').return_1.mean().mean())
        met['selected_news_coverage']=float(top.usable_articles.gt(0).mean())
        met['selected_outside_price20']=int(top.price_rank.gt(20).sum())
        met['two_sided_turnover_sum']=float(sum(g.notional.sum()/daily.set_index('date').loc[date,'start_equity'] for date,g in trades.groupby('date')))
        selections[config['id']]={str(pd.Timestamp(date).date()):set(g.ticker) for date,g in top.groupby('entry_date')}
        met['changed_days_vs_price']=sum(v!=selections['price_only'][k] for k,v in selections[config['id']].items())
        if config['id']=='price_only':
            met.update(unique_bodies=0,unique_headlines=0,input_characters=0,selected_news_coverage=None)
            met.update(discovery_companies_required=0,rss_queries_with_cache=0)
        else:
            body_ids={ident for value in selected.body_ids for ident in json.loads(value)}
            parent_ids={ident for value in selected.parent_ids for ident in json.loads(value)}
            body_lookup={r['article']['article_id']:r['article'] for r in bodies_ if r['status']=='body_extracted'}
            met.update(unique_bodies=len(body_ids),unique_headlines=len(parent_ids),
                input_characters=sum(len(body_lookup[ident]['text']) for ident in body_ids))
            names={companies[t] for t in (set(plan_.ticker) if config['pool']=='union' else set(plan_[plan_.in_price_pool].ticker))}
            met.update(discovery_companies_required=len(names),rss_queries_with_cache=sum(
                any(str(r.get('query','')).startswith('"'+name+'" after:') for name in names) for r in collection))
        met.update(config); metrics.append(met)
        daily['strategy']=config['id']; daily_frames.append(daily)
        selected.to_parquet(out/(config['id']+'_selection.parquet'),index=False)
        selected[selected.candidate].to_csv(out/(config['id']+'_decisions.csv'),index=False,encoding='utf-8-sig')
        trades.to_parquet(out/(config['id']+'_trades.parquet'),index=False)
        holdings.to_parquet(out/(config['id']+'_holdings.parquet'),index=False)
    baseline=metrics[0]; old=read(source/'summary.json')['metrics']['price_only']
    error=max(abs(baseline[k]-old[k]) for k in ['final_equity','net_return','mdd','total_fees'])
    if error>1e-6: raise ValueError('Existing price baseline was not reproduced')
    all_daily=pd.concat(daily_frames,ignore_index=True); all_daily.to_parquet(out/'daily_equity.parquet',index=False)
    # Paired moving-block resampling is descriptive, not corrected for selection.
    rng=np.random.default_rng(20260925); days=sorted(all_daily.date.unique()); n=len(days)
    indices=np.array([np.concatenate([(start+np.arange(2))%n for start in rng.integers(0,n,size=(n+1)//2)])[:n] for _ in range(3000)])
    base=all_daily[all_daily.strategy=='price_only'].sort_values('date')
    base_ret=(base.net_pnl/base.start_equity).to_numpy()
    for met in metrics:
        d=all_daily[all_daily.strategy==met['id']].sort_values('date'); ret=(d.net_pnl/d.start_equity).to_numpy()
        delta=(np.prod(1+ret[indices],axis=1)-np.prod(1+base_ret[indices],axis=1))
        met['paired_return_diff_ci95_descriptive']=[float(v) for v in np.quantile(delta,[.025,.975])]
        met['pareto_return_vs_body_count']=not any(other['net_return']>=met['net_return']-1e-12 and other['unique_bodies']<=met['unique_bodies']
            and (other['net_return']>met['net_return']+1e-12 or other['unique_bodies']<met['unique_bodies']) for other in metrics)
    save_json(out/'metrics.json',metrics)
    pd.DataFrame(metrics).to_csv(out/'metrics.csv',index=False,encoding='utf-8-sig')
    save_json(out/'verification.json',{'baseline_reproduction_max_error':error,'strategy_count':len(metrics),
        'independent_ledger_max_error':max(r['independent_ledger_max_error'] for r in metrics),
        'original_risk_filter_reference':read(source/'summary.json')['metrics'],
        'learned_fusion_status':'not_run_insufficient_historical_training_news'})
    print(pd.DataFrame(metrics)[['id','final_equity','mdd','unique_bodies','changed_days_vs_price']].to_string(index=False),flush=True)


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('stage',choices=['prepare','collect','plan','bodies','analyze','replay','report'])
    parser.add_argument('--out',default='outputs/news_efficiency_20260601_0615')
    parser.add_argument('--source',default='outputs/news_ab_openai_20260601_0615_v2')
    parser.add_argument('--predictions',default='../../outputs/validation_report/predictions.parquet')
    parser.add_argument('--bars',default='../../outputs/validation_report/inputs/daily_bars.parquet')
    parser.add_argument('--env-file',default='.env.news_fusion')
    args=parser.parse_args(); out=Path(args.out); out.mkdir(parents=True,exist_ok=True); source=Path(args.source)
    if args.stage=='prepare': prepare(out,args.predictions,source)
    elif args.stage=='collect': collect(out)
    elif args.stage=='plan': plan(out)
    elif args.stage=='bodies': bodies(out)
    elif args.stage=='analyze': analyze(out,source,args.env_file)
    elif args.stage=='replay': replay(out,args.predictions,args.bars,source)
    elif args.stage=='report':
        from news_fusion.efficiency_report import report
        report(out)


if __name__=='__main__':
    main()

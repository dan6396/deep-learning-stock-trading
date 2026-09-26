"""Continuous June-September corpus. Retrospective research, not a fresh holdout."""
import argparse
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
import json

import numpy as np
import pandas as pd

from news_fusion.news import collect_google_rss,deduplicate,now,save_json
from run_news_residual_research import read,sha,text_for_day,OLD,SEP,BARS

OUT=Path('outputs/news_continuous_v1')
SIGNALS=Path('../../outputs/validation_report/predictions.parquet')
GAPS=[('2026-06-15','2026-06-27'),('2026-07-13','2026-07-26'),('2026-08-11','2026-09-12')]


def signals():
    cols=['date','entry_date','ticker','huber_ensemble']
    return pd.concat([pd.read_parquet(SIGNALS,columns=cols),pd.read_parquet(SEP/'price_signals.parquet',columns=cols)],ignore_index=True).sort_values(['entry_date','ticker']).reset_index(drop=True)


def collect():
    OUT.mkdir(parents=True,exist_ok=True)
    tickers=sorted(signals().ticker.unique())
    names=read(OLD/'companies.json')
    for member in read('../fresh_cache/members.json'):names.setdefault(member['ticker'],member['name'])
    assert not set(tickers)-set(names)
    windows=[]
    for start,end in GAPS:
        cursor=pd.Timestamp(start);stop=pd.Timestamp(end)
        while cursor<stop:
            finish=min(cursor+pd.Timedelta(days=7),stop)
            windows.append((str(cursor.date()),str(finish.date())));cursor=finish
    protocol={'created_at':now(),'gaps':GAPS,'windows':windows,'tickers':tickers,
              'max_split_depth':1,'workers':6,'cost':'no paid model API calls',
              'fixed_split':{'train':'2026-06','validation':'2026-07','evaluation':'2026-08-01..2026-09-23'},
              'status':'all periods previously inspected for prices; exploratory retrospective news extension',
              'source_hashes':{str(p):sha(p) for p in [SIGNALS,OLD/'discovered_articles.json',SEP/'discovered_articles.json',Path(__file__)]}}
    path=OUT/'collection_protocol.json'
    if path.exists():
        old=read(path);protocol['created_at']=old['created_at']
        if json.loads(json.dumps(protocol))!=old:raise ValueError('Frozen collection protocol changed')
    else:save_json(path,protocol)
    def one(ticker,start,end):
        result=collect_google_rss(names[ticker],ticker,start,end,OUT/'rss_cache')
        used=[result];audit=[{k:v for k,v in result.items() if k!='articles'}]
        if result['possibly_truncated'] and (pd.Timestamp(end)-pd.Timestamp(start)).days>1:
            mid=pd.Timestamp(start)+pd.Timedelta(days=(pd.Timestamp(end)-pd.Timestamp(start)).days//2)
            used=[collect_google_rss(names[ticker],ticker,start,str(mid.date()),OUT/'rss_cache'),
                  collect_google_rss(names[ticker],ticker,str(mid.date()),end,OUT/'rss_cache')]
            audit += [{k:v for k,v in r.items() if k!='articles'} for r in used]
        return [a for r in used for a in r['articles']],audit
    records=[];audit=[];errors=[]
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs={pool.submit(one,t,s,e):(t,s,e) for t in tickers for s,e in windows}
        for i,job in enumerate(as_completed(jobs),1):
            try:
                articles,logs=job.result();records.extend(articles);audit.extend(logs)
            except Exception as exc:
                errors.append({'request':jobs[job],'error':type(exc).__name__})
            if i%50==0 or i==len(jobs):print('Missing-date RSS',i,'/',len(jobs),'errors',len(errors),flush=True)
    save_json(OUT/'collection_audit.json',audit);save_json(OUT/'collection_errors.json',errors)
    save_json(OUT/'new_articles.json',deduplicate(records))
    if errors:raise RuntimeError('Incomplete collection; cached successful queries retained for resumption')
    combined=deduplicate(read(OLD/'discovered_articles.json')+read(SEP/'discovered_articles.json')+records)
    save_json(OUT/'discovered_articles.json',combined)
    print('Complete articles',len(combined),'queries',len(audit),'capped',sum(x['possibly_truncated'] for x in audit),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('stage',choices=['collect']);args=p.parse_args()
    collect()

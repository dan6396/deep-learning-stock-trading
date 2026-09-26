"""Frozen-encoder + rank residual experiments on previously inspected dates.

No claim of an untouched holdout: September has also already been examined.
All fits and hyperparameter choices use past dates only. Public RSS discovery
and cached article bodies are retrospective, not point-in-time archives.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, save_npz, load_npz
from sklearn.feature_extraction.text import TfidfVectorizer
from threadpoolctl import threadpool_limits

from news_fusion.news import now, save_json, timestamp, normalize_title
from news_fusion.residual import forecast_day, ranks, context_features
from news_fusion.guarded import select_top5
from portfolio_replay import simulate
from run_news_walkforward import SOURCE, BARS, feature_panel
from run_news_text_walkforward import add_titles

OUT = Path('outputs/news_residual_research_v2')
OLD = Path('outputs/news_regimes_calendar3_bounded')
SEP = Path('outputs/news_title_holdout_sep2026_v1')
MODEL = 'intfloat/multilingual-e5-small'


def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


@lru_cache(maxsize=150000)
def article_time(value):
    return timestamp(value)


def text_for_day(articles, day, max_articles=5, body=False):
    decision = timestamp(day).normalize()
    eligible = []
    for a in articles:
        pub = article_time(a['published_at'])
        if not decision-pd.Timedelta(days=3) <= pub.normalize() < decision:
            continue
        if a.get('modified_at') and article_time(a['modified_at']) >= decision:
            continue
        eligible.append(a)
    eligible.sort(key=lambda a: (a['published_at'], a['article_id']), reverse=True)
    selected, seen = [], set()
    for a in eligible:
        key = normalize_title(a['title'])
        if key in seen:
            continue
        seen.add(key)
        selected.append(a)
        if len(selected) == max_articles:
            break
    if body:
        text = '\n'.join(a['title']+'\n'+a.get('body', a['text']) for a in selected)
    else:
        text = '\n'.join(a['title'] for a in selected)
    return text, [a['article_id'] for a in selected]


def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    paths = [SOURCE/'scored_panel.parquet', BARS, OLD/'discovered_articles.json',
             OLD/'body_articles.json', OLD/'article_requests.json', OLD/'selected_headlines.json',
             SEP/'price_signals.parquet', SEP/'discovered_articles.json', SEP/'target_bars.parquet',
             Path(__file__), Path('news_fusion/residual.py')]
    protocol = {'version': 'rank-residual-v2', 'created_at': now(),
                'source_hashes': {str(p): sha(p) for p in paths},
                'status': 'exploratory; ALL dates including September previously inspected',
                'target': 'next-session Open/Close cross-sectional percentile rank minus Huber percentile rank',
                'warmup': 10, 'validation_days': 5, 'vocabulary_fit_days': 5,
                'alphas': [1, 10, 100], 'weights': [0, .25, .5, 1],
                'validation_selection': 'mean daily RankIC improvement > .005 over price; else zero news',
                'fixed_branch': {'alpha': 10, 'weight': .25},
                'articles': 'previous 3 calendar days; newest 5 unique titles per ticker; cached bodies max2',
                'semantic_encoder': MODEL, 'semantic_max_tokens': 256,
                'tfidf': 'char 2-4, min_df2, max_features4000, fitted first5 dates only',
                'portfolio': 'Top5 replacement-only, KRW10m per block, .125% each side; shared engine',
                'not_return_scores': 'percentile correction; no cost hurdle in rank units',
                'api_calls': 0,
                'limitations': ['retrospective capped RSS', 'body coverage selected by older candidate policy',
                                'no September bodies', 'limited training dates', 'no untouched test']}
    dest=OUT/'protocol.json'
    if dest.exists():
        old=read(dest);protocol['created_at']=old['created_at']
        if old != protocol:
            raise ValueError('Frozen research protocol changed; choose new output directory')
    else:
        save_json(dest,protocol)
    bars = pd.read_parquet(BARS);bars.ticker=bars.ticker.astype(str).str.zfill(6)
    old = add_titles(feature_panel(pd.read_parquet(SOURCE/'scored_panel.parquet'), bars))
    new = pd.read_parquet(SEP/'price_signals.parquet')
    new_bars = pd.read_parquet(SEP/'target_bars.parquet')
    new = new.merge(new_bars.rename(columns={'date':'entry_date'}), on=['entry_date','ticker'],validate='one_to_one')
    new['actual_oc']=new.Close/new.Open-1
    new['title_text']=''
    keep=['date','entry_date','ticker','huber_ensemble','actual_oc','title_text']
    frame=pd.concat([old[keep],new[keep]],ignore_index=True).sort_values(['entry_date','ticker']).reset_index(drop=True)
    frame['price_rank']=ranks(frame.huber_ensemble,frame.entry_date)
    frame['target_rank']=ranks(frame.actual_oc,frame.entry_date)
    discovered=read(OLD/'discovered_articles.json')+read(SEP/'discovered_articles.json')
    grouped=defaultdict(list)
    for a in discovered:
        grouped[a['ticker']].append(a)
    bodies=defaultdict(list)
    for a in read(OLD/'body_articles.json'):
        bodies[a['ticker']].append(a)
    audit=[];titles=[];texts=[]
    for row in frame.itertuples():
        title, ids=text_for_day(grouped[row.ticker],row.entry_date)
        body, bids=text_for_day(bodies[row.ticker],row.entry_date,max_articles=2,body=True)
        titles.append(title);texts.append(body)
        audit.append({'entry_date':str(row.entry_date.date()),'ticker':row.ticker,'title_ids':ids,'body_ids':bids})
    frame['universe_title']=titles;frame['body_text']=texts
    frame.to_parquet(OUT/'feature_panel.parquet',index=False)
    save_json(OUT/'article_membership.json',audit)
    cutoff=sorted(frame.entry_date.unique())[4]
    for column,name in [('universe_title','title_tfidf'),('body_text','body_tfidf')]:
        v=TfidfVectorizer(analyzer='char',ngram_range=(2,4),min_df=2,max_features=4000,sublinear_tf=True)
        v.fit(frame.loc[frame.entry_date<=cutoff,column])
        x=v.transform(frame[column])
        save_npz(OUT/(name+'.npz'),x)
        save_json(OUT/(name+'_vocabulary.json'),{'fit_through':str(pd.Timestamp(cutoff).date()),'size':len(v.vocabulary_)})
    print('Prepared',len(frame),'rows;',int(frame.universe_title.ne('').sum()),'title rows;',
          int(frame.body_text.ne('').sum()),'body rows',flush=True)


def embeddings():
    import requests
    import torch
    from transformers import AutoTokenizer, AutoModel
    torch.set_num_threads(6)
    info_path=OUT/'encoder.json'
    if info_path.exists():
        info=read(info_path)
    else:
        r=requests.get('https://huggingface.co/api/models/'+MODEL,timeout=30);r.raise_for_status()
        info={'model':MODEL,'revision':r.json()['sha'],'created_at':now(),'frozen':True}
        save_json(info_path,info)
    tokenizer=AutoTokenizer.from_pretrained(MODEL,revision=info['revision'],trust_remote_code=False)
    model=AutoModel.from_pretrained(MODEL,revision=info['revision'],trust_remote_code=False,use_safetensors=True).eval()
    for p in model.parameters():p.requires_grad_(False)
    info['parameters']=sum(p.numel() for p in model.parameters());info['trainable_parameters']=0
    save_json(info_path,info)
    frame=pd.read_parquet(OUT/'feature_panel.parquet')
    cache=OUT/'embedding_cache';cache.mkdir(exist_ok=True)
    # A fixed semantic encoder may transform later inputs without fitting on them.
    for column,name in [('universe_title','title_e5'),('body_text','body_e5')]:
        texts=frame[column].tolist()
        unique=list(dict.fromkeys(t for t in texts if t))
        todo=[t for t in unique if not (cache/(hashlib.sha256(t.encode()).hexdigest()+'.npy')).exists()]
        start=time.monotonic()
        for i in range(0,len(todo),16):
            chunk=todo[i:i+16]
            batch=tokenizer(['query: '+t for t in chunk],max_length=256,padding=True,truncation=True,return_tensors='pt')
            with torch.inference_mode():
                hidden=model(**batch).last_hidden_state
                mask=batch['attention_mask'][...,None]
                pooled=(hidden*mask).sum(1)/mask.sum(1)
                encoded=torch.nn.functional.normalize(pooled,p=2,dim=1).numpy()
            for text,vec in zip(chunk,encoded):
                np.save(cache/(hashlib.sha256(text.encode()).hexdigest()+'.npy'),vec)
            if i%160==0 or i+16>=len(todo):
                print(name,min(i+16,len(todo)),'/',len(todo),'elapsed',round(time.monotonic()-start),flush=True)
        matrix=np.zeros((len(frame),384),np.float32)
        for i,t in enumerate(texts):
            if t:matrix[i]=np.load(cache/(hashlib.sha256(t.encode()).hexdigest()+'.npy'))
        np.save(OUT/(name+'.npy'),matrix)


def fit():
    frame=pd.read_parquet(OUT/'feature_panel.parquet')
    matrices={n:load_npz(OUT/(n+'.npz')) for n in ['title_tfidf','body_tfidf']}
    for n in ['title_e5','body_e5']:
        matrices[n]=csr_matrix(np.load(OUT/(n+'.npy')))
    matrices['title_e5_context']=context_features(matrices['title_e5'],frame.price_rank)
    # News presence and price-rank interaction isolate selection/coverage effects.
    coverage=np.column_stack([frame.universe_title.ne(''),frame.body_text.ne('')]).astype(float)
    matrices['coverage']=context_features(csr_matrix(coverage),frame.price_rank)
    forecasts=[];choices=[]
    with threadpool_limits(limits=2):
        for date in sorted(frame.entry_date.unique())[10:]:
            scores,audit=forecast_day(frame,matrices,date)
            forecasts.append(scores);choices.extend(audit)
            print('Forecast',str(pd.Timestamp(date).date()),'selected',audit[-1]['selected'],flush=True)
    pd.concat(forecasts,ignore_index=True).to_parquet(OUT/'frozen_forecasts.parquet',index=False)
    save_json(OUT/'choices.json',choices)
    save_json(OUT/'score_audit.json',{'created_at':now(),'sha256':sha(OUT/'frozen_forecasts.parquet'),
                                    'features_sha256':sha(OUT/'feature_panel.parquet'),
                                    'branches':list(matrices),'test_targets_used_in_fit':False})


def evaluate():
    if sha(OUT/'frozen_forecasts.parquet') != read(OUT/'score_audit.json')['sha256']:
        raise ValueError('Forecasts changed')
    forecast=pd.read_parquet(OUT/'frozen_forecasts.parquet')
    labels=pd.read_parquet(OUT/'feature_panel.parquet')[['entry_date','ticker','actual_oc','target_rank']]
    forecast=forecast.merge(labels,on=['entry_date','ticker'],validate='one_to_one')
    bars=pd.read_parquet(BARS);bars.ticker=bars.ticker.astype(str).str.zfill(6)
    bars=pd.concat([bars,pd.read_parquet(SEP/'target_bars.parquet')],ignore_index=True).drop_duplicates(['date','ticker'],keep='last')
    old=read(SOURCE/'protocol.json')['selected_entry_dates']
    blocks={'down':old['down'],'up':old['up'],'sep':sorted(forecast.loc[forecast.entry_date>='2026-09-01','entry_date'].dt.strftime('%Y-%m-%d').unique())}
    strategies=['price_rank']+[c for c in forecast if c.endswith(('_fixed','_adaptive'))]+['selected_news']
    metrics=[];curves=[];ics=[];selections=[]
    for block,dates in blocks.items():
        group=forecast[forecast.entry_date.dt.strftime('%Y-%m-%d').isin(dates)]
        for strategy in strategies:
            for date,g in group.groupby('entry_date'):
                ics.append({'block':block,'date':date,'strategy':strategy,
                            'rank_ic':g[strategy].corr(g.actual_oc,method='spearman')})
            chosen=select_top5(group,strategy,0.)
            signal=chosen[['date','entry_date','ticker',strategy]].rename(columns={strategy:'huber_ensemble'})
            met,days,_,_=simulate(signal,bars)
            daily_returns=days.end_equity/days.start_equity-1
            met.update(block=block,strategy=strategy,
                       rank_ic=float(np.mean([v['rank_ic'] for v in ics if v['block']==block and v['strategy']==strategy])),
                       top5_mean_oc=float(chosen.actual_oc.mean()),
                       top5_positive_rate=float((chosen.actual_oc>0).mean()),
                       sharpe_annualized=float(daily_returns.mean()/daily_returns.std(ddof=1)*np.sqrt(252)))
            # A rank score is not an up/down probability; do not label rank>.5 as direction accuracy.
            metrics.append(met);days['block']=block;days['strategy']=strategy;curves.append(days)
            chosen['block']=block;chosen['strategy']=strategy;selections.append(chosen)
    pd.DataFrame(metrics).to_csv(OUT/'metrics.csv',index=False,encoding='utf-8-sig')
    pd.concat(curves).to_csv(OUT/'daily.csv',index=False,encoding='utf-8-sig')
    daily_ic=pd.DataFrame(ics);daily_ic.to_csv(OUT/'daily_ic.csv',index=False)
    pd.concat(selections).to_parquet(OUT/'selections.parquet',index=False)
    # Date-cluster bootstrap: stocks on the same day are not independent samples.
    pivot=daily_ic.pivot(index='date',columns='strategy',values='rank_ic')
    rng=np.random.default_rng(6396);indices=rng.integers(0,len(pivot),(5000,len(pivot)))
    intervals=[]
    for name in strategies:
        delta=(pivot[name]-pivot.price_rank).to_numpy()
        sample=delta[indices].mean(axis=1)
        intervals.append({'strategy':name,'mean_ic_gain':float(delta.mean()),
                          'date_bootstrap_95_low':float(np.quantile(sample,.025)),
                          'date_bootstrap_95_high':float(np.quantile(sample,.975)),
                          'note':'exploratory unadjusted intervals; not multiple-testing or serial-dependence corrected'})
    save_json(OUT/'ic_intervals.json',intervals)
    print(pd.DataFrame(metrics)[['block','strategy','rank_ic','final_equity','mdd']].to_string(index=False),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('stage',choices=['prepare','embeddings','fit','evaluate'])
    args=p.parse_args();{'prepare':prepare,'embeddings':embeddings,'fit':fit,'evaluate':evaluate}[args.stage]()

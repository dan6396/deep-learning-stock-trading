"""Longer-window news experiments with June training and July-only selection.

All dates are development/review dates. Nothing here is an untouched test.
No changes to production weights, no paid API, no price-ranked body availability.
"""
import argparse
from collections import defaultdict
import hashlib
from pathlib import Path
import json
import re

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix,load_npz,save_npz
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import Ridge
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.decomposition import PCA
from threadpoolctl import threadpool_limits

from news_fusion.news import now,save_json,normalize_title,timestamp
from news_fusion.residual import ranks,mean_ic
from news_fusion.guarded import select_top5
from portfolio_replay import simulate
from run_news_continuous import OUT,SIGNALS,signals
from run_news_residual_research import OLD,SEP,BARS,read,sha,MODEL

FEATURES=OUT/'models'
EARNINGS=('영업이익','순이익','잠정실적','실적 발표','흑자전환','적자전환','가이던스')
CONTRACT=('공급계약','계약 체결','수주 확정','수주 성공','최종 낙찰')
LEGAL=('과징금','소송','횡령','배임','영업정지','리콜')
CAPITAL=('유상증자','무상증자','전환사채','자사주','배당','공개매수')
PATTERNS=[EARNINGS,CONTRACT,LEGAL,CAPITAL]
SPORTS=('프로농구','프로축구','농구단','축구단','KBL')


def is_event(title):
    return not any(t in title for t in SPORTS) and any(t in title for group in PATTERNS for t in group)


def make_features():
    FEATURES.mkdir(exist_ok=True,parents=True)
    frame=signals()
    bars=pd.concat([pd.read_parquet(BARS),pd.read_parquet(SEP/'target_bars.parquet')],ignore_index=True)
    bars.ticker=bars.ticker.astype(str).str.zfill(6)
    bars=bars.drop_duplicates(['date','ticker'],keep='last')
    frame=frame.merge(bars.rename(columns={'date':'entry_date'}),on=['entry_date','ticker'],validate='one_to_one')
    frame['actual_oc']=frame.Close/frame.Open-1
    frame['price_rank']=ranks(frame.huber_ensemble,frame.entry_date)
    lookup=defaultdict(list)
    for a in read(OUT/'discovered_articles.json'):
        day=timestamp(a['published_at']).date().isoformat()
        lookup[(a['ticker'],day)].append(a)
    titles=[];event_text=[];counts=[];audit=[]
    for row in frame.itertuples():
        articles=[]
        for age in [1,2,3]:
            day=str((row.entry_date-pd.Timedelta(days=age)).date())
            articles.extend(lookup[(row.ticker,day)])
        articles.sort(key=lambda a:(a['published_at'],a['article_id']),reverse=True)
        unique=[];seen=set()
        for a in articles:
            key=normalize_title(a['title'])
            if key not in seen:unique.append(a);seen.add(key)
        events=[a for a in unique if is_event(a['title'])]
        titles.append('\n'.join(a['title'] for a in unique[:5]))
        event_text.append('\n'.join(a['title'] for a in events[:5]))
        counts.append([min(len(unique),20)/20,min(len(events),10)/10]+[
            min(sum(any(term in a['title'] for term in group) for a in unique),5)/5 for group in PATTERNS])
        audit.append({'entry_date':str(row.entry_date.date()),'ticker':row.ticker,
                      'title_ids':[a['article_id'] for a in unique[:5]],
                      'event_ids':[a['article_id'] for a in events[:5]]})
    frame['title_text']=titles;frame['event_text']=event_text
    frame.to_parquet(FEATURES/'panel.parquet',index=False)
    bars.to_parquet(FEATURES/'bars.parquet',index=False)
    save_json(FEATURES/'article_membership.json',audit)
    np.save(FEATURES/'event_counts.npy',np.asarray(counts,float))
    fit=frame.entry_date<'2026-07-01'
    v=TfidfVectorizer(analyzer='char',ngram_range=(2,4),min_df=3,max_features=4000,sublinear_tf=True)
    v.fit(frame.loc[fit,'title_text']);save_npz(FEATURES/'tfidf.npz',v.transform(frame.title_text))
    save_json(FEATURES/'vocabulary.json',{'fit_through':'2026-06-30','vocabulary':{k:int(i) for k,i in v.vocabulary_.items()}})
    print('Continuous panel',len(frame),'days',frame.entry_date.nunique(),'titles',frame.title_text.ne('').sum(),'event rows',frame.event_text.ne('').sum(),flush=True)


def embeddings():
    import torch
    from transformers import AutoTokenizer,AutoModel
    torch.set_num_threads(6)
    info=read(Path('outputs/news_residual_research_v2/encoder.json'))
    save_json(FEATURES/'encoder.json',info)
    tokenizer=AutoTokenizer.from_pretrained(MODEL,revision=info['revision'],trust_remote_code=False)
    model=AutoModel.from_pretrained(MODEL,revision=info['revision'],trust_remote_code=False,use_safetensors=True).eval()
    for p in model.parameters():p.requires_grad_(False)
    cache=FEATURES/'embedding_cache';cache.mkdir(exist_ok=True)
    old=Path('outputs/news_residual_research_v2/embedding_cache')
    frame=pd.read_parquet(FEATURES/'panel.parquet')
    for col,name in [('title_text','title_e5'),('event_text','event_e5')]:
        vectors={};todo=[]
        for text in dict.fromkeys(t for t in frame[col] if t):
            filename=hashlib.sha256(text.encode()).hexdigest()+'.npy'
            source=cache/filename
            if not source.exists():source=old/filename
            if source.exists():vectors[text]=np.load(source)
            else:todo.append(text)
        print(name,'reused',len(vectors),'new',len(todo),flush=True)
        for i in range(0,len(todo),16):
            chunk=todo[i:i+16]
            batch=tokenizer(['query: '+t for t in chunk],max_length=256,padding=True,truncation=True,return_tensors='pt')
            with torch.inference_mode():
                h=model(**batch).last_hidden_state;mask=batch['attention_mask'][...,None]
                x=torch.nn.functional.normalize((h*mask).sum(1)/mask.sum(1),p=2,dim=1).numpy()
            for t,v in zip(chunk,x):
                vectors[t]=v;np.save(cache/(hashlib.sha256(t.encode()).hexdigest()+'.npy'),v)
            if i%320==0 or i+16>=len(todo):print(name,min(i+16,len(todo)),'/',len(todo),flush=True)
        matrix=np.zeros((len(frame),384),np.float32)
        for i,t in enumerate(frame[col]):
            if t:matrix[i]=vectors[t]
        np.save(FEATURES/(name+'.npy'),matrix)


def return_residual(frame,idx):
    train=frame.iloc[idx]
    p=(frame.huber_ensemble-frame.groupby('entry_date').huber_ensemble.transform('mean')).to_numpy()
    y=np.clip((train.actual_oc-train.groupby('entry_date').actual_oc.transform('mean')).to_numpy(),-.1,.1)
    slope=float(np.clip(np.dot(p[idx],y)/(np.dot(p[idx],p[idx])+1e-12),.01,10.))
    return p*slope,y-p[idx]*slope


def predict(frame,matrix,fit,test,alpha,tree=False):
    base,residual=return_residual(frame,fit)
    if tree:
        model=HistGradientBoostingRegressor(max_iter=100,max_leaf_nodes=7,min_samples_leaf=100,
                                             learning_rate=.03,l2_regularization=10.,random_state=42).fit(matrix[fit],residual)
    else:model=Ridge(alpha=alpha,fit_intercept=False,solver='lsqr',tol=1e-5).fit(matrix[fit],residual)
    return base[test],np.clip(model.predict(matrix[test]),-.03,.03)


def fit_and_score():
    paths=[FEATURES/'panel.parquet',FEATURES/'title_e5.npy',FEATURES/'event_e5.npy',FEATURES/'tfidf.npz',FEATURES/'event_counts.npy',Path(__file__)]
    protocol={'created_at':now(),'source_hashes':{str(p):sha(p) for p in paths},
              'train':'June 2026','validation':'July 2026','evaluation':'August-September 23 2026',
              'alpha_grid':[1.,10.,100.],'weight_grid':[0.,.25,.5,1.],
              'selection':'July average RankIC improvement > .005; then lock alpha/weight for all evaluation dates',
              'refit':'expand daily with only earlier outcomes; never retune hyperparameters after July',
              'status':'exploratory; all review prices previously inspected; RSS retrospective',
              'body':'none; full-universe title study avoids price-selected body availability',
              'controls':['event_counts','company_identity','news_volume','price_tree'],
              'paper_relation':'inspired by newsflow return prediction; not original architecture reproduction'}
    dest=FEATURES/'protocol.json'
    if dest.exists():
        old=read(dest);protocol['created_at']=old['created_at']
        if protocol!=old:raise ValueError('Frozen continuous model protocol changed')
    else:save_json(dest,protocol)
    frame=pd.read_parquet(FEATURES/'panel.parquet');dates=frame.entry_date
    june=np.flatnonzero((dates<'2026-07-01').to_numpy())
    july=np.flatnonzero(((dates>='2026-07-01')&(dates<'2026-08-01')).to_numpy())
    matrices={'title_tfidf':load_npz(FEATURES/'tfidf.npz'),
              'title_e5':csr_matrix(np.load(FEATURES/'title_e5.npy')),
              'event_e5':csr_matrix(np.load(FEATURES/'event_e5.npy')),
              'event_counts':csr_matrix(np.load(FEATURES/'event_counts.npy'))}
    categories=sorted(frame.loc[june,'ticker'].unique());lookup={t:i for i,t in enumerate(categories)}
    identity=np.zeros((len(frame),len(categories)))
    for i,t in enumerate(frame.ticker):
        if t in lookup:identity[i,lookup[t]]=1.
    matrices['company_identity']=csr_matrix(identity)
    matrices['news_volume']=csr_matrix(np.load(FEATURES/'event_counts.npy')[:,:1])
    title=matrices['title_e5'].toarray()
    pca=PCA(n_components=32,random_state=42).fit(title[june])
    matrices['title_tree']=np.column_stack([pca.transform(title),frame.price_rank,frame.title_text.ne('').astype(float)])
    matrices['price_tree']=frame.price_rank.to_numpy()[:,None]
    val_dates=dates.iloc[july].to_numpy();val_y=frame.actual_oc.iloc[july].to_numpy()
    baseline=mean_ic(frame.price_rank.iloc[july].to_numpy(),val_y,val_dates)
    configs={};grid=[]
    with threadpool_limits(limits=2):
        for name,matrix in matrices.items():
            best=(baseline+.005,10.,0.)
            for alpha in ([10.] if name.endswith('_tree') else [1.,10.,100.]):
                base,delta=predict(frame,matrix,june,july,alpha,tree=name.endswith('_tree'))
                for weight in [.25,.5,1.]:
                    ic=mean_ic(base+weight*delta,val_y,val_dates)
                    grid.append({'method':name,'alpha':alpha,'weight':weight,'validation_ic':ic,'baseline_ic':baseline})
                    if ic>best[0]:best=(ic,alpha,weight)
            configs[name]={'alpha':best[1],'weight':best[2],'validation_ic':best[0] if best[2] else baseline}
        save_json(FEATURES/'frozen_configs.json',configs);save_json(FEATURES/'validation_grid.json',grid)
        print('July-frozen configs',json.dumps(configs),flush=True)
        eligible=['title_tfidf','title_e5','event_e5','title_tree']
        winner=max(eligible,key=lambda n:configs[n]['validation_ic'])
        if configs[winner]['weight']==0:winner='price_rank'
        save_json(FEATURES/'selected_strategy.json',{'selected':winner,'chosen_on':'July only'})
        forecasts=[];audit=[]
        for date in sorted(dates[dates>='2026-08-01'].unique()):
            train=np.flatnonzero((dates<date).to_numpy());test=np.flatnonzero((dates==date).to_numpy())
            assert dates.iloc[train].max()<date
            score=frame.iloc[test][['date','entry_date','ticker','huber_ensemble','price_rank']].copy()
            for name,matrix in matrices.items():
                b,delta=predict(frame,matrix,train,test,10.,tree=name.endswith('_tree'))
                score[name+'_fixed']=b+.25*delta
                config=configs[name]
                if config['weight']:
                    b,delta=predict(frame,matrix,train,test,config['alpha'],tree=name.endswith('_tree'))
                score[name+'_validated']=b+config['weight']*delta
            score['selected_news']=score.price_rank if winner=='price_rank' else score[winner+'_validated']
            forecasts.append(score);audit.append({'forecast_date':str(pd.Timestamp(date).date()),'last_training_date':str(pd.Timestamp(dates.iloc[train].max()).date())})
            print('Continuous forecast',str(pd.Timestamp(date).date()),flush=True)
    pd.concat(forecasts,ignore_index=True).to_parquet(FEATURES/'frozen_forecasts.parquet',index=False)
    save_json(FEATURES/'fit_audit.json',audit)
    save_json(FEATURES/'score_audit.json',{'sha256':sha(FEATURES/'frozen_forecasts.parquet')})


def evaluate():
    assert sha(FEATURES/'frozen_forecasts.parquet')==read(FEATURES/'score_audit.json')['sha256']
    frame=pd.read_parquet(FEATURES/'panel.parquet')
    forecast=pd.read_parquet(FEATURES/'frozen_forecasts.parquet')
    forecast=forecast.merge(frame[['entry_date','ticker','actual_oc']],on=['entry_date','ticker'],validate='one_to_one')
    bars=pd.read_parquet(FEATURES/'bars.parquet')
    strategies=['price_rank']+[c for c in forecast if c.endswith(('_fixed','_validated'))]+['selected_news']
    metrics=[];curves=[];ics=[];selections=[]
    for block in ['all','aug','sep']:
        group=forecast if block=='all' else forecast[forecast.entry_date.dt.month==(8 if block=='aug' else 9)]
        for name in strategies:
            ic=group.groupby('entry_date').apply(lambda g:g[name].corr(g.actual_oc,method='spearman'),include_groups=False)
            chosen=select_top5(group,name,0.)
            signal=chosen[['date','entry_date','ticker',name]].rename(columns={name:'huber_ensemble'})
            met,days,_,_=simulate(signal,bars)
            met.update(block=block,strategy=name,rank_ic=float(ic.mean()),top5_mean_oc=float(chosen.actual_oc.mean()))
            metrics.append(met);days['block']=block;days['strategy']=name;curves.append(days)
            for date,value in ic.items():ics.append({'block':block,'date':date,'strategy':name,'rank_ic':value})
            chosen['block']=block;chosen['strategy']=name;selections.append(chosen)
    pd.DataFrame(metrics).to_csv(FEATURES/'metrics.csv',index=False,encoding='utf-8-sig')
    pd.concat(curves).to_csv(FEATURES/'daily.csv',index=False,encoding='utf-8-sig')
    pd.DataFrame(ics).to_csv(FEATURES/'daily_ic.csv',index=False)
    pd.concat(selections).to_parquet(FEATURES/'selections.parquet',index=False)
    print(pd.DataFrame(metrics)[['block','strategy','rank_ic','final_equity','mdd']].to_string(index=False),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('stage',choices=['features','embeddings','fit','evaluate'])
    stage=p.parse_args().stage
    {'features':make_features,'embeddings':embeddings,'fit':fit_and_score,'evaluate':evaluate}[stage]()

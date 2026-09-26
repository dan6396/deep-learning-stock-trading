"""Correct body availability to SAME-DATE original request plans.

v2 pooled cached body availability across future candidate plans. Its apparent
body improvements are not usable evidence. This run preserves the title inputs
but prohibits that cross-date body selection and adds matched coverage controls.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix,load_npz,save_npz
from sklearn.feature_extraction.text import TfidfVectorizer
from threadpoolctl import threadpool_limits

from news_fusion.news import now,save_json
from news_fusion.residual import forecast_day,context_features
import run_news_residual_research as base

OUT=Path('outputs/news_residual_corrected_v3')
PREVIOUS=base.OUT
OLD=base.OLD


def prepare():
    OUT.mkdir(exist_ok=True,parents=True)
    paths=[PREVIOUS/'feature_panel.parquet',OLD/'article_requests.json',OLD/'body_articles.json',
           Path(__file__),Path('news_fusion/residual.py')]
    protocol={'version':'same-date-body-v3','created_at':now(),
              'source_hashes':{str(p):base.sha(p) for p in paths},
              'parent_protocol_sha':base.sha(PREVIOUS/'protocol.json'),
              'change':'body text ONLY from same ticker/date original article_requests; retain publication and revision gates',
              'controls':['body presence only','body presence x price rank'],
              'status':'exploratory, corrective rerun after availability bias detected; v2 results superseded'}
    path=OUT/'protocol.json'
    if path.exists():
        old=base.read(path);protocol['created_at']=old['created_at']
        if old!=protocol:raise ValueError('Frozen correction protocol changed')
    else:save_json(path,protocol)
    frame=pd.read_parquet(PREVIOUS/'feature_panel.parquet')
    bodies={a['parent_article_id']:a for a in base.read(OLD/'body_articles.json')}
    by_day=defaultdict(list)
    for request in base.read(OLD/'article_requests.json'):
        a=bodies.get(request['parent_article_id'])
        if a is not None:by_day[(request['entry_date'],request['ticker'])].append(a)
    texts=[];audit=[]
    for row in frame.itertuples():
        available=by_day[(str(row.entry_date.date()),row.ticker)]
        text,ids=base.text_for_day(available,row.entry_date,max_articles=2,body=True)
        texts.append(text)
        allowed={a['article_id'] for a in available}
        assert set(ids)<=allowed
        audit.append({'entry_date':str(row.entry_date.date()),'ticker':row.ticker,'body_ids':ids})
    frame['body_text']=texts
    frame.to_parquet(OUT/'feature_panel.parquet',index=False)
    save_json(OUT/'article_membership.json',audit)
    cutoff=sorted(frame.entry_date.unique())[4]
    v=TfidfVectorizer(analyzer='char',ngram_range=(2,4),min_df=2,max_features=4000,sublinear_tf=True)
    v.fit(frame.loc[frame.entry_date<=cutoff,'body_text'])
    save_npz(OUT/'body_tfidf.npz',v.transform(frame.body_text))
    for name in ['title_tfidf.npz','title_e5.npy','encoder.json','environment.json']:
        shutil.copyfile(PREVIOUS/name,OUT/name)
    print('Corrected body stock days',int(frame.body_text.ne('').sum()),flush=True)


def embeddings():
    import torch
    from transformers import AutoTokenizer,AutoModel
    torch.set_num_threads(6)
    info=base.read(OUT/'encoder.json')
    tok=AutoTokenizer.from_pretrained(base.MODEL,revision=info['revision'],trust_remote_code=False)
    model=AutoModel.from_pretrained(base.MODEL,revision=info['revision'],trust_remote_code=False,use_safetensors=True).eval()
    for p in model.parameters():p.requires_grad_(False)
    frame=pd.read_parquet(OUT/'feature_panel.parquet')
    texts=list(dict.fromkeys(t for t in frame.body_text if t))
    cache=OUT/'embedding_cache';cache.mkdir(exist_ok=True)
    vectors={};todo=[]
    for text in texts:
        name=hashlib.sha256(text.encode()).hexdigest()+'.npy'
        path=cache/name
        if not path.exists():path=PREVIOUS/'embedding_cache'/name
        if path.exists():vectors[text]=np.load(path)
        else:todo.append(text)
    print('Body encodings reused',len(vectors),'new',len(todo),flush=True)
    for i in range(0,len(todo),16):
        chunk=todo[i:i+16]
        batch=tok(['query: '+t for t in chunk],max_length=256,padding=True,truncation=True,return_tensors='pt')
        with torch.inference_mode():
            h=model(**batch).last_hidden_state;mask=batch['attention_mask'][...,None]
            vec=torch.nn.functional.normalize((h*mask).sum(1)/mask.sum(1),p=2,dim=1).numpy()
        for t,x in zip(chunk,vec):
            vectors[t]=x;np.save(cache/(hashlib.sha256(t.encode()).hexdigest()+'.npy'),x)
    x=np.zeros((len(frame),384),np.float32)
    for i,t in enumerate(frame.body_text):
        if t:x[i]=vectors[t]
    np.save(OUT/'body_e5.npy',x)


def fit():
    frame=pd.read_parquet(OUT/'feature_panel.parquet')
    matrices={n:load_npz(OUT/(n+'.npz')) for n in ['title_tfidf','body_tfidf']}
    for n in ['title_e5','body_e5']:matrices[n]=csr_matrix(np.load(OUT/(n+'.npy')))
    matrices['title_e5_context']=context_features(matrices['title_e5'],frame.price_rank)
    coverage=np.column_stack([frame.universe_title.ne(''),frame.body_text.ne('')]).astype(float)
    matrices['coverage']=context_features(csr_matrix(coverage),frame.price_rank)
    presence=csr_matrix(frame.body_text.ne('').to_numpy(float)[:,None])
    controls={'body_presence':presence,'body_presence_context':context_features(presence,frame.price_rank)}
    forecasts=[];choices=[]
    with threadpool_limits(limits=2):
        for date in sorted(frame.entry_date.unique())[10:]:
            score,audit=forecast_day(frame,matrices,date)
            control,c_audit=forecast_day(frame,controls,date)
            for name in controls:
                for suffix in ['_fixed','_adaptive']:score[name+suffix]=control[name+suffix].to_numpy()
            forecasts.append(score);choices.extend(audit);choices.extend([a for a in c_audit if a['branch']!='selected_news'])
            print('Corrected forecast',str(pd.Timestamp(date).date()),flush=True)
    pd.concat(forecasts,ignore_index=True).to_parquet(OUT/'frozen_forecasts.parquet',index=False)
    save_json(OUT/'choices.json',choices)
    save_json(OUT/'score_audit.json',{'created_at':now(),'sha256':base.sha(OUT/'frozen_forecasts.parquet'),
                                    'features_sha256':base.sha(OUT/'feature_panel.parquet'),
                                    'no_cross_date_body_request':True})


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('stage',choices=['prepare','embeddings','fit','evaluate','report'])
    stage=p.parse_args().stage
    if stage=='evaluate':base.OUT=OUT;base.evaluate()
    elif stage=='report':
        import report_news_residual as report
        report.OUT=OUT;report.report()
    else:{'prepare':prepare,'embeddings':embeddings,'fit':fit}[stage]()

"""Exploratory calibrated-price residual learning, on corrected news availability.

Unlike subtracting full price percentiles from realized percentiles, first
estimate price's predictive slope on past data and learn only residual returns.
All choices remain chronological. This is our small-data design, not a paper reproduction.
"""
from pathlib import Path
import json

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix,load_npz
from sklearn.linear_model import Ridge
from threadpoolctl import threadpool_limits

from news_fusion.news import save_json,now
from news_fusion.residual import mean_ic,context_features
from run_news_residual_corrected import OUT as DATA
import run_news_residual_research as shared

OUT=Path('outputs/news_orthogonal_v1')
ALPHAS=(1.,10.,100.)
WEIGHTS=(.25,.5,1.)


def branch_prediction(frame,x,fit,test,alpha):
    price=frame.huber_ensemble-frame.groupby('entry_date').huber_ensemble.transform('mean')
    # Cross-sectional market removal is performed only on realized training dates.
    train=frame.iloc[fit]
    y=(train.actual_oc-train.groupby('entry_date').actual_oc.transform('mean')).to_numpy()
    y=np.clip(y,-.10,.10)  # fixed robustness cap; not tuned on evaluation outcomes
    p=price.to_numpy()
    slope=float(np.dot(p[fit],y)/(np.dot(p[fit],p[fit])+1e-12))
    # Preserve the adopted Huber ordering, even if tiny past windows suggest reversal.
    slope=float(np.clip(slope,.01,10.))
    residual=y-slope*p[fit]
    model=Ridge(alpha=alpha,fit_intercept=False,solver='lsqr',tol=1e-5).fit(x[fit],residual)
    return slope*p[test],np.clip(model.predict(x[test]),-.03,.03),slope


def run():
    OUT.mkdir(exist_ok=True,parents=True)
    paths=[DATA/'feature_panel.parquet',DATA/'title_e5.npy',DATA/'body_e5.npy',DATA/'title_tfidf.npz',DATA/'body_tfidf.npz',Path(__file__)]
    protocol={'created_at':now(),'source_hashes':{str(p):shared.sha(p) for p in paths},
              'status':'exploratory after inspecting other experiments; no untouched holdout',
              'target':'daily-centered Open/Close return minus calibrated Huber return',
              'price_calibration':'past-only OLS slope, clipped [.01,10] to preserve original ranking',
              'training_target_clip':[-.10,.10],'correction_clip':[-.03,.03],
              'alphas':ALPHAS,'weights':[0]+list(WEIGHTS),'warmup':10,'validation_days':5,
              'validation_gain_required':.005,'fixed':{'alpha':10,'weight':.25},
              'body_membership':'same-date original request plan, from corrected v3',
              'selection_candidates':['title_tfidf','body_tfidf','title_e5','body_e5','title_e5_context'],
              'controls':['body_presence','body_presence_context']}
    dest=OUT/'protocol.json'
    if dest.exists():
        old=shared.read(dest);protocol['created_at']=old['created_at']
        if json.loads(json.dumps(protocol))!=old:raise ValueError('Frozen orthogonal protocol changed')
    else:save_json(dest,protocol)
    frame=pd.read_parquet(DATA/'feature_panel.parquet')
    matrices={name:load_npz(DATA/(name+'.npz')) for name in ['title_tfidf','body_tfidf']}
    for name in ['title_e5','body_e5']:matrices[name]=csr_matrix(np.load(DATA/(name+'.npy')))
    matrices['title_e5_context']=context_features(matrices['title_e5'],frame.price_rank)
    presence=csr_matrix(frame.body_text.ne('').to_numpy(float)[:,None])
    matrices['body_presence']=presence
    matrices['body_presence_context']=context_features(presence,frame.price_rank)
    dates=sorted(frame.entry_date.unique());forecasts=[];audit=[]
    with threadpool_limits(limits=2):
        for date in dates[10:]:
            previous=[d for d in dates if d<date];cutoff=previous[-5]
            fit=np.flatnonzero((frame.entry_date<cutoff).to_numpy())
            valid=np.flatnonzero(((frame.entry_date>=cutoff)&(frame.entry_date<date)).to_numpy())
            train=np.flatnonzero((frame.entry_date<date).to_numpy())
            test=np.flatnonzero((frame.entry_date==date).to_numpy())
            assert frame.entry_date.iloc[fit].max()<cutoff<=frame.entry_date.iloc[train].max()<date
            valid_y=frame.actual_oc.to_numpy()[valid];valid_dates=frame.entry_date.to_numpy()[valid]
            baseline=mean_ic(frame.price_rank.to_numpy()[valid],valid_y,valid_dates)
            score=frame.iloc[test][['date','entry_date','ticker','huber_ensemble','price_rank']].copy()
            best_all=(baseline+.005,'price_rank')
            for name,x in matrices.items():
                best=(baseline+.005,0.,0.)
                for alpha in ALPHAS:
                    b,delta,_=branch_prediction(frame,x,fit,valid,alpha)
                    for weight in WEIGHTS:
                        ic=mean_ic(b+weight*delta,valid_y,valid_dates)
                        if ic>best[0]:best=(ic,alpha,weight)
                b,delta,slope=branch_prediction(frame,x,train,test,10.)
                score[name+'_fixed']=b+.25*delta
                if best[2]:
                    b,delta,slope=branch_prediction(frame,x,train,test,best[1])
                    score[name+'_adaptive']=b+best[2]*delta
                else:score[name+'_adaptive']=b
                audit.append({'forecast_date':str(pd.Timestamp(date).date()),'branch':name,
                              'alpha':best[1],'weight':best[2],'price_slope':slope,
                              'fit_last_date':str(pd.Timestamp(frame.entry_date.iloc[fit].max()).date()),
                              'validation_first':str(pd.Timestamp(cutoff).date()),
                              'refit_last_date':str(pd.Timestamp(previous[-1]).date()),
                              'validation_ic':best[0] if best[2] else baseline,'base_validation_ic':baseline})
                if name in protocol['selection_candidates'] and best[2] and best[0]>best_all[0]:
                    best_all=(best[0],name+'_adaptive')
            score['selected_news']=score[best_all[1]]
            audit.append({'forecast_date':str(pd.Timestamp(date).date()),'branch':'selected_news','selected':best_all[1]})
            forecasts.append(score)
            print('Calibrated-residual forecast',str(pd.Timestamp(date).date()),best_all[1],flush=True)
    pd.concat(forecasts,ignore_index=True).to_parquet(OUT/'frozen_forecasts.parquet',index=False)
    save_json(OUT/'choices.json',audit)
    save_json(OUT/'score_audit.json',{'sha256':shared.sha(OUT/'frozen_forecasts.parquet'),'created_at':now()})
    shared.OUT=OUT
    # Evaluation uses the same membership/labels and replay; no fitting in this stage.
    frame.to_parquet(OUT/'feature_panel.parquet',index=False)
    shared.evaluate()


if __name__=='__main__':run()

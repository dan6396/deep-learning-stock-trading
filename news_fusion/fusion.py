"""Time-aware features, chronological linear stacking and exact score attribution."""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd
from .news import eligible, deduplicate, timestamp, digest, now

FEATURES=['price_z','sentiment','negative_share','news_volume','news_missing']

def build_features(predictions, articles, extractions, mode='strict', cutoff='08:30', lookback_days=3):
    scopes={a.get('text_scope','unspecified') for a in articles}
    if len(scopes)>1:raise ValueError('Do not mix headline-only and body news datasets')
    text_scope=next(iter(scopes),'none')
    metadata=[c for c in ['return_1','price_training_end','prediction_kind','label_available_at'] if c in predictions]
    p=predictions[['date','entry_date','ticker','huber_ensemble']+metadata].copy()
    if p.empty:raise ValueError('No price predictions')
    p['ticker']=p.ticker.astype(str).str.zfill(6)
    p['date']=pd.to_datetime(p.date);p['entry_date']=pd.to_datetime(p.entry_date)
    if p.duplicated(['entry_date','ticker']).any() or not np.isfinite(p.huber_ensemble).all():
        raise ValueError('Duplicate or invalid price predictions')
    if not (p.date < p.entry_date).all():
        raise ValueError('Price signal must precede entry date')
    mean=p.groupby('entry_date').huber_ensemble.transform('mean')
    std=p.groupby('entry_date').huber_ensemble.transform(lambda x:x.std(ddof=0)).clip(lower=1e-8)
    p['price_z']=(p.huber_ensemble-mean)/std
    by_ticker={}
    for a in deduplicate(articles):by_ticker.setdefault(a['ticker'],[]).append(a)
    lookup={e['article_id']:e for e in extractions}
    rows=[]
    for r in p.to_dict('records'):
        decision=timestamp(f"{r['entry_date'].date()} {cutoff}")
        selected=[a for a in by_ticker.get(r['ticker'],[]) if eligible(a,decision,lookback_days,mode)]
        values=[];weights=[];evidence=[];unresolved=0
        for a in selected:
            e=lookup.get(a['article_id'])
            if e is None:
                unresolved+=1;continue
            result=e['result']
            if result['relevance'] not in ['direct','indirect'] or result['insufficient_context'] or result['sentiment']=='unclear':
                continue
            value={'negative':-1.,'neutral':0.,'positive':1.}[result['sentiment']]
            age=max(0.,(decision-timestamp(a['published_at'])).total_seconds()/3600)
            weight=(1. if result['relevance']=='direct' else .5)*np.exp(-age/24.)
            values.append(value);weights.append(weight);evidence.append(a['article_id'])
        r.update(decision_at=decision.isoformat(),sentiment=float(np.average(values,weights=weights)) if values else 0.,
                 negative_share=float(np.average(np.array(values)<0,weights=weights)) if values else 0.,
                 news_volume=float(np.log1p(len(values))),news_missing=float(not values),
                 eligible_articles=len(selected),usable_articles=len(values),unprocessed_articles=unresolved,
                 evidence_ids=json.dumps(evidence),availability_mode=mode,news_text_scope=text_scope)
        rows.append(r)
    return pd.DataFrame(rows)

def validate_oof(frame):
    required=['price_training_end','prediction_kind','label_available_at','return_1']
    if any(c not in frame for c in required):
        raise ValueError('Fit requires historical walk-forward price prediction provenance and label availability')
    if not frame.prediction_kind.eq('walk_forward').all():
        raise ValueError('In-sample price predictions cannot train fusion')
    if not (pd.to_datetime(frame.price_training_end)<pd.to_datetime(frame.date)).all():
        raise ValueError('Price model was trained on/after its signal date')
    if not np.isfinite(frame[FEATURES+['return_1']]).all().all():
        raise ValueError('Nonfinite training features or targets')
    if frame.availability_mode.nunique()!=1:
        raise ValueError('Do not mix strict and exploratory news histories')
    close=pd.to_datetime(frame.entry_date).map(lambda d:timestamp(d)+pd.Timedelta(hours=15,minutes=30))
    if not (frame.label_available_at.map(timestamp)>=close).all():
        raise ValueError('Open-to-close label cannot be known before the close')

def rank_ic(frame, score):
    x=frame[['entry_date','return_1']].copy();x['score']=score
    values=[g.score.corr(g.return_1,method='spearman') for _,g in x.groupby('entry_date') if len(g)>=5 and g.score.nunique()>1 and g.return_1.nunique()>1]
    return float(np.nanmean(values)) if values else float('nan')

def fit_fusion(frame, train_end, validation_end):
    """Validation chooses ridge penalty; no refit on validation and no test access.

    The caller supplies walk-forward provenance; this validates declared cutoffs,
    not independent authenticity of upstream checkpoints. News encoder must also
    be frozen and its training-date limitation documented.
    """
    validate_oof(frame)
    tr_end=timestamp(train_end)+pd.Timedelta(days=1)
    va_end=timestamp(validation_end)+pd.Timedelta(days=1)
    if tr_end>=va_end:raise ValueError('Invalid chronological split')
    decisions=frame.decision_at.map(timestamp)
    available=frame.label_available_at.map(timestamp)
    train=frame[(decisions<tr_end)&(available<tr_end)].copy()
    val=frame[(decisions>=tr_end)&(decisions<va_end)&(available<va_end)].copy()
    if train.entry_date.nunique()<20 or val.entry_date.nunique()<10:
        raise ValueError('Need at least 20 training and 10 validation dates')
    if train.usable_articles.sum()==0 or val.usable_articles.sum()==0:
        raise ValueError('No usable news for chronological fit/validation')
    x=train[FEATURES].to_numpy(float);mean=x.mean(0);std=x.std(0);std[std<1e-8]=1.
    z=(x-mean)/std;y=train.return_1.to_numpy(float);intercept=float(y.mean())
    candidates=[]
    for alpha in [1.,10.,100.]:
        beta=np.linalg.solve(z.T@z+alpha*np.eye(z.shape[1]),z.T@(y-intercept))
        score=intercept+((val[FEATURES].to_numpy(float)-mean)/std)@beta
        ic=rank_ic(val,score)
        if np.isfinite(ic):candidates.append((ic,alpha,beta))
    if not candidates:raise ValueError('Validation Rank IC undefined')
    ic,alpha,beta=max(candidates,key=lambda a:a[0])
    return {'format':'linear-news-fusion-v1','created_at':now(),'features':FEATURES,
            'mean':mean.tolist(),'std':std.tolist(),'coefficients':beta.tolist(),'intercept':intercept,
            'ridge_alpha':alpha,'validation_rank_ic':ic,'train_end':str(train_end),
            'validation_end':str(validation_end),'available_after':va_end.isoformat(),
            'training_data_sha256':digest(frame[FEATURES+['entry_date','ticker','return_1','price_training_end']].astype(str).to_dict('records')),
            'availability_mode':str(frame.availability_mode.iloc[0]),
            'news_text_scope':str(frame.news_text_scope.iloc[0]) if 'news_text_scope' in frame else 'unspecified',
            'training_days':int(train.entry_date.nunique()),'validation_days':int(val.entry_date.nunique())}

def score_and_select(features, model=None, pool_size=20):
    if pool_size<5:raise ValueError('Candidate pool must contain at least five stocks')
    f=features.copy()
    if model is None:
        # Identity baseline, not a fabricated news-enhanced strategy.
        f['final_score']=f.huber_ensemble
        f['price_contribution']=f.huber_ensemble;f['news_contribution']=0.
        f['intercept_contribution']=0.;f['selection_model']='price_only_no_fitted_fusion'
    else:
        if model['format']!='linear-news-fusion-v1' or model['features']!=FEATURES:
            raise ValueError('Unsupported fusion model')
        if any(timestamp(d)<timestamp(model['available_after']) for d in f.decision_at):
            raise ValueError('Cannot score a period used for fitting/validation')
        if not f.availability_mode.eq(model['availability_mode']).all():
            raise ValueError('News availability policy differs from training')
        if 'news_text_scope' in model and ('news_text_scope' not in f or not f.news_text_scope.eq(model['news_text_scope']).all()):
            raise ValueError('News text scope differs from training')
        mu=np.array(model['mean']);sd=np.array(model['std']);beta=np.array(model['coefficients'])
        if not np.isfinite(np.r_[mu,sd,beta,model['intercept']]).all() or (sd<=0).any():
            raise ValueError('Invalid model coefficients')
        contributions=(f[FEATURES].to_numpy(float)-mu)/sd*beta
        for i,name in enumerate(FEATURES):f['contribution_'+name]=contributions[:,i]
        f['price_contribution']=contributions[:,0];f['news_contribution']=contributions[:,1:].sum(1)
        f['intercept_contribution']=model['intercept']
        f['final_score']=model['intercept']+contributions.sum(1)
        f['selection_model']='fitted_linear_fusion'
    f=f.sort_values(['entry_date','huber_ensemble','ticker'],ascending=[True,False,True])
    f['price_rank']=f.groupby('entry_date').cumcount()+1
    pool=f[f.price_rank<=pool_size].copy()
    pool=pool.sort_values(['entry_date','final_score','ticker'],ascending=[True,False,True])
    pool['final_rank']=pool.groupby('entry_date').cumcount()+1
    pool['selected']=pool.final_rank<=5
    if pool.groupby('entry_date').selected.sum().ne(5).any():raise ValueError('Insufficient candidates')
    np.testing.assert_allclose(pool.final_score,pool.price_contribution+pool.news_contribution+pool.intercept_contribution,rtol=1e-10,atol=1e-12)
    return pool

def replay_selection(selection,bars):
    from portfolio_replay import simulate
    top=selection[selection.selected].copy()
    signals=top[['date','entry_date','ticker','final_score']].rename(columns={'final_score':'huber_ensemble'})
    return simulate(signals,bars)

def import_step2(frame, entry_date):
    """Connect integrated_pipeline.py's full STEP2 ranking to this module.
    Caller must supply the next actual trading session (never infer weekends).
    """
    f=frame[frame.prediction_status.eq('ok')].copy()
    if 'prediction_target' in f and not f.prediction_target.eq('next_session_open_to_close').all():
        raise ValueError('Expected Huber return scores, not classification probabilities')
    f=f.rename(columns={'prediction_base_date':'date','ensemble_pred_return':'huber_ensemble'})
    f['entry_date']=pd.Timestamp(entry_date)
    if pd.to_datetime(f.date).nunique()!=1:raise ValueError('STEP2 contains mixed signal sessions')
    return f[['date','entry_date','ticker','huber_ensemble']]

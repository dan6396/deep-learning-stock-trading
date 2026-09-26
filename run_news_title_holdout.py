"""One locked title-fusion check on the later September 2026 KOSPI200 window.

No new LLM calls. The title model is fitted on the prior 30 news-labeled dates,
then all new scores are saved before evaluating their realized returns.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd
from pykrx import stock
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import Ridge

from data import _compute_indicators, FEATURE_COLS, SEQ_LEN
from ensemble import HuberEnsemble, DEFAULT_MANIFEST
from news_fusion.efficient import candidate_plan
from news_fusion.news import collect_google_rss, deduplicate, now, save_json, timestamp
from news_fusion.guarded import select_top5
from portfolio_replay import simulate
from run_news_text_walkforward import add_titles
from run_news_walkforward import SOURCE, BARS, feature_panel


ROOT = Path(__file__).resolve().parents[1]
OUT = Path('outputs/news_title_holdout_sep2026_v1')
RAW = ROOT/'ablation/all_ohlcv.parquet'
OLD_PRICE = ROOT.parent/'outputs/validation_report/predictions.parquet'
OLD_NEWS = Path('outputs/news_regimes_calendar3_bounded')
MEMBERS = ROOT/'fresh_cache/members.json'
START = '2026-09-15'
END = '2026-09-23'
ALPHA = 100.0


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def price_universe():
    previous = pd.read_parquet(OLD_PRICE, columns=['entry_date','ticker'])
    return sorted(previous[previous.entry_date == pd.Timestamp('2026-09-14')].ticker.unique())


def fetch_bars(out):
    tickers = price_universe()
    if len(tickers) != 200:
        raise ValueError('Expected 200 pre-frozen September constituents')
    cache = out/'ticker_bars';cache.mkdir(exist_ok=True)
    failures=[]
    def one(ticker):
        path = cache/(ticker+'.parquet')
        if path.exists():
            return pd.read_parquet(path)
        d = stock.get_market_ohlcv_by_date('20260912','20260923',ticker,adjusted=True)
        d = d.rename(columns={'시가':'Open','고가':'High','저가':'Low','종가':'Close','거래량':'Volume'})
        d = d[['Open','High','Low','Close','Volume']].copy()
        if d.empty:
            raise ValueError('Empty OHLCV')
        d.index.name = 'Date'
        d.to_parquet(path)
        return d
    frames=[]
    # pykrx/Naver requests are kept serial to avoid stalled concurrent sessions.
    with ThreadPoolExecutor(max_workers=1) as pool:
        jobs={pool.submit(one,t):t for t in tickers}
        for i,job in enumerate(as_completed(jobs),1):
            ticker=jobs[job]
            try:
                d=job.result();d['Ticker']=ticker;frames.append(d)
            except Exception as exc:
                failures.append({'ticker':ticker,'error':type(exc).__name__})
            if i%25==0 or i==len(tickers):
                print('Recent bars',i,'/',len(tickers),'failures',len(failures),flush=True)
    if failures:
        save_json(out/'bar_failures.json',failures)
        raise RuntimeError('Missing recent bars; no evaluation')
    bars=pd.concat(frames).sort_index()
    bars.to_parquet(out/'recent_bars.parquet')
    print('Recent calendar',sorted(bars.loc[bars.Ticker=='005930'].index.strftime('%Y-%m-%d')),flush=True)


def make_price_panel(out):
    tickers=price_universe()
    old=pd.read_parquet(RAW)
    recent=pd.read_parquet(out/'recent_bars.parquet')
    calendar=sorted(recent.loc[recent.Ticker=='005930'].index.unique())
    entry=[d for d in calendar if pd.Timestamp(START)<=d<=pd.Timestamp(END)]
    if len(entry)<5:
        raise ValueError('Too few new trading dates')
    prior={d:calendar[i-1] for i,d in enumerate(calendar) if i>0}
    windows=[];records=[];bar_rows=[]
    for ticker in tickers:
        g=pd.concat([old.loc[old.Ticker==ticker],recent.loc[recent.Ticker==ticker]])
        g=g[~g.index.duplicated(keep='last')].sort_index()
        feat=_compute_indicators(g.copy())[FEATURE_COLS]
        for target in entry:
            signal=prior[target]
            if signal not in g.index or target not in g.index:
                continue
            hist=feat.loc[:signal].tail(SEQ_LEN)
            price=g.loc[target]
            if len(hist)!=SEQ_LEN or not np.isfinite(hist.to_numpy()).all() or price.Open<=0 or price.Volume<=0:
                continue
            windows.append(hist.to_numpy(dtype=np.float32))
            records.append({'date':signal,'entry_date':target,'ticker':ticker})
            bar_rows.append({'date':target,'ticker':ticker,'Open':float(price.Open),
                             'Close':float(price.Close),'Volume':float(price.Volume)})
    if not windows:
        raise ValueError('No valid feature windows')
    model=HuberEnsemble(DEFAULT_MANIFEST)
    scored=model.predict_windows(np.stack(windows))
    panel=pd.DataFrame(records);panel['huber_ensemble']=scored
    panel.to_parquet(out/'price_signals.parquet',index=False)
    pd.DataFrame(bar_rows).to_parquet(out/'target_bars.parquet',index=False)
    # Independently reproduce the old panel at the overlapping signal date.
    original=pd.read_parquet(OLD_PRICE,columns=['date','entry_date','ticker','huber_ensemble'])
    old_signal=original[original.entry_date==pd.Timestamp('2026-09-14')]
    checks=[]
    for ticker in tickers:
        g=old.loc[old.Ticker==ticker].sort_index()
        x=_compute_indicators(g.copy())[FEATURE_COLS].loc[:'2026-09-11'].tail(SEQ_LEN)
        if len(x)==SEQ_LEN and np.isfinite(x.to_numpy()).all():
            checks.append((ticker,x.to_numpy(np.float32)))
    verified=pd.DataFrame({'ticker':[t for t,_ in checks],
                           'computed':model.predict_windows(np.stack([x for _,x in checks]))})
    verified=verified.merge(old_signal[['ticker','huber_ensemble']],on='ticker')
    max_error=float((verified.computed-verified.huber_ensemble).abs().max())
    if max_error>1e-6:
        raise AssertionError(f'Old Huber signals not reproduced: {max_error}')
    save_json(out/'price_verification.json',{'overlap_tickers':len(verified),
                                            'max_abs_prediction_error':max_error,
                                            'new_dates':[str(d.date()) for d in entry],
                                            'new_signal_rows':len(panel)})
    print('Price predictions',len(panel),'old overlap max error',max_error,flush=True)


def collect_titles(out):
    signals=pd.read_parquet(out/'price_signals.parquet')
    names={m['ticker']:m['name'] for m in read(MEMBERS)}
    names.update(read(OLD_NEWS/'companies.json'))
    tickers=sorted(signals.ticker.unique())
    if any(t not in names for t in tickers):
        raise ValueError('Missing company names')
    records=[];audit=[];errors=[]
    cache=out/'rss_cache'
    def one(ticker):
        result=collect_google_rss(names[ticker],ticker,'2026-09-12','2026-09-24',cache)
        queried=[result]
        if result['possibly_truncated']:
            queried=[collect_google_rss(names[ticker],ticker,'2026-09-12','2026-09-18',cache),
                     collect_google_rss(names[ticker],ticker,'2026-09-18','2026-09-24',cache)]
        return (deduplicate([a for part in queried for a in part['articles']]),
                [{k:v for k,v in part.items() if k!='articles'}
                 for part in [result]+(queried if queried[0] is not result else [])])
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs={pool.submit(one,t):t for t in tickers}
        for i,job in enumerate(as_completed(jobs),1):
            try:
                articles,logs=job.result();records.extend(articles);audit.extend(logs)
            except Exception as exc:
                errors.append({'ticker':jobs[job],'error':type(exc).__name__})
            if i%25==0 or i==len(tickers):
                print('RSS',i,'/',len(tickers),'errors',len(errors),flush=True)
    save_json(out/'rss_errors.json',errors)
    if errors:
        raise RuntimeError('RSS collection incomplete; no scoring')
    records=deduplicate(records)
    save_json(out/'discovered_articles.json',records)
    save_json(out/'collection_audit.json',audit)
    plan,requests,_=candidate_plan(signals,records,mode='calendar_lookback')
    selected_ids={r['parent_article_id'] for r in requests}
    selected=[a for a in records if a['article_id'] in selected_ids]
    plan.to_parquet(out/'candidate_plan.parquet',index=False)
    save_json(out/'article_requests.json',requests)
    save_json(out/'selected_headlines.json',selected)
    print('Selected headlines',len(selected),'requests',len(requests),flush=True)


def score(out):
    # All hyperparameters were fixed before the later period was inspected.
    paths=[SOURCE/'scored_panel.parquet',OLD_NEWS/'selected_headlines.json',
           OLD_NEWS/'article_requests.json',out/'price_signals.parquet',
           out/'article_requests.json',out/'selected_headlines.json',Path(__file__)]
    protocol={'version':'news-title-forward-sep2026-v1','created_at':now(),
              'holdout_start':START,'holdout_end':END,'alpha':ALPHA,
              'universe':'fixed 200 tickers from 2026-09-14 price panel',
              'news':'Google RSS previous 3 calendar days; same price20 + independent news10, max2 titles per candidate',
              'training':'prior 30 cached news dates only; title char2-4 TF-IDF, min_df2, max_features3000',
              'inputs_sha256':{str(p):sha(p) for p in paths},
              'limitations':['retrospective RSS discovery, not point-in-time archive',
                             'short later period','alpha was selected after examining earlier dates']}
    destination=out/'protocol.json'
    if destination.exists():
        old=read(destination);protocol['created_at']=old['created_at']
        if old!=protocol:
            raise ValueError('Frozen holdout protocol changed')
    else:
        save_json(destination,protocol)
    old_bars=pd.read_parquet(BARS);old_bars.ticker=old_bars.ticker.astype(str).str.zfill(6)
    train=feature_panel(pd.read_parquet(SOURCE/'scored_panel.parquet'),old_bars)
    train=add_titles(train)
    new=pd.read_parquet(out/'price_signals.parquet')
    requests=read(out/'article_requests.json')
    headlines={a['article_id']:a['title'] for a in read(out/'selected_headlines.json')}
    titles={}
    for request in requests:
        title=headlines.get(request['parent_article_id'])
        if title:
            titles.setdefault((request['entry_date'],request['ticker']),[]).append(title)
    new['title_text']=[' '.join(dict.fromkeys(titles.get((str(d.date()),t),[])))
                       for d,t in zip(new.entry_date,new.ticker)]
    new['price_centered']=new.huber_ensemble-new.groupby('entry_date').huber_ensemble.transform('mean')
    vectorizer=TfidfVectorizer(analyzer='char',ngram_range=(2,4),min_df=2,
                                max_features=3000,sublinear_tf=True)
    train_title=vectorizer.fit_transform(train.title_text)
    new_title=vectorizer.transform(new.title_text)
    mu=float(train.price_centered.mean());sd=max(float(train.price_centered.std(ddof=0)),1e-8)
    x_price=csr_matrix(((train.price_centered-mu)/sd).to_numpy()[:,None])
    z_price=csr_matrix(((new.price_centered-mu)/sd).to_numpy()[:,None])
    x=hstack([x_price,train_title],format='csr');z=hstack([z_price,new_title],format='csr')
    base=Ridge(alpha=ALPHA,solver='lsqr').fit(x_price,train.target)
    model=Ridge(alpha=ALPHA,solver='lsqr').fit(x,train.target)
    new['price_ridge']=base.predict(z_price)
    new['title_ridge']=model.predict(z)
    new.to_parquet(out/'frozen_scores.parquet',index=False)
    save_json(out/'score_audit.json',{'training_days':int(train.entry_date.nunique()),
                                    'training_title_stock_days':int(train.title_text.ne('').sum()),
                                    'holdout_days':int(new.entry_date.nunique()),
                                    'holdout_title_stock_days':int(new.title_text.ne('').sum()),
                                    'vocabulary_size':len(vectorizer.vocabulary_),
                                    'scores_sha256':sha(out/'frozen_scores.parquet')})
    print('Frozen scores',len(new),'rows',new.entry_date.nunique(),'days',flush=True)


def evaluate(out):
    audit=read(out/'score_audit.json')
    if sha(out/'frozen_scores.parquet')!=audit['scores_sha256']:
        raise ValueError('Scores changed after freeze')
    score=pd.read_parquet(out/'frozen_scores.parquet')
    bars=pd.read_parquet(out/'target_bars.parquet')
    joined=score.merge(bars[['date','ticker','Open','Close']],left_on=['entry_date','ticker'],
                       right_on=['date','ticker'],validate='one_to_one')
    joined['actual_oc']=joined.Close/joined.Open-1
    output=[];daily=[]
    for name in ['huber_ensemble','price_ridge','title_ridge']:
        ic=joined.groupby('entry_date').apply(lambda g:g[name].corr(g.actual_oc,method='spearman'),include_groups=False)
        for policy,hurdle in [('top5',0.),('cost_aware',.0025)]:
            selected=select_top5(score,name,hurdle)
            signals=selected[['date','entry_date','ticker',name]].rename(columns={name:'huber_ensemble'})
            met,days,_,_=simulate(signals,bars)
            met.update(strategy=name,turnover=policy,mean_daily_rank_ic=float(ic.mean()))
            output.append(met)
            days['strategy']=name;days['turnover']=policy;daily.append(days)
    pd.DataFrame(output).to_csv(out/'metrics.csv',index=False,encoding='utf-8-sig')
    pd.concat(daily).to_csv(out/'daily.csv',index=False,encoding='utf-8-sig')
    print(pd.DataFrame(output)[['strategy','turnover','mean_daily_rank_ic','final_equity','mdd','total_fees']].to_string(index=False),flush=True)


def main():
    p=argparse.ArgumentParser();p.add_argument('stage',choices=['bars','price','titles','score','evaluate'])
    args=p.parse_args();OUT.mkdir(parents=True,exist_ok=True)
    {'bars':fetch_bars,'price':make_price_panel,'titles':collect_titles,
     'score':score,'evaluate':evaluate}[args.stage](OUT)


if __name__=='__main__':
    main()

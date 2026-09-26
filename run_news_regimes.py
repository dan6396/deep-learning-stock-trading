"""Exploratory, date-only news comparison across three market regimes.

The first chronological 10-session block of each realized KOSPI200 regime is
chosen before collecting news. Each block starts afresh with KRW 10 million.
This does not establish point-in-time article-body availability.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import hashlib
import json
import re
import shutil

import numpy as np
import pandas as pd

from news_fusion.body import fetch_article_body
from news_fusion.efficient import candidate_plan, features_for, score
from news_fusion.news import collect_google_rss, deduplicate, eligible, now, save_json, timestamp
from portfolio_replay import simulate
from run_news_ab import read
from run_news_efficiency import analyze as analyze_paid


OUT = Path('outputs/news_regimes_calendar3_bounded')
SOURCE = Path('outputs/news_efficiency_20260601_0615')


def prepare(out, predictions, market):
    panel = pd.read_parquet(predictions, columns=['date', 'entry_date', 'ticker', 'huber_ensemble'])
    panel['entry_date'] = pd.to_datetime(panel.entry_date)
    panel['ticker'] = panel.ticker.astype(str).str.zfill(6)
    dates = sorted(panel.entry_date.unique())[:70]
    if len(dates) != 70 or str(pd.Timestamp(dates[0]).date()) != '2026-06-01':
        raise ValueError('Unexpected evaluation calendar')
    index = pd.read_parquet(market)
    rows = []
    for start in range(0, 70, 10):
        block = dates[start:start+10]
        first, last = pd.Timestamp(block[0]), pd.Timestamp(block[-1])
        previous = index.loc[index.index < first, 'Close'].iloc[-1]
        final = float(index.loc[last, 'Close'])
        change = final/float(previous)-1
        regime = 'up' if change > .03 else 'down' if change < -.03 else 'sideways'
        rows.append({'block':start//10+1, 'regime':regime, 'start':str(first.date()),
                     'end':str(last.date()), 'market_return':float(change)})
    chosen = {regime:next((row for row in rows if row['regime']==regime), None)
              for regime in ['sideways','down','up']}
    if any(row is None for row in chosen.values()):
        raise ValueError('Missing one or more market regimes')
    block_dates = {regime:[str(pd.Timestamp(v).date()) for v in dates[(row['block']-1)*10:row['block']*10]]
                   for regime,row in chosen.items()}
    kept = set(sum(block_dates.values(), []))
    panel = panel[panel.entry_date.dt.strftime('%Y-%m-%d').isin(kept)].copy()
    names = dict(re.findall(r'code: "([^"]+)", name: "([^"]+)"',
                            Path('FE/server/kospi200Pool.ts').read_text(encoding='utf-8')))
    names.update({'000990':'DB하이텍','267270':'HD건설기계','456040':'OCI','483650':'달바글로벌'})
    if missing := sorted(set(panel.ticker)-set(names)):
        raise ValueError('Unknown company names: '+str(missing))
    protocol = {'version':'news-regimes-calendar3-v1', 'created_at':now(),
        'purpose':'exploratory retrospective regime comparison; previously observed review data',
        'market_regime_rule':'Nonoverlapping consecutive 10-session blocks from 2026-06-01; realized KOSPI200 close/previous-block-close return; >+3% up, <-3% down, otherwise sideways; first chronological block of each',
        'all_blocks':rows, 'selected_blocks':chosen, 'selected_entry_dates':block_dates,
        'eligibility_mode':'calendar_lookback', 'lookback_calendar_days':3,
        'rss_discovery':'Up to three queries per company/block: entire window, then two halves if >=100 results; unresolved caps recorded, not exhaustive',
        'article_rule':'RSS/publisher publication date in [trade date minus 3 calendar days, trade date); no intra-day/retrieval/revision-time gate; fetched body version not historically verified',
        'price_candidates':20, 'independent_news_candidates':10, 'articles_per_candidate':2,
        'news_weight':.75, 'strategies':['price_only','union_a2_w75'],
        'decision':'before open; only previous calendar dates used',
        'portfolio':'KRW10m reset at each block; Top5 equal initial cash, keep shares on reselection, replace at open, liquidate at block-end close, .125% fee each side',
        'additional_api_budget_usd':1.0, 'openai_source':str(SOURCE),
        'predictions_sha256':hashlib.sha256(Path(predictions).read_bytes()).hexdigest(),
        'market_sha256':hashlib.sha256(Path(market).read_bytes()).hexdigest(),
        'scoring_sha256':hashlib.sha256(Path('news_fusion/efficient.py').read_bytes()).hexdigest(),
        'limitations':['Historical search not exhaustive','Retrieved publisher body may have changed since publication',
                       'Blocks and weight are exploratory, not an independent final test',
                       'Three blocks are too few for stable regime inference']}
    destination = out/'protocol.json'
    if destination.exists():
        old = read(destination); protocol['created_at'] = old['created_at']
        if old != protocol:
            raise ValueError('Protocol differs from existing run; use another output directory')
    else:
        save_json(destination, protocol)
    panel.to_parquet(out/'candidates.parquet', index=False)
    save_json(out/'companies.json', {ticker:names[ticker] for ticker in sorted(panel.ticker.unique())})
    for folder in ['rss_cache','body_cache']:
        if (SOURCE/folder).exists():
            shutil.copytree(SOURCE/folder, out/folder, dirs_exist_ok=True)
    print('Frozen regime blocks:',chosen, 'stock-days:',len(panel), flush=True)


def collect(out):
    protocol=read(out/'protocol.json'); companies=read(out/'companies.json')
    spans=[(pd.Timestamp(row['start'])-pd.Timedelta(days=3),pd.Timestamp(row['end']))
           for row in protocol['selected_blocks'].values()]
    complete_dir=out/'collection_by_ticker';complete_dir.mkdir(exist_ok=True)

    def company(ticker,name):
        dest=complete_dir/(ticker+'.json')
        if dest.exists(): return read(dest)
        articles=[]; audit=[]; errors=[]
        def query(start,stop,depth=0):
            try:
                result=collect_google_rss(name,ticker,str(start.date()),str(stop.date()),out/'rss_cache')
                audit.append({k:v for k,v in result.items() if k!='articles'})
                if result['possibly_truncated'] and (stop-start).days>1 and depth<1:
                    middle=start+pd.Timedelta(days=max(1,(stop-start).days//2))
                    query(start,middle,depth+1);query(middle,stop,depth+1)
                else:
                    articles.extend(result['articles'])
            except Exception as exc:
                errors.append({'start':str(start.date()),'end':str(stop.date()),'error':type(exc).__name__})
        for start,stop in spans:
            query(start,stop)
        record={'ticker':ticker,'articles':deduplicate(articles),'audit':audit,'errors':errors}
        if not errors: save_json(dest,record)
        return record

    all_articles=[];audit=[];errors=[]
    with ThreadPoolExecutor(max_workers=8) as pool:
        jobs={pool.submit(company,t,n):t for t,n in companies.items()}
        for i,job in enumerate(as_completed(jobs),1):
            result=job.result();all_articles.extend(result['articles']);audit.extend(result['audit'])
            errors.extend([{'ticker':result['ticker'],**e} for e in result['errors']])
            if i%20==0 or i==len(jobs):
                print('RSS companies',i,'/',len(jobs),'errors',len(errors),flush=True)
    save_json(out/'discovered_articles.json',deduplicate(all_articles))
    save_json(out/'collection_audit.json',audit)
    save_json(out/'collection_errors.json',errors)
    if errors:
        raise RuntimeError(f'{len(errors)} RSS requests failed; rerun collection before planning')
    print('Collected ticker-headlines:',len(all_articles),'searches:',len(audit),flush=True)


def plan(out):
    panel=pd.read_parquet(out/'candidates.parquet')
    rows,requests_,_=candidate_plan(panel,read(out/'discovered_articles.json'),mode='calendar_lookback')
    rows.to_parquet(out/'candidate_plan.parquet',index=False)
    save_json(out/'article_requests.json',requests_)
    parents={r['parent_article_id'] for r in requests_}
    selected=[a for a in read(out/'discovered_articles.json') if a['article_id'] in parents]
    save_json(out/'selected_headlines.json',selected)
    save_json(out/'plan_summary.json',{'stock_days':len(rows),'news_pool_stock_days':int(rows.in_news_pool.sum()),
        'requested_article_slots':len(requests_),'unique_headlines':len(selected)})
    print('Plan:',read(out/'plan_summary.json'),flush=True)


def bodies(out):
    selected=read(out/'selected_headlines.json');records=[]
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs={pool.submit(fetch_article_body,a,out/'body_cache'):a['article_id'] for a in selected}
        for i,job in enumerate(as_completed(jobs),1):
            records.append(job.result())
            if i%25==0 or i==len(jobs):
                save_json(out/'body_audit.json',records)
                print('Bodies',i,'/',len(jobs),'usable',sum(r['status']=='body_extracted' for r in records),flush=True)
    save_json(out/'body_articles.json',[r['article'] for r in records if r['status']=='body_extracted'])


def replay(out, predictions, bars_path, market):
    protocol=read(out/'protocol.json')
    if read(out/'extraction_status.json')['status']!='complete':
        raise ValueError('Incomplete news labeling')
    if hashlib.sha256(Path(predictions).read_bytes()).hexdigest()!=protocol['predictions_sha256']:
        raise ValueError('Prediction data changed')
    if hashlib.sha256(Path(market).read_bytes()).hexdigest()!=protocol['market_sha256']:
        raise ValueError('Market data changed')
    if hashlib.sha256(Path('news_fusion/efficient.py').read_bytes()).hexdigest()!=protocol['scoring_sha256']:
        raise ValueError('Scoring policy changed')
    plan_=pd.read_parquet(out/'candidate_plan.parquet')
    requests_=read(out/'article_requests.json');bodies_=read(out/'body_audit.json')
    labels=read(out/'extractions.json');rejected=read(out/'rejected_extractions.json')
    expected={r['article']['article_id'] for r in bodies_ if r['status']=='body_extracted'
              and any(q['parent_article_id']==r['parent_article_id']
                      and eligible(r['article'],q['decision_at'],mode='calendar_lookback') for q in requests_)}
    if expected!={r['article_id'] for r in labels+rejected}:
        raise ValueError('News labels do not cover all eligible extracted bodies')
    features=features_for(plan_,requests_,bodies_,labels,'union',2,mode='calendar_lookback')
    bars=pd.read_parquet(bars_path);bars['ticker']=bars.ticker.astype(str).str.zfill(6)
    output=[];daily=[];decisions=[]
    for regime,block in protocol['selected_blocks'].items():
        dates=set(protocol['selected_entry_dates'][regime])
        for strategy,weight in [('price_only',0.),('union_a2_w75',.75)]:
            group=features[features.entry_date.dt.strftime('%Y-%m-%d').isin(dates)].copy()
            scored=score(group,weight)
            if strategy=='price_only':
                # A zero news weight must reproduce unfiltered price Top5.
                selected=scored[scored.selected]
                if not selected.price_rank.le(5).all():
                    raise ValueError('Price-only ranking changed')
            else:
                selected=scored[scored.selected]
            signals=selected[['date','entry_date','ticker','final_score']].rename(columns={'final_score':'huber_ensemble'})
            met,days,trades,holdings=simulate(signals,bars)
            changes=days.net_pnl/days.start_equity
            met.update(regime=regime,block=block['block'],start=block['start'],end=block['end'],
                       market_return=block['market_return'],strategy=strategy,
                       sharpe_annualized=float(changes.mean()/changes.std(ddof=1)*np.sqrt(252)) if changes.std(ddof=1)>0 else None,
                       selected_with_usable_news=int(selected.usable_articles.gt(0).sum()) if strategy!='price_only' else 0,
                       selected_stock_days=len(selected),
                       selected_outside_price20=int(selected.price_rank.gt(20).sum()) if strategy!='price_only' else 0,
                       unique_news_bodies=len({ident for ids in selected.body_ids for ident in json.loads(ids)}) if strategy!='price_only' else 0)
            output.append(met)
            days['regime']=regime;days['strategy']=strategy;daily.append(days)
            selected=selected.copy();selected['regime']=regime;selected['strategy']=strategy
            decisions.append(selected)
            trades.to_parquet(out/f'{regime}_{strategy}_trades.parquet',index=False)
            holdings.to_parquet(out/f'{regime}_{strategy}_holdings.parquet',index=False)
    pd.DataFrame(output).to_csv(out/'metrics.csv',index=False,encoding='utf-8-sig')
    pd.concat(daily).to_csv(out/'daily.csv',index=False,encoding='utf-8-sig')
    pd.concat(decisions).to_parquet(out/'selections.parquet',index=False)
    print(pd.DataFrame(output)[['regime','strategy','final_equity','net_return','mdd','total_fees','selected_with_usable_news']].to_string(index=False),flush=True)


def revision_sensitivity(out, bars_path):
    """Secondary check only: discard evidence known to be revised after a trade.

    Unknown revision history remains unknown; this is not a strict PIT replay.
    Candidate discovery and the chosen 75% news weight stay fixed.
    """
    protocol=read(out/'protocol.json')
    plan_=pd.read_parquet(out/'candidate_plan.parquet')
    bodies_=read(out/'body_audit.json')
    features=features_for(plan_,read(out/'article_requests.json'),bodies_,
                          read(out/'extractions.json'),'union',2,mode='calendar_lookback')
    article_by_id={r['article']['article_id']:r['article'] for r in bodies_ if r['status']=='body_extracted'}
    revised=[];affected=0
    for row in features.itertuples():
        evidence=json.loads(row.evidence);kept=[]
        for item in evidence:
            article=article_by_id[item['article_id']]
            modified=article.get('modified_at')
            if modified and timestamp(modified)>timestamp(row.decision_at):
                affected+=1
                continue
            kept.append(item)
        weights=[];signals=[]
        for item in kept:
            article=article_by_id[item['article_id']]
            age=(timestamp(row.decision_at).normalize()-timestamp(article['published_at']).normalize()).days
            weights.append(np.exp(-age))
            signals.append({'positive':1.,'neutral':0.,'negative':-1.}[item['sentiment']]
                           *(1. if item['relevance']=='direct' else .5))
        revised.append((float(np.average(signals,weights=weights)) if signals else 0.,len(kept)))
    features[['news_signal','usable_articles']]=revised
    bars=pd.read_parquet(bars_path);bars['ticker']=bars.ticker.astype(str).str.zfill(6)
    output=[]
    for regime,block in protocol['selected_blocks'].items():
        dates=set(protocol['selected_entry_dates'][regime])
        selected=score(features[features.entry_date.dt.strftime('%Y-%m-%d').isin(dates)],.75)
        signals=selected[selected.selected][['date','entry_date','ticker','final_score']].rename(columns={'final_score':'huber_ensemble'})
        met,_,_,_=simulate(signals,bars)
        output.append({'regime':regime,'final_equity':met['final_equity'],'net_return':met['net_return'],
                       'mdd':met['mdd'],'total_fees':met['total_fees'],
                       'removed_known_later_revision_evidence_instances_all_candidates':affected})
    pd.DataFrame(output).to_csv(out/'revision_sensitivity.csv',index=False,encoding='utf-8-sig')
    print('Known-later-revision sensitivity:',pd.DataFrame(output).to_string(index=False),flush=True)


def report(out):
    import matplotlib.pyplot as plt
    plt.rcParams['font.family']='Malgun Gothic'
    plt.rcParams['axes.unicode_minus']=False
    protocol=read(out/'protocol.json');metrics=pd.read_csv(out/'metrics.csv')
    daily=pd.read_csv(out/'daily.csv',parse_dates=['date'])
    sensitivity=pd.read_csv(out/'revision_sensitivity.csv').set_index('regime')
    collection=read(out/'collection_audit.json');status=read(out/'extraction_status.json')
    bodies_=read(out/'body_audit.json');plan_=read(out/'plan_summary.json')
    palette={'price_only':'#2357A4','union_a2_w75':'#D36A27'}
    names={'sideways':'횡보','down':'하락','up':'상승'}
    fig,axes=plt.subplots(1,3,figsize=(14.5,4.5),sharey=True)
    for axis,(regime,block) in zip(axes,protocol['selected_blocks'].items()):
        part=daily[daily.regime==regime]
        for strategy,label in [('price_only','가격만'),('union_a2_w75','가격+뉴스')]:
            line=part[part.strategy==strategy].sort_values('date')
            axis.plot(range(1,len(line)+1),line.end_equity/1e6,label=label,color=palette[strategy],lw=2.5)
        axis.axhline(10,color='#9AA2AA',ls='--',lw=1)
        axis.set_title(f"{names[regime]}장 · KOSPI200 {block['market_return']:+.1%}\n{block['start']}~{block['end']}")
        axis.set_xlabel('구간 내 거래일')
        axis.grid(alpha=.2)
    axes[0].set_ylabel('평가자산 (백만 원)')
    axes[0].legend(loc='best',frameon=False)
    fig.suptitle('각 구간에 1,000만 원씩 · 같은 Top-5 보유/교체 규칙',fontsize=13)
    fig.tight_layout();fig.savefig(out/'regime_equity.png',dpi=170,bbox_inches='tight');plt.close(fig)
    lines=['# 최근 3일 뉴스 결합: 시장 국면별 탐색 비교','',
           '매매일 전 3개 달력일의 기사만 사용했습니다. 기사 시·분, 수집 시각, 수정 시각으로 제외하지 않았습니다. 기존 평가 기간을 겹치지 않는 10거래일 7개 블록으로 나누고, KOSPI200 등락률 ±3% 기준으로 분류한 뒤 각 국면의 첫 블록만 시험했습니다. 각 구간마다 가격 단독과 뉴스 결합에 각각 1,000만 원을 새로 배정하고, 같은 Top-5 보유·교체 및 편도 0.125% 비용을 적용했습니다. 뉴스 결합은 이전 탐색에서 선택된 가격 상위20+독립 뉴스 상위10, 후보당 본문 최대2건, 뉴스 비중75% 고정 규칙입니다.','',
           '| KOSPI200 국면·기간 | 지수 등락 | 가격 단독 최종자산 | 뉴스 결합 최종자산 | 차이 | 뉴스 결합 거래비용 |',
           '|---|---:|---:|---:|---:|---:|']
    for regime,block in protocol['selected_blocks'].items():
        pair=metrics[metrics.regime==regime].set_index('strategy')
        old=pair.loc['price_only'];new=pair.loc['union_a2_w75']
        lines.append(f"| {names[regime]} · {block['start']}~{block['end']} | {block['market_return']:+.2%} | {old.final_equity:,.0f}원 ({old.net_return:+.2%}) | {new.final_equity:,.0f}원 ({new.net_return:+.2%}) | {new.final_equity-old.final_equity:+,.0f}원 | {new.total_fees:,.0f}원 |")
    lines += ['', '![국면별 자산 곡선](regime_equity.png)','',
              '## 수집·분석 범위','',
              f"- 종목·매매일 조합: {plan_['stock_days']:,}건, 선정된 종목 연결 제목: {plan_['unique_headlines']:,}건, 종목 연결 본문 확보: {sum(r['status']=='body_extracted' for r in bodies_):,}건.",
              f"- 본문 근거 검사를 통과한 분류: {status['validated']:,}건, 거절: {status['rejected']:,}건. 새 API 비용 추정액: ${status['additional_accounted_cost_usd']:.3f}.",
              f"- 뉴스 검색 조회 {len(collection):,}건 중 결과 상한에 닿은 조회 {sum(r.get('possibly_truncated',False) for r in collection):,}건. 검색 결과는 완전한 기사 목록이 아닙니다.",
              '', '## 해석','',
              '뉴스 결합은 횡보 구간에서만 가격 단독보다 높은 자산을 기록했고, 하락·상승 구간에서는 낮았습니다. 세 구간 모두 뉴스 결합의 Top-5가 가격 단독과 10일 모두 달랐고 거래비용도 더 컸습니다. 이 세 표본만으로 어느 국면에 일반적으로 강하다고 결론 낼 수 없습니다.',
              '', '이미 확인한 평가 기간과 이전 탐색에서 선택된 뉴스 비중을 사용했습니다. 특히 횡보 구간은 이전 가중치 선택에 이용한 6월 초 날짜와 겹칩니다. 수집 시점의 언론사 본문은 과거 매매 시점의 원문으로 검증되지 않았으며, 알려진 사후 수정 기사도 기본 실험에는 포함했습니다. 따라서 독립적인 테스트나 누수 없는 시점별 뉴스 백테스트라고 주장할 수 없습니다.',
              '', '알려진 사후 수정 기사만 점수에서 뺀 보조 점검의 최종자산:']
    for regime in ['sideways','down','up']:
        value=sensitivity.loc[regime,'final_equity']
        lines.append(f'- {names[regime]}: {value:,.0f}원')
    lines += ['', '수정 기록이 없는 기사도 당시 본문 버전을 확인한 것은 아닙니다.']
    (out/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('Wrote',out/'report.md',out/'regime_equity.png',flush=True)


def verify(out):
    protocol=read(out/'protocol.json');metrics=pd.read_csv(out/'metrics.csv')
    daily=pd.read_csv(out/'daily.csv')
    selected=pd.read_parquet(out/'selections.parquet')
    bodies_=read(out/'body_audit.json')
    article_by_id={r['article']['article_id']:r['article'] for r in bodies_ if r['status']=='body_extracted'}
    status=read(out/'extraction_status.json')
    if status['status']!='complete' or status['additional_accounted_cost_usd']>protocol['additional_api_budget_usd']:
        raise AssertionError('News labeling incomplete or budget exceeded')
    if len(metrics)!=6 or len(daily)!=60 or len(selected)!=300:
        raise AssertionError('Unexpected number of rows')
    for regime,block in protocol['selected_blocks'].items():
        expected=set(protocol['selected_entry_dates'][regime])
        for strategy in ['price_only','union_a2_w75']:
            group=selected[(selected.regime==regime)&(selected.strategy==strategy)]
            if set(group.entry_date.dt.strftime('%Y-%m-%d'))!=expected or len(group)!=50:
                raise AssertionError('Top-5 date coverage incomplete')
            metric=metrics[(metrics.regime==regime)&(metrics.strategy==strategy)].iloc[0]
            if metric.independent_ledger_max_error>=1e-6:
                raise AssertionError('Portfolio ledger does not reconcile')
    checked=0;known_later=0
    for row in selected[selected.strategy=='union_a2_w75'].itertuples():
        for evidence in json.loads(row.evidence):
            article=article_by_id[evidence['article_id']]
            if not eligible(article,row.decision_at,mode='calendar_lookback'):
                raise AssertionError('Same-day or older-than-three-day news used')
            checked+=1
            if article.get('modified_at') and timestamp(article['modified_at'])>timestamp(row.decision_at):
                known_later+=1
    original=next(r for r in read(SOURCE/'metrics.json') if r['id']=='price_only')
    baseline=metrics[(metrics.regime=='sideways')&(metrics.strategy=='price_only')].iloc[0]
    baseline_error=max(abs(float(baseline[k])-float(original[k]))
                       for k in ['final_equity','net_return','mdd','total_fees'])
    if baseline_error>=1e-6:
        raise AssertionError('Original June price-only result not reproduced')
    result={'verified_at':now(),'price_baseline_max_absolute_error':baseline_error,
            'stock_days_with_selection':len(selected)//5,'ledger_max_error':float(metrics.independent_ledger_max_error.max()),
            'selected_evidence_instances_checked':checked,
            'selected_evidence_with_known_later_revision':known_later,
            'all_evidence_publication_dates_within_previous_three_calendar_days':True,
            'api_estimated_incremental_usd':status['additional_accounted_cost_usd'],
            'api_budget_usd':protocol['additional_api_budget_usd']}
    save_json(out/'verification.json',result)
    print('Verified:',result,flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('stage',choices=['prepare','collect','plan','bodies','analyze','replay','sensitivity','report','verify'])
    parser.add_argument('--out',default=str(OUT));parser.add_argument('--source',default=str(SOURCE))
    parser.add_argument('--predictions',default='../../outputs/validation_report/predictions.parquet')
    parser.add_argument('--bars',default='../../outputs/validation_report/inputs/daily_bars.parquet')
    parser.add_argument('--market',default='../execution_study/KPI200.parquet')
    parser.add_argument('--env-file',default='.env.news_fusion')
    args=parser.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    if args.stage=='prepare':prepare(out,args.predictions,args.market)
    elif args.stage=='collect':collect(out)
    elif args.stage=='plan':plan(out)
    elif args.stage=='bodies':bodies(out)
    elif args.stage=='analyze':analyze_paid(out,Path(args.source),args.env_file)
    elif args.stage=='replay':replay(out,args.predictions,args.bars,args.market)
    elif args.stage=='sensitivity':revision_sensitivity(out,args.bars)
    elif args.stage=='report':report(out)
    elif args.stage=='verify':verify(out)


if __name__=='__main__':main()

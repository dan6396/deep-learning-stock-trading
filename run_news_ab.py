"""Frozen, small historical price-only versus body-news risk-filter experiment.

No returns are accessed until replay. Discovery failures retain the price ordering;
they are coverage failures, never assertions that news was neutral or absent.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import html
import json
from pathlib import Path
import re
import time
import numpy as np
import pandas as pd
import requests
from news_fusion.news import collect_google_rss,deduplicate,digest,eligible,now,save_json,timestamp
from news_fusion.body import fetch_article_body,EXTRACTOR_VERSION
from news_fusion.gemini import SCHEMA,INSTRUCTION,align_evidence,validate_result,load_key

EVENTS=['earnings','contract','capital_raise','legal','buyback','dividend','product']
BATCH_VERSION='independent-articles-v1'
BATCH_INSTRUCTION=INSTRUCTION+'''\nInput is a list of separate articles. Return one object for each article_id, in input order.
Treat each article independently; never transfer facts or quotes between articles.
The evidence_quote should be short, copied exactly from that article, with no paraphrase.
Use the article's body, including qualifications and denials, not just the headline.'''

def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))

def prepare(out,predictions):
    cols=['date','entry_date','ticker','huber_ensemble']
    p=pd.read_parquet(predictions,columns=cols)
    dates=sorted(p.entry_date.unique())[:10]
    p=p[p.entry_date.isin(dates)].copy();p['ticker']=p.ticker.astype(str).str.zfill(6)
    p=p.sort_values(['entry_date','huber_ensemble','ticker'],ascending=[True,False,True])
    p['price_rank']=p.groupby('entry_date').cumcount()+1
    pool=p[p.price_rank<=20].copy()
    names=dict(re.findall(r'code: "([^"]+)", name: "([^"]+)"',Path('FE/server/kospi200Pool.ts').read_text(encoding='utf-8')))
    missing=sorted(set(pool.ticker)-set(names))
    if missing:raise ValueError('Company names missing: '+str(missing))
    pool['company_name']=pool.ticker.map(names)
    protocol={'created_at':now(),'purpose':'exploratory_body_news_risk_filter_not_trained_fusion',
        'period_selection':'first 10 trading sessions of existing evaluation; no outcome selection',
        'start':str(pd.Timestamp(dates[0]).date()),'end':str(pd.Timestamp(dates[-1]).date()),
        'decision_time':'08:30 Asia/Seoul','news_lookback_days':3,'price_pool':20,'top_n':5,
        'news_sampling':'latest one discovered headline per candidate per decision; no fallback to older article after a fetch failure',
        'rule':'demote direct negative, sufficient-context news in specified event types below all other candidates; preserve price order within groups',
        'negative_event_types':EVENTS,'positive_bonus':False,'missing_news':'retain original price priority; explicitly report coverage failure',
        'capital_each':10000000,'one_way_cost':0.00125,'execution':'first open buy; retain quantities; replace dropouts at open; liquidate final close',
        'fractional_shares':True,'availability_mode':'exploratory','model':'gemini-2.5-flash-lite',
        'prompt_version':BATCH_VERSION,'prompt_digest':digest(BATCH_INSTRUCTION),'body_version':EXTRACTOR_VERSION,
        'max_api_calls':20,'batch_size_max':20,'batch_chars_max':60000,
        'batch_time_policy':'all articles in a batch share their earliest eligible requested decision; no later-decision news mixed into earlier decisions',
        'prediction_file_sha256':hashlib.sha256(Path(predictions).read_bytes()).hexdigest(),
        'price_candidate_digest':digest(pool.astype(str).to_dict('records')),
        'limitations':['historical article versions not verified','LLM pretraining contamination not excluded',
                       'previously inspected price evaluation interval','one article per candidate/day is not comprehensive news',
                       'fixed rule, not fitted ridge model','10 days cannot establish statistical superiority']}
    path=out/'protocol.json'
    if path.exists():
        old=read(path);protocol['created_at']=old['created_at']
        if protocol!=old:raise ValueError('Frozen protocol changed; choose another output directory')
    else:save_json(path,protocol)
    pool.to_parquet(out/'candidates.parquet',index=False)
    save_json(out/'companies.json',{t:names[t] for t in sorted(pool.ticker.unique())})
    print('Frozen',protocol['start'],protocol['end'],len(pool),'candidate-days',len(pool.ticker.unique()),'companies',flush=True)

def collect(out):
    protocol=read(out/'protocol.json');companies=read(out/'companies.json')
    begin=pd.Timestamp(protocol['start'])-pd.Timedelta(days=3)
    end=pd.Timestamp(protocol['end'])+pd.Timedelta(days=1)
    def company(ticker,name):
        articles=[];audit=[]
        def query(start,stop):
            try:
                r=collect_google_rss(name,ticker,str(start.date()),str(stop.date()),out/'rss_cache')
                audit.append({k:v for k,v in r.items() if k!='articles'})
                if r['possibly_truncated'] and (stop-start).days>1:
                    middle=start+pd.Timedelta(days=max(1,(stop-start).days//2))
                    query(start,middle);query(middle,stop)
                else:articles.extend(r['articles'])
            except Exception as exc:audit.append({'ticker':ticker,'start':str(start),'end':str(stop),'error':type(exc).__name__})
        query(begin,end)
        return articles,audit
    articles=[];audit=[]
    with ThreadPoolExecutor(max_workers=3) as executor:
        jobs={executor.submit(company,t,n):t for t,n in companies.items()}
        for job in as_completed(jobs):
            a,q=job.result();articles.extend(a);audit.extend(q)
            save_json(out/'discovered_articles.json',deduplicate(articles));save_json(out/'collection_audit.json',audit)
            print('News',jobs[job],len(a),'articles',flush=True)
    articles=deduplicate(articles);requests_=[];chosen={}
    for r in pd.read_parquet(out/'candidates.parquet').itertuples():
        decision=timestamp(r.entry_date)+pd.Timedelta(hours=8,minutes=30)
        matches=[a for a in articles if a['ticker']==r.ticker and eligible(a,decision,mode='exploratory')]
        matches.sort(key=lambda a:(timestamp(a['published_at']),a['article_id']),reverse=True)
        article=matches[0] if matches else None
        requests_.append({'entry_date':str(r.entry_date.date()),'ticker':r.ticker,'decision_at':decision.isoformat(),
                          'parent_article_id':article['article_id'] if article else None,'discovered_eligible_count':len(matches)})
        if article:chosen[article['article_id']]=article
    save_json(out/'article_requests.json',requests_)
    save_json(out/'selected_headlines.json',sorted(chosen.values(),key=lambda a:(a['published_at'],a['ticker'],a['article_id'])))
    print('Selected',len(chosen),'distinct headlines for',len(requests_),'candidate-days',flush=True)

def bodies(out):
    records=[]
    with ThreadPoolExecutor(max_workers=3) as executor:
        jobs={executor.submit(fetch_article_body,a,out/'body_cache'):a for a in read(out/'selected_headlines.json')}
        for job in as_completed(jobs):
            record=job.result();records.append(record)
            save_json(out/'body_audit.json',records)
            good=sorted([r['article'] for r in records if r['status']=='body_extracted'],key=lambda a:(a['published_at'],a['ticker'],a['article_id']))
            save_json(out/'body_articles.json',good)
            print('Body',len(records),len(jobs),record['ticker'],record.get('failure_reason','ok'),flush=True)
    print('Body results',dict(Counter(r.get('failure_reason','body_extracted') for r in records)),flush=True)

def parse_batch(raw,articles):
    data=json.loads(raw)
    if not isinstance(data,list) or len(data)!=len(articles):raise ValueError('Batch count mismatch')
    lookup={a['article_id']:a for a in articles};seen=set();records=[];rejects=[]
    for item in data:
        if not isinstance(item,dict):raise ValueError('Batch item is not an object')
        item=dict(item);ident=item.pop('article_id',None)
        if ident not in lookup or ident in seen:raise ValueError('Batch ID mismatch')
        seen.add(ident);article=lookup[ident]
        try:
            result,alignment=align_evidence(item,article['text']);validate_result(result,article['text'])
            records.append({'article_id':ident,'result':result,'input_chars':len(article['text']),
                            'input_sha256':digest(article['text']),'input_truncated':False,
                            'text_scope':'publisher_body','evidence_alignment':alignment})
        except ValueError as exc:rejects.append({'article_id':ident,'error':str(exc)})
    return records,rejects

def make_batches(articles,requests_,max_items=20,max_chars=60000,eligibility_mode='exploratory'):
    # Do not spend calls on revisions that cannot enter any requested decision.
    first_decision={}
    for a in articles:
        decisions=[r['decision_at'] for r in requests_ if r['parent_article_id']==a['parent_article_id'] and eligible(a,r['decision_at'],mode=eligibility_mode)]
        if decisions:first_decision[a['article_id']]=min(decisions,key=timestamp)
    articles=sorted([a for a in articles if a['article_id'] in first_decision],key=lambda a:(first_decision[a['article_id']],a['published_at'],a['article_id']))
    batches=[];batch=[];chars=0;rejected=[]
    for a in articles:
        if len(a['text'])>30000:
            rejected.append({'article_id':a['article_id'],'error':'over_30000_chars'});continue
        if batch and (len(batch)>=max_items or chars+len(a['text'])>max_chars or first_decision[a['article_id']]!=first_decision[batch[0]['article_id']]):batches.append(batch);batch=[];chars=0
        batch.append(a);chars+=len(a['text'])
    if batch:batches.append(batch)
    return batches,rejected,len(articles)

def analyze(out,env_file):
    protocol=read(out/'protocol.json');articles=read(out/'body_articles.json')
    requests_=read(out/'article_requests.json')
    batches,rejected,requested_count=make_batches(articles,requests_,protocol['batch_size_max'],protocol['batch_chars_max'])
    cache=out/'batch_cache';cache.mkdir(exist_ok=True);key=load_key(env_file)
    item_schema={'type':'OBJECT','properties':{'article_id':{'type':'STRING'},**SCHEMA['properties']},'required':['article_id']+SCHEMA['required']}
    schema={'type':'ARRAY','items':item_schema}
    results=[];calls=0;failure=None;usage=[]
    for i,batch in enumerate(batches):
        payload=[{k:a[k] for k in ['article_id','ticker','company_name','text']} for a in batch]
        ident=digest({'version':BATCH_VERSION,'instruction':BATCH_INSTRUCTION,'model':protocol['model'],'schema':schema,'payload':payload})
        path=cache/(ident+'.json')
        if path.exists():response=read(path)
        else:
            if calls>=protocol['max_api_calls']:failure='explicit_call_budget';break
            if calls:time.sleep(7)
            calls+=1
            body={'systemInstruction':{'parts':[{'text':BATCH_INSTRUCTION}]},
                  'contents':[{'role':'user','parts':[{'text':json.dumps(payload,ensure_ascii=False)}]}],
                  'generationConfig':{'temperature':0,'maxOutputTokens':12000,'responseMimeType':'application/json','responseSchema':schema}}
            try:
                r=requests.post('https://generativelanguage.googleapis.com/v1beta/models/'+protocol['model']+':generateContent',
                                headers={'x-goog-api-key':key,'Content-Type':'application/json'},json=body,timeout=55)
                if r.status_code!=200:
                    failure='Gemini HTTP '+str(r.status_code)
                    audit={'at':now(),'http_status':r.status_code,'batch_id':ident}
                    # Only allowlisted provider diagnostics; never request headers or credentials.
                    try:
                        error=r.json().get('error',{})
                        audit['provider_status']=error.get('status')
                        audit['message']=str(error.get('message','')).replace(key,'[redacted]')
                        audit['details']=json.loads(json.dumps(error.get('details',[])).replace(key,'[redacted]'))
                    except (ValueError,AttributeError):pass
                    save_json(out/'api_error.json',audit)
                    break
                obj=r.json();candidate=obj.get('candidates',[{}])[0]
                if candidate.get('finishReason')!='STOP':failure='incomplete_batch_response';break
                raw=''.join(x.get('text','') for x in candidate.get('content',{}).get('parts',[]) if not x.get('thought'))
                response={'requested_at':now(),'response_text':raw.replace(key,'[redacted]'),'usage':obj.get('usageMetadata',{}),
                          'model':obj.get('modelVersion'),'prompt_version':BATCH_VERSION}
                save_json(path,response)
            except (requests.RequestException,ValueError,IndexError) as exc:failure=type(exc).__name__;break
        try:good,bad=parse_batch(response['response_text'],batch)
        except ValueError as exc:failure=str(exc);break
        results.extend([{**g,'model':protocol['model'],'prompt_version':BATCH_VERSION,'batch_id':ident} for g in good])
        rejected.extend(bad);usage.append(response['usage'])
        save_json(out/'extractions.json',results);save_json(out/'rejected_extractions.json',rejected)
        print('Analysis batch',i+1,len(batches),'validated',len(good),'rejected',len(bad),flush=True)
    save_json(out/'extraction_status.json',{'status':'stopped' if failure else 'complete','failure':failure,
              'calls_this_run':calls,'requested_articles':requested_count,'validated':len(results),'rejected':len(rejected),
              'total_tokens':sum(u.get('totalTokenCount',0) for u in usage)})
    if failure:raise RuntimeError(failure+'; no automatic retry, replay not run')

def select_with_news(pool,article_requests,body_records,extractions):
    req={(r['entry_date'],r['ticker']):r for r in article_requests}
    bodies={r['parent_article_id']:r for r in body_records};labels={r['article_id']:r for r in extractions}
    f=pool.copy();rows=[]
    for r in f.to_dict('records'):
        request=req[(str(r['entry_date'].date()),r['ticker'])];parent=request['parent_article_id']
        state='no_discovered_article';negative=False;evidence='';article_id=None;sentiment=None;event=None;url=None;reason=''
        if parent:
            body=bodies.get(parent)
            if not body or body['status']!='body_extracted':state='body_unavailable'
            else:
                a=body['article'];article_id=a['article_id'];url=a['url']
                if not eligible(a,request['decision_at'],mode='exploratory'):state='body_time_excluded'
                elif article_id not in labels:state='classification_rejected'
                else:
                    label=labels[article_id]['result'];validate_result(label,a['text'])
                    state='analyzed';sentiment=label['sentiment'];event=label['event_type'];evidence=label['evidence_quote'];reason=label['reason']
                    negative=(sentiment=='negative' and label['relevance']=='direct' and not label['insufficient_context'] and event in EVENTS)
        r.update(news_state=state,negative_filter=negative,article_id=article_id,sentiment=sentiment,event_type=event,
                 evidence_quote=evidence,news_reason=reason,article_url=url,final_score=float(-r['price_rank']-20*negative))
        rows.append(r)
    f=pd.DataFrame(rows).sort_values(['entry_date','final_score','ticker'],ascending=[True,False,True])
    f['final_rank']=f.groupby('entry_date').cumcount()+1;f['selected']=f.final_rank<=5
    return f

def replay(out,bars_path):
    from portfolio_replay import simulate
    protocol=read(out/'protocol.json')
    if read(out/'extraction_status.json')['status']!='complete':raise ValueError('Finish API analysis before replay')
    pool=pd.read_parquet(out/'candidates.parquet')
    news=select_with_news(pool,read(out/'article_requests.json'),read(out/'body_audit.json'),read(out/'extractions.json'))
    baseline=pool.assign(final_score=pool.huber_ensemble,selected=pool.price_rank.le(5))
    bars=pd.read_parquet(bars_path);metrics={};daily={};changed=[]
    for name,selection in [('price_only',baseline),('price_news',news)]:
        selection.to_parquet(out/(name+'_selection.parquet'),index=False)
        selection.to_csv(out/(name+'_selection.csv'),index=False,encoding='utf-8-sig')
        s=selection[selection.selected][['date','entry_date','ticker','final_score']].rename(columns={'final_score':'huber_ensemble'})
        m,d,t,h=simulate(s,bars,capital=protocol['capital_each'],cost=protocol['one_way_cost'])
        daily[name]=d
        returns=d.end_equity.div(d.end_equity.shift(1).fillna(protocol['capital_each']))-1
        m['annualized_sharpe_illustrative']=float(returns.mean()/returns.std(ddof=1)*np.sqrt(252)) if returns.std(ddof=1)>0 else None
        m['turnover_notional_over_initial']=float(t.notional.sum()/protocol['capital_each'])
        metrics[name]=m
        for suffix,frame in [('daily',d),('trades',t),('holdings',h)]:frame.to_parquet(out/(name+'_'+suffix+'.parquet'),index=False)
    for date,g in news.groupby('entry_date'):
        b=set(baseline[(baseline.entry_date==date)&baseline.selected].ticker);n=set(g[g.selected].ticker)
        if b!=n:changed.append({'date':str(date.date()),'dropped':sorted(b-n),'added':sorted(n-b)})
    audit=read(out/'collection_audit.json');records=read(out/'body_audit.json')
    summary={'protocol_sha256':digest(protocol),'metrics':metrics,'difference_final_equity':metrics['price_news']['final_equity']-metrics['price_only']['final_equity'],
        'candidate_days':len(pool),'news_states':dict(Counter(news.news_state)),'negative_candidate_days':int(news.negative_filter.sum()),
        'baseline_top5_news_states':dict(Counter(news[news.price_rank.le(5)].news_state)),
        'baseline_top5_negative_days':int(news[news.price_rank.le(5)].negative_filter.sum()),
        'changed_days':len(changed),'changes':changed,'discovered_articles':len(read(out/'discovered_articles.json')),
        'selected_headlines':len(read(out/'selected_headlines.json')),'body_status':dict(Counter(r.get('failure_reason','body_extracted') for r in records)),
        'api_status':read(out/'extraction_status.json'),'collection_errors':sum('error' in r for r in audit),
        'capped_one_day_queries':sum(r.get('possibly_truncated',False) and (pd.Timestamp(r['requested_end'])-pd.Timestamp(r['requested_start'])).days<=1 for r in audit),
        'strict_historical_articles':0,'interpretation':'exploratory, not proof of predictive improvement'}
    save_json(out/'summary.json',summary)
    make_report(out,protocol,summary,daily,news)
    print(json.dumps(summary,ensure_ascii=False),flush=True)

def make_report(out,protocol,summary,daily,news):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams['font.family']='Malgun Gothic';plt.rcParams['axes.unicode_minus']=False
    names={'price_only':'앙상블 단독','price_news':'앙상블 + 뉴스 악재 필터'}
    colors={'price_only':'#3979d0','price_news':'#dc7536'}
    fig,axes=plt.subplots(2,1,figsize=(11,7),sharex=True,gridspec_kw={'height_ratios':[2,1]})
    first=pd.Timestamp(protocol['start'])-pd.Timedelta(days=1)
    for name,d in daily.items():
        dates=[first]+list(d.date);equity=np.r_[1e7,d.end_equity];dd=(equity/np.maximum.accumulate(equity)-1)*100
        style={'linestyle':'--','marker':'s','markerfacecolor':'none'} if name=='price_news' else {'linestyle':'-','marker':'o'}
        axes[0].plot(dates,equity/10000,label=names[name],color=colors[name],alpha=.9,**style)
        axes[1].plot(dates,dd,color=colors[name],alpha=.9,**style)
    axes[0].set_ylabel('자산 (만 원)');axes[1].set_ylabel('고점 대비 낙폭 (%)');axes[0].legend()
    axes[0].set_title('같은 1,000만 원 · 보유 종목 유지 · 교체할 때만 거래\n10거래일 탐색 실험 — 당시 뉴스 원본 미확인')
    if summary['changed_days']==0:
        axes[0].text(.98,.08,'매수 종목이 같아 두 선이 겹칩니다.\n최종 자산 차이: 0원',transform=axes[0].transAxes,
                     ha='right',va='bottom',bbox={'facecolor':'white','alpha':.9,'edgecolor':'#ccc'})
    for ax in axes:ax.grid(alpha=.25)
    fig.autofmt_xdate();fig.tight_layout();fig.savefig(out/'equity_comparison.png',dpi=160);plt.close(fig)
    esc=lambda v:html.escape(str(v))
    rows=[]
    for name,m in summary['metrics'].items():
        rows.append('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in [names[name],f"{m['final_equity']:,.0f}원",f"{m['net_profit']:+,.0f}원",f"{m['net_return']*100:+.2f}%",f"{m['mdd']*100:.2f}%",f"{m['total_fees']:,.0f}원",m['buy_orders']])+'</tr>')
    company_names=dict(zip(news.ticker,news.company_name))
    named=lambda codes:', '.join(company_names.get(c,c)+' ('+c+')' for c in codes)
    changes=''.join('<li>'+esc(r['date']+' 제외: '+named(r['dropped'])+' / 편입: '+named(r['added']))+'</li>' for r in summary['changes']) or '<li>선정 종목이 달라진 날이 없습니다.</li>'
    negatives=news[news.negative_filter].drop_duplicates('article_id')
    examples=''.join('<li>'+esc(r.company_name+' / '+str(r.event_type)+' — '+r.news_reason)+' · <a href="'+esc(r.article_url)+'">원문</a></li>' for r in negatives.itertuples()) or '<li>정해진 조건에 해당하는 직접 악재가 검출되지 않았습니다.</li>'
    state_names={'analyzed':'본문 분석 완료','no_discovered_article':'조건에 맞는 발견 기사 없음','body_unavailable':'본문 확보 실패',
                 'body_time_excluded':'본문 시각 조건 제외','classification_rejected':'분석 근거 검증 거절'}
    coverage=' · '.join(state_names.get(k,k)+' '+str(v)+'개' for k,v in summary['news_states'].items())
    api=summary['api_status']
    interpretation=('뉴스 악재 조건에 걸린 후보 '+str(summary['negative_candidate_days'])+'개 종목-거래일이 모두 기존 Top-5 밖에 있어 실제 매수 종목이 한 번도 바뀌지 않았습니다. 두 전략의 투자 결과가 같아 뉴스의 수익 개선 효과는 확인되지 않았습니다.'
                    if summary['changed_days']==0 else '고정된 뉴스 규칙으로 매수 종목이 달라진 날은 '+str(summary['changed_days'])+'일입니다. 이 짧은 구간의 수익 차이는 일반적인 우월성의 증거가 아닙니다.')
    api_info=esc(protocol['model'])+' · 본문 분석 검증 통과 '+str(api['validated'])+'건 · 근거 검증 거절 '+str(api['rejected'])+'건'
    if 'estimated_cost_usd' in api:
        api_info+=' · 이 분석의 사용량 기준 추정 API 비용 $'+format(api['estimated_cost_usd'],'.4f')
        api_info+=' · 앞선 형식 검증 실패 호출 포함 $'+format(api.get('accounted_cost_including_uncertain_calls_usd',api['estimated_cost_usd']),'.4f')+' (청구서 확정액 아님)'
    report=f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>1,000만 원 뉴스 결합 비교</title><style>body{{font-family:Malgun Gothic,sans-serif;background:#f5f7fb;color:#20304a;max-width:1100px;margin:30px auto;padding:0 20px}}p,li{{line-height:1.8}}img{{width:100%}}table{{width:100%;border-collapse:collapse;background:white}}td,th{{padding:13px;text-align:left;border-bottom:1px solid #ddd}}.notice{{padding:18px;background:#fff0d8}}a{{color:#276ab2}}</style>
    <h1>앙상블 단독 vs 뉴스 악재 필터</h1><p>{protocol['start']} ~ {protocol['end']} · 기존 평가 구간의 첫 10거래일 · 각각 1,000만 원</p>
    <p><strong>{esc(interpretation)}</strong></p>
    <p>{api_info}</p>
    <p class="notice">이 결과는 현재 확보한 과거 기사 본문으로 실행한 탐색 비교입니다. 당시 원문 미확인·짧은 기간·기사 누락 및 LLM 사전학습의 한계가 있습니다. 뉴스 결합 효과를 입증하는 독립 검증은 아닙니다.</p>
    <img src="equity_comparison.png" alt="두 전략의 자산과 낙폭 비교"><h2>거래비용 차감 후 결과</h2>
    <table><tr><th>전략</th><th>최종 자산</th><th>손익</th><th>수익률</th><th>MDD</th><th>거래비용</th><th>매수 건수</th></tr>{''.join(rows)}</table>
    <p>뉴스 추가 전략의 최종 자산 차이: {summary['difference_final_equity']:+,.0f}원. 거래비용은 편도 0.125%이며 API 이용료는 포함하지 않았습니다.</p>
    <h2>실험 전에 고정한 규칙</h2><p>매일 08:30에 가격 예측 상위 20개 후보의 최근 3일 중 가장 최신 기사 1건을 확인합니다. 본문에서 직접적인 악재와 지정 사건 유형이 확인된 후보를 뒤로 보내고, 나머지는 기존 가격 순위를 유지해 Top-5를 선정합니다. 긍정 기사 가점이나 수익률에 맞춘 가중치 조정은 없습니다. 학습된 ridge 결합 모델을 평가한 것은 아닙니다.</p>
    <p>첫날 5종목을 같은 금액으로 매수합니다. 다음 날도 선정된 종목은 수량 그대로 유지하고 탈락 종목만 시가에 교체합니다. 신규 종목에는 가용 현금을 균등 배분하며 마지막 날 종가에 전량 청산합니다. 소수점 수량을 허용하므로 실제 주문과 차이가 있습니다. 기존 보유 수량을 유지하여 매일 비중이 정확히 같지는 않습니다.</p>
    <h2>뉴스 확보 범위</h2><p>검색 기사 {summary['discovered_articles']}건, 규칙에 따라 선택한 기사 {summary['selected_headlines']}건.
    본문 확보 {summary['body_status'].get('body_extracted',0)}건. 후보 {summary['candidate_days']}개 종목-거래일 중 상태: {esc(coverage)}.</p>
    <p>본문 미확보·시각 제외·분석 거절·검색 결과 없음은 중립 기사로 간주하지 않았습니다. 이 경우 가격 순위를 유지했습니다. 후보별 최신 기사 1건만 분석하므로 전체 뉴스 효과를 검증한 것은 아닙니다. 엄격한 과거 당시 수집 기준의 기사는 0건입니다.</p>
    <p>기존 Top-5의 50개 종목-거래일 중 본문 분석이 연결된 것은 {summary['baseline_top5_news_states'].get('analyzed',0)}개입니다.
    근거 문장 일치 검사를 통과했다는 것은 감정 분류가 정답이라는 의미가 아니며, 사람의 정답 라벨로 측정한 분류 정확도는 없습니다.</p>
    <h2>선정 결과가 달라진 날: {summary['changed_days']}일</h2><ul>{changes}</ul><h2>악재 필터 근거 기사</h2><p>아래 해석은 AI 분류 결과이며 사람이 부여한 정답으로 검증한 것은 아닙니다.</p><ul>{examples}</ul>
    <p>10일의 수익 차이는 특정 종목 몇 개에 좌우될 수 있습니다. 결과를 보고 규칙이나 기간을 다시 골라 더 좋은 수치를 찾지 않았습니다. 추가 검증에는 앞으로 수집하는 원문과 충분한 별도 평가 기간이 필요합니다.</p>
    <p><a href="protocol.json">사전 고정 설정</a> · <a href="summary.json">전체 집계</a> · <a href="price_news_selection.csv">일별 후보·근거·선정 기록</a></p></html>'''
    (out/'report.html').write_text(report,encoding='utf-8')

def pending_report(out,bars_path):
    """Complete the independent baseline without manufacturing an incomplete news return."""
    from portfolio_replay import simulate
    protocol=read(out/'protocol.json');status=read(out/'extraction_status.json')
    if status['status']=='complete':raise ValueError('Analysis is complete; use replay instead')
    pool=pd.read_parquet(out/'candidates.parquet')
    selection=pool[pool.price_rank.le(5)][['date','entry_date','ticker','huber_ensemble']]
    met,d,t,h=simulate(selection,pd.read_parquet(bars_path),capital=protocol['capital_each'],cost=protocol['one_way_cost'])
    save_json(out/'price_only_metrics.json',met)
    for suffix,frame in [('daily',d),('trades',t),('holdings',h)]:frame.to_parquet(out/('price_only_'+suffix+'.parquet'),index=False)
    pending=status['requested_articles']-status['validated']-status['rejected']
    summary={'status':'awaiting_api_quota','protocol_sha256':digest(protocol),'price_only':met,
             'price_news':None,'news_return_comparison':None,'api_status':status,'remaining_articles':pending,
             'body_collected':len(read(out/'body_articles.json')),'selected_headlines':len(read(out/'selected_headlines.json'))}
    save_json(out/'pending_summary.json',summary)
    report=f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>뉴스 결합 비교 진행 현황</title><style>body{{font-family:Malgun Gothic,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;color:#20304a;background:#f4f7fb}}p,li{{line-height:1.8}}table{{border-collapse:collapse;width:100%;background:white}}td,th{{padding:16px;text-align:left;border-bottom:1px solid #ddd}}.notice{{padding:20px;background:#fff0d8}}progress{{width:100%;height:26px}}</style>
    <h1>1,000만 원 비교 실험 — 뉴스 분석 대기</h1><p>{protocol['start']} ~ {protocol['end']} · 10거래일 · 41개 기업 · 200개 후보-거래일</p>
    <p class="notice">Gemini 오류 응답에서 무료 일일 호출 한도 20회 초과가 확인됐습니다. 뉴스 분석이 미완료여서 두 전략의 우열이나 수익 차이를 아직 계산하지 않았습니다.</p>
    <h2>완료된 독립 기준선</h2><table><tr><th>항목</th><th>앙상블 단독</th><th>앙상블 + 뉴스 악재 필터</th></tr>
    <tr><td>초기 자금</td><td>10,000,000원</td><td>10,000,000원</td></tr>
    <tr><td>최종 자산</td><td>{met['final_equity']:,.0f}원</td><td>분석 완료 후 계산</td></tr>
    <tr><td>순손익</td><td>{met['net_profit']:+,.0f}원</td><td>미산출</td></tr>
    <tr><td>수익률</td><td>{met['net_return']*100:+.2f}%</td><td>미산출</td></tr>
    <tr><td>최대낙폭</td><td>{met['mdd']*100:.2f}%</td><td>미산출</td></tr>
    <tr><td>거래비용</td><td>{met['total_fees']:,.0f}원</td><td>미산출</td></tr></table>
    <h2>본문 분석 진행</h2><progress value="{status['validated']+status['rejected']}" max="{status['requested_articles']}"></progress>
    <p>최신 기사 표본 {summary['selected_headlines']}건 → 본문 {summary['body_collected']}건 확보 → 시간 조건 통과 {status['requested_articles']}건.
    응답 검증 통과 {status['validated']}건, 근거 검증 거절 {status['rejected']}건, 남은 분석 {pending}건입니다.</p>
    <h2>고정된 비교 조건</h2><p>가격 예측 상위 20개 안에서 직접적인 악재가 확인된 후보만 뒤로 보내 Top-5를 고릅니다. 긍정 기사 가점은 없습니다. 기사 미확보와 분석 거절은 별도 표시하고 가격 순위를 유지합니다.</p>
    <p>첫날 5종목 균등 매수, 이후 유지 종목 수량은 그대로 보유하고 교체 종목만 시가에 매매합니다. 신규 종목끼리 가용 현금을 균등 배분합니다. 편도 비용 0.125%, 소수점 수량, 마지막 날 종가 청산입니다. 매일 동일비중으로 재조정하는 전략은 아닙니다.</p>
    <p class="notice">현재 수집한 과거 기사로 실행하는 탐색 실험입니다. 당시 원문 미확인, LLM 사전학습, 짧은 기간, 종목당 최신 기사 1건이라는 제약이 있습니다. 학습된 뉴스 결합 모델의 성능 검증은 아닙니다.</p>
    <p>설정·본문·분석 캐시는 저장했습니다. 한도 회복 후 분석을 재개하고 전체 분류 시도를 완료한 뒤 같은 설정으로 투자 재생과 그래프를 생성합니다.</p>
    <p><a href="protocol.json">고정 설정</a> · <a href="pending_summary.json">집계</a> · <a href="api_error.json">호출 제한 진단</a></p></html>'''
    (out/'report.html').write_text(report,encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False),flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('stage',choices=['prepare','collect','bodies','analyze','replay','status'])
    p.add_argument('--out',default='outputs/news_ab_20260601_0615')
    p.add_argument('--predictions',default='../../outputs/validation_report/predictions.parquet')
    p.add_argument('--bars',default='../../outputs/validation_report/inputs/daily_bars.parquet')
    p.add_argument('--env-file',default='.env.news_fusion');a=p.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    if a.stage=='prepare':prepare(out,a.predictions)
    elif a.stage=='collect':collect(out)
    elif a.stage=='bodies':bodies(out)
    elif a.stage=='analyze':analyze(out,a.env_file)
    elif a.stage=='status':pending_report(out,a.bars)
    else:replay(out,a.bars)

if __name__=='__main__':main()

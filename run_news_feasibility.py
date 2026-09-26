"""Small real-news/API pilot. Does not claim a trained news strategy's return."""
import argparse
from pathlib import Path
import json
import html
import pandas as pd
from news_fusion.news import save_json,digest,timestamp
from news_fusion.gemini import GeminiExtractor,load_key
from news_fusion.fusion import build_features,score_and_select,replay_selection

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--out',default='outputs/news_fusion')
    p.add_argument('--predictions',required=True);p.add_argument('--bars',required=True)
    p.add_argument('--env-file',default='.env.news_fusion');p.add_argument('--max-calls',type=int,default=12)
    a=p.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    protocol={'purpose':'feasibility_only_not_alpha_evaluation','start':'2026-06-01','end':'2026-09-14',
              'sample_tickers':['005930','000660','005380'],'extraction_sample':'first chronological headline per ticker/month',
              'model':'gemini-2.5-flash-lite','cutoff':'08:30 Asia/Seoul','lookback_days':3,
              'price_pool':20,'final_top_n':5,'news_weights':'not fitted; no assumed alpha',
              'predictions_sha256':digest(Path(a.predictions).read_bytes().hex()),
              'collection_scope':'historical RSS discovery, weekly queries; not comprehensive or point-in-time'}
    path=out/'pilot_protocol.json'
    if path.exists() and json.loads(path.read_text(encoding='utf-8'))!=protocol:raise ValueError('Protocol changed; use a new run directory')
    save_json(path,protocol)
    articles=json.loads((out/'articles.json').read_text(encoding='utf-8'))
    audit=json.loads((out/'collection_audit.json').read_text(encoding='utf-8'))
    sample=[]
    for ticker in protocol['sample_tickers']:
        for month in [6,7,8,9]:
            candidates=sorted([n for n in articles if n['ticker']==ticker and timestamp(n['published_at']).month==month],key=lambda n:(n['published_at'],n['article_id']))
            if candidates:sample.append(candidates[0])
    save_json(out/'sample_articles.json',sample)
    extractor=GeminiExtractor(load_key(a.env_file),out/'gemini_cache',model=protocol['model'],max_calls=a.max_calls)
    results=[];failure=None
    for n in sample:
        try:
            results.append(extractor.extract(n));save_json(out/'sample_extractions.json',results)
            print(n['ticker'],n['published_at'][:10],results[-1]['result']['sentiment'],flush=True)
        except RuntimeError as exc:failure=str(exc);break
    price=pd.read_parquet(a.predictions)
    # No external outcome data is ever sent to the news extractor.
    all_extractions={r['article_id']:r for r in results}
    smoke=out/'api_smoke.json'
    if smoke.exists():
        for r in json.loads(smoke.read_text(encoding='utf-8'))['results']:
            all_extractions[r['extraction']['article_id']]=r['extraction']
    all_extractions=list(all_extractions.values());save_json(out/'extractions.json',all_extractions)
    strict=build_features(price,articles,all_extractions,'strict')
    exploratory=build_features(price,articles,all_extractions,'exploratory')
    strict.to_parquet(out/'features_strict.parquet',index=False)
    exploratory.to_parquet(out/'features_exploratory.parquet',index=False)
    selected=score_and_select(exploratory)
    selected.to_parquet(out/'identity_selection.parquet',index=False)
    selected.to_csv(out/'identity_selection.csv',index=False,encoding='utf-8-sig')
    met,d,t,h=replay_selection(selected,pd.read_parquet(a.bars))
    for name,f in [('identity_daily',d),('identity_trades',t),('identity_holdings',h)]:f.to_parquet(out/(name+'.parquet'),index=False)
    counts=[]
    for ticker in protocol['sample_tickers']:
        for month in [6,7,8,9]:
            ns=[n for n in articles if n['ticker']==ticker and timestamp(n['published_at']).month==month]
            counts.append({'ticker':ticker,'month':month,'unique_headlines':len(ns)})
    summary={'status':'pilot_complete' if failure is None else 'api_stopped','api_error':failure,
             'new_api_calls':extractor.calls,'sample_requested':len(sample),'sample_completed':len(results),
             'collection_queries':len(audit),'collection_errors':sum('error' in x for x in audit),
             'queries_possibly_truncated':sum(x.get('possibly_truncated',False) for x in audit),
             'zero_result_queries':sum(x.get('retained_count')==0 for x in audit),
             'unique_headlines':len(articles),'counts':counts,
             'strict_eligible_stock_dates':int(strict.eligible_articles.gt(0).sum()),
             'exploratory_eligible_stock_dates':int(exploratory.eligible_articles.gt(0).sum()),
             'extracted_usable_stock_dates':int(exploratory.usable_articles.gt(0).sum()),
             'total_stock_dates':len(exploratory),'identity_baseline':met,
             'news_strategy_return':None,'fusion_model_trained':False,
             'reasons_no_news_return':['Only three companies sampled, not all Top20 candidates',
              'Only a small article sample classified; incomplete extraction is not neutral sentiment',
              'Historical RSS is not an original-version PIT archive',
              'No earlier chronological news training/validation dataset supplied'],
             'sample_usage_total_tokens':sum(r.get('usage',{}).get('totalTokenCount',0) for r in results)}
    save_json(out/'feasibility_summary.json',summary)
    rows=''.join(f'<tr><td>{r["ticker"]}</td><td>{r["month"]}월</td><td>{r["unique_headlines"]:,}</td></tr>' for r in counts)
    examples=[]
    lookup={r['article_id']:r for r in results}
    for n in sample:
        if n['article_id'] not in lookup:continue
        r=lookup[n['article_id']]['result']
        examples.append('<tr>'+''.join('<td>'+html.escape(str(v))+'</td>' for v in [n['company_name'],n['published_at'][:10],n['title'],r['sentiment'],r['event_type'],r['evidence_quote']])+'</tr>')
    body=f'''<!doctype html><html lang="ko"><meta charset="utf-8"><title>뉴스 결합 가능성 시험</title>
    <style>body{{font-family:Malgun Gothic,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;background:#f5f7fb;color:#20304a}}table{{border-collapse:collapse;width:100%;background:white}}th,td{{padding:12px;border-bottom:1px solid #ddd;text-align:left}}p,li{{line-height:1.8}}.card{{padding:18px;background:white;border-left:5px solid #287e69;margin:16px 0}}</style>
    <h1>뉴스 결합 가능성 시험</h1><p>대상 기간: 2026.06.01~09.14. 뉴스 조회는 첫 거래일 준비를 위해 05.29부터 포함.</p>
    <div class="card">3개 기업 뉴스 제목 {len(articles):,}건 확보 · 월별 표본 {len(results)}/{len(sample)}건 Gemini 분석 완료</div>
    <p>이 결과는 자료 수집과 프로그램 연결의 가능성을 확인한 것입니다. 뉴스 추가로 투자 성능이 좋아졌다는 결과가 아닙니다.</p>
    <h2>자료 품질</h2><ul><li>검색 {len(audit)}회 중 {summary['queries_possibly_truncated']}회는 결과 상한에 닿아 누락 가능성이 있습니다.</li>
    <li>검색 결과 0건인 요청은 {summary['zero_result_queries']}회입니다. 실제 뉴스가 없었다는 뜻은 아닙니다.</li>
    <li>모두 현재 검색한 제목입니다. 본문 전문 및 당시 최초 버전은 확보하지 않았습니다.</li>
    <li>당시 수집 기록을 요구하는 엄격한 기준에서 사용 가능한 종목·날짜 조합: {summary['strict_eligible_stock_dates']}개.</li></ul>
    <h2>월별 제목 수</h2><table><tr><th>종목</th><th>월</th><th>수집 제목 수</th></tr>{rows}</table>
    <h2>실제 Gemini 분석 표본</h2><p>모델: gemini-2.5-flash-lite. 가격 순위와 실제 수익률은 전달하지 않았습니다. 아래 감정은 주가 상승확률이 아닙니다. 추출 정확도에 대한 사람의 평가도 아직 아닙니다.</p>
    <table><tr><th>기업</th><th>날짜</th><th>제목</th><th>감정</th><th>사건</th><th>원문 근거</th></tr>{''.join(examples)}</table>
    <h2>기존 투자 엔진 연결</h2><p>뉴스 가중치 없이 가격 순위를 그대로 사용했을 때 최종 자산 {met['final_equity']:,.0f}원.
    이 수치는 기존 Huber의 재현 확인이며 새로운 뉴스 전략의 성과가 아닙니다.</p>
    <h2>남은 조건</h2><p>전체 후보의 뉴스 확보, 이전 기간 뉴스와 시점별 가격 예측을 이용한 결합 모델 학습, 별도 평가가 필요합니다.
    현재 개발된 결합 학습기는 과거 학습 예측·미래 기사·같은 기간 학습과 평가를 검사합니다. 이번 실행에서는 결합 모델을 학습하지 않았습니다.</p>
    <p><a href="feasibility_summary.json">집계 JSON</a> · <a href="identity_selection.csv">가격 기준 후보와 뉴스 지표</a></p></html>'''
    (out/'report.html').write_text(body,encoding='utf-8')
    print(json.dumps({k:v for k,v in summary.items() if k not in ['counts','reasons_no_news_return']},ensure_ascii=False),flush=True)

if __name__=='__main__':main()

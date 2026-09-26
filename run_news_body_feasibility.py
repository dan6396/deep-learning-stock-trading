"""Paired headline/body extraction, with full-input receipts and time-quality audit."""
import argparse
import html
import json
from pathlib import Path
import numpy as np
import pandas as pd
from news_fusion.news import save_json,digest,eligible,timestamp
from news_fusion.gemini import GeminiExtractor,load_key,PROMPT_VERSION
from news_fusion.body import EXTRACTOR_VERSION
from news_fusion.fusion import build_features

def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--out',default='outputs/news_body')
    p.add_argument('--headlines',default='outputs/news_fusion/sample_articles.json')
    p.add_argument('--predictions',required=True)
    p.add_argument('--max-calls',type=int,default=18)
    p.add_argument('--env-file',default='.env.news_fusion')
    a=p.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    audit=read(out/'body_audit.json');bodies=read(out/'body_articles.json')
    headlines={r['article_id']:r for r in read(a.headlines)}
    predictions=pd.read_parquet(a.predictions)
    dates=sorted(predictions.entry_date.unique())
    decisions=[timestamp(d)+pd.Timedelta(hours=8,minutes=30) for d in dates]
    protocol={'purpose':'body_extraction_feasibility_not_investment_performance',
              'model':'gemini-2.5-flash-lite','prompt_version':PROMPT_VERSION,
              'body_extractor_version':EXTRACTOR_VERSION,'selection':'same 12 preselected ticker/month headlines; failures retained',
              'body_ids':[b['article_id'] for b in bodies],
              'headline_ids':list(headlines),'source_text_snapshot_digest':digest(bodies),
              'input_policy':'entire extracted text; over 30000 characters rejected, never silently truncated',
              'evaluation_start':str(pd.Timestamp(dates[0]).date()),'evaluation_end':str(pd.Timestamp(dates[-1]).date())}
    protocol_path=out/'body_protocol.json'
    if protocol_path.exists() and read(protocol_path)!=protocol:raise ValueError('Protocol changed; use another output directory')
    save_json(protocol_path,protocol)
    extractor=GeminiExtractor(load_key(a.env_file),out/'gemini_cache',max_calls=a.max_calls)
    pairs=[];error=None;extractions=[]
    for article in bodies:
        parent=headlines[article['parent_article_id']]
        # Same model, prompt and generation settings for both arms, not old-v1 labels.
        try:
            body_result=extractor.extract(article);extractions.append(body_result)
            save_json(out/'body_extractions.json',extractions)
            title_result=extractor.extract(parent)
        except (RuntimeError,ValueError) as exc:
            error=str(exc);break
        assert body_result['input_chars']==len(article['text']) and not body_result['input_truncated']
        pair={'parent_article_id':parent['article_id'],'body_article_id':article['article_id'],
              'ticker':article['ticker'],'company_name':article['company_name'],'title':parent['title'],
              'url':article['url'],'body_chars':len(article['body']),
              'published_at':article['published_at'],'modified_at':article.get('modified_at'),
              'retrieved_at':article['retrieved_at'],'headline_extraction':title_result,'body_extraction':body_result,
              'sentiment_changed':title_result['result']['sentiment']!=body_result['result']['sentiment'],
              'strict_eligible_days':sum(eligible(article,d,mode='strict') for d in decisions),
              'exploratory_eligible_days':sum(eligible(article,d,mode='exploratory') for d in decisions)}
        pairs.append(pair);save_json(out/'paired_results.json',pairs)
        print(article['ticker'],article['published_at'][:10],len(article['body']),
              title_result['result']['sentiment'],'->',body_result['result']['sentiment'],flush=True)
    counts={}
    for r in audit:
        reason=r.get('failure_reason','body_extracted');counts[reason]=counts.get(reason,0)+1
    summary={'status':'complete' if error is None else 'stopped','api_error':error,
             'attempted_articles':len(audit),'accepted_bodies':len(bodies),'failure_counts':counts,
             'paired_analyses':len(pairs),'new_api_calls':extractor.calls,
             'sentiment_changes':sum(r['sentiment_changed'] for r in pairs),
             'whitespace_aligned_quotes':sum(bool(r[k].get('evidence_alignment')) for r in pairs for k in ['headline_extraction','body_extraction']),
             'input_truncations':sum(r['body_extraction']['input_truncated'] for r in pairs),
             'body_chars_min':min([len(b['body']) for b in bodies],default=0),
             'body_chars_max':max([len(b['body']) for b in bodies],default=0),
             'strict_eligible_articles':sum(any(eligible(b,d,mode='strict') for d in decisions) for b in bodies),
             'exploratory_eligible_articles':sum(any(eligible(b,d,mode='exploratory') for d in decisions) for b in bodies),
             'modified_after_evaluation':sum(bool(b.get('modified_at')) and timestamp(b['modified_at'])>=decisions[-1].normalize()+pd.Timedelta(days=1) for b in bodies),
             'news_strategy_return':None,'human_labeled_accuracy':None,
             'sample_scope':'three large companies, 12 preselected headlines; not population coverage',
             'paired_total_tokens':sum(r[k].get('usage',{}).get('totalTokenCount',0) for r in pairs for k in ['headline_extraction','body_extraction'])}
    save_json(out/'body_summary.json',summary)
    feature_audit={}
    late_ids={b['article_id'] for b in bodies if b.get('modified_at') and
              timestamp(b['modified_at'])>=decisions[-1].normalize()+pd.Timedelta(days=1)}
    for mode in ['strict','exploratory']:
        features=build_features(predictions,bodies,extractions,mode=mode)
        target=out/mode;target.mkdir(parents=True,exist_ok=True)
        features.to_parquet(target/'features.parquet',index=False)
        used=set(x for ids in features.evidence_ids for x in json.loads(ids))
        assert not used.intersection(late_ids), 'Post-evaluation revision entered historical features'
        feature_audit[mode]={'stock_dates':len(features),'dates':int(features.entry_date.nunique()),
                            'rows_with_usable_news':int(features.usable_articles.gt(0).sum()),
                            'distinct_used_articles':len(used),
                            'unprocessed_article_occurrences':int(features.unprocessed_articles.sum()),
                            'late_revision_used':False}
    save_json(out/'feature_audit.json',feature_audit)
    labels={'positive':'긍정','neutral':'중립','negative':'부정','unclear':'불명확'}
    reasons={'body_extracted':'본문 확보','insufficient_body':'본문 미확보',
             'conflicting_published_dates':'게시 시각 충돌'}
    def esc(v):return html.escape(str(v if v is not None else '미상'))
    rows=''.join('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in [r['ticker'],r['title'],r.get('body_chars',0),
         reasons.get(r.get('failure_reason','body_extracted'),r.get('failure_reason')),r.get('extraction_method','')])+'</tr>' for r in audit)
    cards=[]
    for r in pairs:
        br=r['body_extraction']['result'];hr=r['headline_extraction']['result']
        # Keep report excerpts short; full source text stays in local research cache.
        evidence=' '.join(br['evidence_quote'].split()[:8])
        if len(evidence)>150:evidence=evidence[:150]+'…'
        cards.append(f'''<div class="card"><h3>{esc(r['company_name'])} · {esc(r['title'])}</h3>
          <p><b>제목 {labels[hr['sentiment']]} → 본문 {labels[br['sentiment']]}</b> · 본문 {r['body_chars']:,}자</p>
          <p>게시: {esc(r['published_at'])}<br>수정: {esc(r['modified_at'])}<br>
          해당 평가 기간의 탐색적 입력 가능 거래일: {r['exploratory_eligible_days']}일</p>
          <p>AI 분석: {esc(br['reason'])}</p><p>짧은 근거: “{esc(evidence)}”</p>
          <p><a href="{esc(r['url'])}">언론사 원문 확인</a></p></div>''')
    report=f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>기사 본문 분석 시험</title><style>body{{font-family:Malgun Gothic,sans-serif;max-width:1100px;margin:36px auto;padding:0 20px;background:#f4f7fb;color:#20304a}}p,li{{line-height:1.8}}.card{{background:white;padding:20px;margin:18px 0;border-left:5px solid #337e73}}table{{border-collapse:collapse;width:100%;background:white}}td,th{{padding:10px;border-bottom:1px solid #ddd;text-align:left}}.warn{{background:#fff1df;padding:20px}}a{{color:#2467a6}}</style>
      <h1>이번에는 제목과 본문을 함께 읽었습니다</h1>
      <p>기존에 선정한 3개 기업 × 6~9월 월별 기사 12건. 추출 실패 표본도 그대로 기록했습니다.</p>
      <div class="card">본문 확보 {len(bodies)}/{len(audit)}건 · 동일 조건 제목/본문 분석 {len(pairs)}쌍 · 감정 변화 {summary['sentiment_changes']}건 · 입력 잘림 {summary['input_truncations']}건</div>
      <p>실행 상태: {'완료' if error is None else '중단 — '+esc(error)}. 평가 기간: {protocol['evaluation_start']} ~ {protocol['evaluation_end']}.</p>
      <p>Gemini에 넘긴 것은 추출한 본문 전체와 제목입니다. 가격 모델 순위나 실제 수익률은 넘기지 않았습니다.
      API 입력 길이·해시를 저장하고 길이가 맞는지 검사했습니다. 동영상 내용이나 사진 속 글자까지 읽었다는 의미는 아닙니다.</p>
      <p>근거 인용은 원문과 대조합니다. 글자는 같고 공백·줄바꿈만 다른 인용 {summary['whitespace_aligned_quotes']}건은 원문 구간으로 복원하고, 모델이 처음 출력한 인용도 기록했습니다. 내용이 바뀐 인용은 거부합니다.</p>
      <div class="warn"><b>과거 당시 원문으로 검증된 자료는 아닙니다.</b><br>
      평가 종료 이후 수정된 기사 {summary['modified_after_evaluation']}건은 해당 과거 구간 입력에서 제외됩니다.
      당시 수집 시각을 요구하는 엄격 기준에서 사용 가능한 기사는 {summary['strict_eligible_articles']}건입니다.
      이번 결과는 본문 수집·분석 가능성 시험이며 수익률 개선이나 감정분류 정확도 검증이 아닙니다.</div>
      <h2>가격 예측 자료와 연결 확인</h2>
      <p>{feature_audit['exploratory']['dates']}거래일 · {feature_audit['exploratory']['stock_dates']:,}개 종목-거래일에 뉴스 지표를 연결했습니다.
      탐색 기준에서 표본 뉴스가 연결된 행은 {feature_audit['exploratory']['rows_with_usable_news']}개,
      엄격 기준에서는 {feature_audit['strict']['rows_with_usable_news']}개입니다. 기사 수가 매우 적어 KOSPI200 전체의 뉴스 효과를 평가할 수는 없습니다.
      평가 종료 후 수정된 기사가 지표에 들어가지 않았음을 실제 생성 결과에서도 검사했습니다.</p>
      <h2>전체 표본 확보 결과</h2><table><tr><th>종목</th><th>제목</th><th>본문 글자 수</th><th>판정</th><th>추출 방식</th></tr>{rows}</table>
      <h2>같은 기사의 제목과 본문 비교</h2><p>아래 설명은 Gemini 출력입니다. 사람이 정답을 부여한 평가는 아직 아닙니다.</p>{''.join(cards)}
      <div class="warn"><b>긍정적인 기사 표현과 주가 상승 신호는 다릅니다.</b>
      이번 표본에서는 기업 공식 홍보 기사도 본문 분석 후 긍정으로 분류됐습니다.
      이 결과만으로 감정분석이 더 정확해졌거나 투자에 도움이 된다고 판단할 수 없습니다.
      기사 유형과 출처에 따른 편향, 사람의 정답과의 일치율, 별도 기간 투자 성과를 추가로 평가해야 합니다.</div>
      <h2>재현 자료</h2><p><a href="body_summary.json">결과 집계</a> · <a href="body_protocol.json">실험 설정</a> · <a href="paired_results.json">입력 길이·해시 및 비교 결과</a> · <a href="feature_audit.json">뉴스 지표 연결 검사</a></p>
      </html>'''
    (out/'report.html').write_text(report,encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False),flush=True)

if __name__=='__main__':main()

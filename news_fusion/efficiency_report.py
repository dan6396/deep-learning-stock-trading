"""Self-contained Korean report and static figures for the exploratory pilot."""
from __future__ import annotations
import base64
import html
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
import pandas as pd


def label(record):
    if record['id']=='price_only':return '가격 단독'
    pool='가격20' if record['pool']=='price20' else '가격20+뉴스10'
    return f"{pool} · 기사{record['articles']} · 뉴스{int(record['weight']*100)}%"


def report(out):
    out=Path(out)
    load=lambda name:json.loads((out/name).read_text(encoding='utf-8'))
    metrics=load('metrics.json'); protocol=load('protocol.json'); api=load('extraction_status.json')
    body_seconds=load('body_timing.json')['seconds_including_cache']
    plan=load('plan_summary.json'); bodies=load('body_audit.json'); discovery=load('collection_audit.json')
    daily=pd.read_parquet(out/'daily_equity.parquet')
    font=Path('C:/Windows/Fonts/malgun.ttf')
    if font.exists():font_manager.fontManager.addfont(str(font));plt.rcParams['font.family']='Malgun Gothic'
    plt.rcParams['axes.unicode_minus']=False
    plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
    baseline=metrics[0]; best=max(metrics,key=lambda r:r['final_equity']); defense=max(metrics,key=lambda r:r['mdd'])
    lookup={r['id']:r for r in metrics}; dates=sorted(daily.date.unique())
    color_price='#2563eb'; color_best='#e76f24'; color_other='#a6b3c6'

    # One comparison per figure: two accounts receiving the same initial capital.
    fig,ax=plt.subplots(figsize=(12,5.6))
    for ident,color,name in [('price_only',color_price,'기존 가격 모델'),
                             (best['id'],color_best,'뉴스 결합: 이번 구간 수익 1위')]:
        d=daily[daily.strategy==ident].sort_values('date')
        wealth=[1000.]+(d.end_equity/10000).tolist()
        ax.plot(range(len(wealth)),wealth,color=color,lw=3,marker='o',markersize=5,label=name)
        ax.text(len(dates)+.28,wealth[-1],f"{wealth[-1]:,.1f}만 원  ({lookup[ident]['net_return']*100:+.2f}%)",
                va='center',color=color,fontweight='bold',fontsize=11)
    ax.axhline(1000,color='#9ba7b6',lw=1,ls=':')
    ax.set(xlim=(-.15,len(dates)+3.25),ylim=(940,1055),ylabel='그날 장 마감 후 자산 (만 원)',
           title='같은 1,000만 원으로 투자했다면?')
    ax.set_xticks(range(len(dates)+1),['시작']+[pd.Timestamp(d).strftime('%m/%d') for d in dates])
    ax.grid(axis='y',alpha=.25);ax.legend(loc='upper left',frameon=False,fontsize=11)
    fig.text(.5,.01,'6/1~6/15, 10거래일 · 매매비용 차감 · 뉴스 조합은 12개 중 관측 수익 1위',
             ha='center',fontsize=9,color='#475569')
    fig.tight_layout(rect=[0,.04,1,.98]);fig.savefig(out/'equity_comparison.png',dpi=170);plt.close(fig)

    # Every predeclared arm in one readable ordering. The rightmost column is
    # workload, not a second unlabeled coordinate system or an API invoice.
    positions=[0,1.5,2.5,3.5,5.0,6.0,7.0,8.5,9.5,10.5,12.0,13.0,14.0]
    fig,ax=plt.subplots(figsize=(12.6,8.2))
    for y,row in zip(positions,metrics):
        if row['id']=='price_only':
            name='기존 모델 · 뉴스 없음';color=color_price
        else:
            group='가격 20' if row['pool']=='price20' else '가격 20 + 뉴스 10'
            name=f"{group} · 기사 {row['articles']}건 · 뉴스 {int(row['weight']*100)}%"
            color=color_best if row['id']==best['id'] else color_other
        value=row['net_return']*100
        ax.barh(y,value,height=.66,color=color)
        ax.text(value+(.07 if value>=0 else -.07),y,f'{value:+.2f}%',
                va='center',ha='left' if value>=0 else 'right',fontsize=10,
                color='#172b4d',fontweight='bold' if row['id']==best['id'] else 'normal')
        ax.text(4.62,y,f"{row['unique_bodies']}건",ha='center',va='center',fontsize=10,color='#475569')
    for separator in [.75,4.25,7.75,11.25]:ax.axhline(separator,color='#e4e9f0',lw=1)
    ax.axvline(baseline['net_return']*100,color=color_price,lw=1.5,ls='--',alpha=.7)
    ax.axvline(0,color='#94a3b8',lw=1)
    ax.set(yticks=positions,yticklabels=[('기존 모델 · 뉴스 없음' if r['id']=='price_only' else
            f"{'가격 20' if r['pool']=='price20' else '가격 20 + 뉴스 10'} · 기사 {r['articles']}건 · 뉴스 {int(r['weight']*100)}%") for r in metrics],
           xlim=(-1.4,5.08),ylim=(14.7,-1.4),xlabel='최종 수익률 (%)',
           title='12가지 뉴스 결합 중 기존 모델보다 더 번 조합은 1가지')
    ax.text(4.62,-.78,'분석 본문',ha='center',va='center',fontweight='bold',fontsize=10)
    ax.text(baseline['net_return']*100,-.78,'기존 +2.42%',ha='center',va='center',
            color=color_price,fontweight='bold',fontsize=9,
            bbox={'facecolor':'white','edgecolor':'none','alpha':.9,'pad':1})
    ax.grid(axis='x',alpha=.17)
    fig.text(.5,.025,'파랑: 기존 모델  |  주황: 이 10일의 최고 수익  |  오른쪽: 모델에 보낸 종목·본문 분석 대상 수',
             ha='center',fontsize=9,color='#475569')
    fig.subplots_adjust(left=.37,right=.97,top=.89,bottom=.11)
    fig.savefig(out/'efficiency_comparison.png',dpi=170);plt.close(fig)
    table=[]
    for row in sorted(metrics,key=lambda r:r['final_equity'],reverse=True):
        table.append('<tr>'+''.join(f'<td>{html.escape(str(v))}</td>' for v in [label(row),f"{row['final_equity']:,.0f}",
            f"{row['net_return']*100:+.2f}%",f"{row['mdd']*100:.2f}%",f"{row['total_fees']:,.0f}",
            f"{row['rank_ic_full_universe_policy']:.4f}",f"{row['sharpe_annualized']:.2f}",
            row['unique_bodies'],row['discovery_companies_required'],row['changed_days_vs_price'],row['selected_outside_price20'],
            '-' if row['selected_news_coverage'] is None else f"{row['selected_news_coverage']*100:.0f}%"] )+'</tr>')
    def embed(name):return 'data:image/png;base64,'+base64.b64encode((out/name).read_bytes()).decode('ascii')
    lo,hi=best['paired_return_diff_ci95_descriptive']
    baseline_curve=daily[daily.strategy=='price_only'].sort_values('date').end_equity.to_numpy()
    best_curve=daily[daily.strategy==best['id']].sort_values('date').end_equity.to_numpy()
    lead_days=int((best_curve>baseline_curve+1e-6).sum())
    explanation=f'''<p>관측 1위가 가격 단독보다 자산이 많았던 날은 {lead_days}/10일입니다.
마지막 거래일 직전 자산 차이는 {best_curve[-2]-baseline_curve[-2]:+,.0f}원이었고,
최종 차이는 {best_curve[-1]-baseline_curve[-1]:+,.0f}원입니다. 마지막 날의 영향이 커서 기간에 민감합니다.</p>
<p>가격 단독 대비 손익 변화: 야간 보유 손익 {best['overnight_pnl']-baseline['overnight_pnl']:+,.0f}원,
장중 손익 {best['intraday_pnl']-baseline['intraday_pnl']:+,.0f}원,
거래비용 증가 {best['total_fees']-baseline['total_fees']:+,.0f}원.
정책 Rank IC는 {baseline['rank_ic_full_universe_policy']:.4f} → {best['rank_ic_full_universe_policy']:.4f}입니다.
최종 자산 증가를 전체 종목의 일중 순위 예측력 향상으로 해석할 수 없습니다.</p>'''
    issues=sum('error' in r for r in discovery)
    capped=sum(bool(r.get('possibly_truncated')) and 'requested_start' in r and
        (pd.Timestamp(r['requested_end'])-pd.Timestamp(r['requested_start'])).days<=1 for r in discovery)
    # Fixed illustrative arm, not cherry-picked from the observed winner.
    example=pd.read_parquet(out/'union_a2_w50_selection.parquet')
    names=load('companies.json'); audit=[]
    winner_selection=pd.read_parquet(out/(best['id']+'_selection.parquet'))
    promoted=winner_selection[winner_selection.selected & winner_selection.price_rank.gt(20)]
    cases=[]
    for row in promoted.itertuples():
        items=json.loads(row.evidence)
        source=items[0] if items else None
        link='근거 미확보'
        if source and source['url'].startswith(('http://','https://')):
            link=f'<a href="{html.escape(source["url"],quote=True)}">{html.escape(source["title"])}</a>'
        cases.append(f'<li>{pd.Timestamp(row.entry_date).strftime("%m/%d")} {html.escape(names.get(row.ticker,row.ticker))}: '
            f'가격 {row.price_rank}위 → 최종 {row.final_rank}위. {link}</li>')
    promotion_html='<h2>가격 순위 밖에서 들어온 실제 사례</h2><ul>'+''.join(cases)+'</ul><p>이는 후보 경로가 작동한 사례이며, 해당 뉴스가 이후 수익을 일으켰다는 인과 증거는 아닙니다.</p>' if cases else ''
    for date,group in example[example.selected].groupby('entry_date'):
        rows=[]
        for r in group.sort_values('final_rank').itertuples():
            evidence=json.loads(r.evidence); references=[]
            for item in evidence:
                url=item['url'] if item['url'].startswith(('https://','http://')) else '#'
                tone={'positive':'긍정','negative':'부정','neutral':'중립'}[item['sentiment']]
                references.append(f'<a href="{html.escape(url,quote=True)}">{html.escape(item["title"])}</a> ({tone})')
            rows.append('<tr>'+''.join('<td>'+v+'</td>' for v in [html.escape(names.get(r.ticker,r.ticker)),
                str(r.price_rank),str(r.final_rank),f'{r.price_contribution:+.3f}',f'{r.news_contribution:+.3f}',
                f'{r.final_score:+.3f}','<br>'.join(references) if references else '사용 가능한 뉴스 없음'])+'</tr>')
        audit.append(f'<details><summary>{pd.Timestamp(date).strftime("%m/%d")} 선정 근거</summary><div class="scroll"><table><tr>'
            '<th>기업</th><th>가격 순위</th><th>최종 순위</th><th>가격 기여</th><th>뉴스 기여</th><th>합계</th><th>원문</th></tr>'
            +''.join(rows)+'</table></div></details>')
    text=f'''<!doctype html><html lang="ko"><meta charset="utf-8"><title>가격·뉴스 결합 효율 실험</title>
<style>body{{font-family:Malgun Gothic,Arial,sans-serif;color:#18243a;background:#f3f6fa;max-width:1220px;margin:36px auto;padding:0 22px;line-height:1.7}}
h1{{font-size:30px}}h2{{margin-top:32px}}.card{{background:white;padding:24px;border-radius:14px;margin:18px 0}}.note{{border-left:5px solid #e6a526;background:#fff8e8;padding:16px}}img{{width:100%}}table{{border-collapse:collapse;width:100%;font-size:12px}}td,th{{padding:10px 7px;border-bottom:1px solid #ddd;text-align:right;white-space:nowrap}}td:first-child,th:first-child{{text-align:left}}.scroll{{overflow-x:auto}}.muted{{color:#566579}}code{{background:#edf1f6;padding:2px 5px}}</style>
<h1>가격·뉴스 결합: 수익과 분석 효율 비교</h1>
<p class="muted">2026-06-01~06-15 · 10거래일 · 모델별 1,000만 원 · 12개 뉴스 조합 + 가격 단독</p>
<div class="note"><b>탐색 실험입니다.</b> 이미 살펴본 기간에서 여러 규칙을 비교했습니다. 아래 1위는 이 구간에서 관측된 결과이며,
독립 검증이나 미래 성능의 증거가 아닙니다. 과거 기사 원본·완전한 수집 이력도 확보되지 않았습니다.</div>
<div class="card"><h2>이번 구간에서 무엇이 달랐나</h2>
<p>관측 수익 1위: <b>{html.escape(label(best))}</b> — 최종 <b>{best['final_equity']:,.0f}원</b>, 수익률 {best['net_return']*100:+.2f}%.<br>
가격 단독: {baseline['final_equity']:,.0f}원, {baseline['net_return']*100:+.2f}%. 차이 {best['final_equity']-baseline['final_equity']:+,.0f}원.<br>
관측 최대낙폭 최소: <b>{html.escape(label(defense))}</b> — MDD {defense['mdd']*100:.2f}%.</p>
{explanation}
{promotion_html}
<p>전체 실험 추가 API 사용량 기준 추정 비용: <b>${api['additional_accounted_cost_usd']:.4f}</b> / 상한 $1.
모든 조합이 기사 분석을 공유합니다. 이것을 조합별 개별 청구액으로 나누어 해석하면 안 됩니다.
이전 분석 비용과 인터넷·크롤링 운영비는 별도이며, 원화 투자 수익에 API 달러 비용을 차감하지 않았습니다.</p></div>
<div class="card"><h2>① 투자금이 어떻게 변했나</h2>
<p>두 선 모두 1,000만 원에서 시작합니다. 오른쪽 숫자가 10거래일 뒤 자산입니다.
파란 선은 기존 모델, 주황 선은 이번 10일의 관측 수익 1위입니다.</p>
<img src="{embed('equity_comparison.png')}" alt="기존 모델과 뉴스 결합 1위의 1,000만 원 자산 추이"></div>
<div class="card"><h2>② 다른 뉴스 조합은 어땠나</h2>
<p>막대가 오른쪽으로 길수록 최종 수익률이 높습니다. 파란 점선은 기존 모델의 +2.42%입니다.
주황색 1개만 선을 넘었습니다. 오른쪽의 ‘분석 본문’은 유료 모델에 보낸 종목·본문 쌍의 수이며, 조합별 실제 청구액은 아닙니다.</p>
<p><b>‘가격 20 + 뉴스 10’</b>은 가격 모델 상위 20종목과 뉴스 제목만으로 고른 10종목을 합친 후보입니다.
<b>‘기사 2건’</b>은 후보 종목당 본문을 최대 2건 읽는다는 뜻입니다.
<b>‘뉴스 75%’</b>는 정규화한 가격 점수 25%와 뉴스 점수 75%를 합친 고정 규칙입니다.</p>
<img src="{embed('efficiency_comparison.png')}" alt="기존 모델을 기준으로 나열한 열두 뉴스 조합의 수익률과 본문 수"></div>
<div class="card"><h2>전체 결과 — 관측 최종 자산 순</h2><div class="scroll"><table><thead><tr>
<th>전략</th><th>최종 자산(원)</th><th>순수익률</th><th>MDD</th><th>거래비용(원)</th><th>정책 Rank IC</th><th>Sharpe*</th><th>본문 수</th><th>검색 기업 수</th><th>변경일/10</th><th>20위 밖 매수 자리</th><th>매수 뉴스 확보율</th>
</tr></thead><tbody>{''.join(table)}</tbody></table></div>
<p class="muted">본문 수는 시간 조건을 통과한 고유 종목·본문 쌍이며 근거 검증 거절도 포함합니다. 같은 기사도 분석 대상 기업이 다르면 별개입니다.
비용 비교의 대용 지표이며 토큰 수·호출 묶음에 따라 실제 비용은 달라집니다.
검색 기업 수는 각 전략을 독립 실행할 때 제목 발견이 필요한 구간 전체 고유 기업 수입니다. 합집합은 본문 수가 작아도 전체 Universe 제목 검색 부담이 있습니다.
변경일은 가격 단독과 Top-5 구성이 달라진 날입니다. 밖 매수 자리는 50개 종목-거래일 중 가격 20위 밖 종목의 수입니다.</p>
<p class="muted">정책 Rank IC는 매일 공통 200종목에서 후보를 먼저, 후보 내부는 결합 점수로, 나머지는 가격 순서로 정렬한 순위와 O-C 수익률의 상관입니다.
기존 수익률 예측값 자체의 IC와 개념이 다릅니다. 합성 점수는 상승확률이나 기대수익률이 아니므로 방향 정확도를 계산하지 않았습니다.
*Sharpe는 무위험수익률 0, 일별 수익의 √252 연환산이며 10일 표본에서는 불안정합니다.</p></div>
<div class="card"><h2>불확실성과 비용</h2>
<p>관측 1위와 가격 단독의 누적 수익률 차이에 대한 날짜 2일 블록 재표집 95% 구간: {lo*100:+.2f}~{hi*100:+.2f}%p.
3,000회, 고정 난수로 계산한 기술적 진단이며 다중 비교·승자 선택 편향을 보정하지 않았습니다.</p>
<p>전체 {plan['stock_days']:,}개 종목-거래일에서 뉴스 독립 경로가 가격20 밖 후보 {plan['news_only_candidate_days']}개를 추가했습니다.
선정 고유 제목 {plan['unique_headlines']}개 중 본문 확보 {sum(r['status']=='body_extracted' for r in bodies)}개.
분석 근거 검증 통과 {api['validated']}개, 거절 {api['rejected']}개. 기존 유효 라벨 {api['reused_valid']}개를 재사용했습니다.
검색 오류 {issues}건, 하루 단위로 나누어도 검색 상한에 도달한 조회 {capped}건.
검색 성공·0건은 완전한 뉴스 수집을 의미하지 않습니다.</p>
<p>공유 본문 처리 {body_seconds/60:.1f}분(캐시 포함), 이번 실행 API·응답 검증 {api['api_wall_seconds_this_run']/60:.1f}분.
전체 제목 수집시간과 가격 모델 추론시간은 포함되지 않으며, 각 조합의 독립 실행시간을 측정한 값도 아닙니다.</p></div>
<div class="card"><h2>방법과 해석 범위</h2><ul>
<li>가격20 / 가격20+뉴스10 × 대표 기사1 / 2 × 뉴스 비중25 / 50 / 75%를 결과 확인 전에 고정했습니다.</li>
<li>뉴스 후보는 가격과 무관하게 기업명·사건 키워드·최신성으로 고릅니다. 호재만 선택하지 않습니다. 본문 미확보 시 다른 기사로 임의 교체하지 않습니다.</li>
<li>동일 숫자 사실의 유사 제목을 중복 제거하지만 완전한 사건 군집화는 아닙니다. 제목 단계의 누락과 기업명 혼동이 남을 수 있습니다.</li>
<li>가격 백분위 점수와 뉴스 감정 점수를 각각 [-1,1] 범위로 결합했습니다. 동일 비중은 예측 정보량이 같다는 뜻이 아닙니다. 뉴스 없음·실패는 중립 판정과 별도로 표시합니다.</li>
<li>08:30 이전 정보, 최근3일. 불확실한 게시시각은 다음날부터 허용하고 결정 이후 수정된 본문은 제외합니다. 당시 기사 원본이 확인된 엄격 백테스트가 아닙니다.</li>
<li>첫5종목 동일 현금 배분, 보유 수량 유지, 이탈 종목만 시가 교체, 마지막 종가 청산. 편도 비용0.125%, 소수점 주식. 매일 동일비중 재조정은 아닙니다.</li>
<li>유지 종목의 야간 수익도 자산에 반영됩니다. 다음날 O-C 예측력과 포트폴리오 수익은 별도 지표입니다.</li>
<li><b>학습형 결합은 미실행:</b> 학습·검증 기간의 과거 뉴스와 정직한 가격 OOF 자료가 필요합니다. 10일을 잘게 쪼개 훈련했다고 주장하지 않습니다.</li>
<li>이번 관측 1위를 곧바로 실전에 채택하지 않습니다. 구간을 늘려 검증한 뒤 미사용 미래 기간에서 최종 비교해야 합니다.</li>
</ul><p>추정 API 단가: <a href="https://developers.openai.com/api/docs/models/gpt-4.1-mini">OpenAI GPT-4.1 mini 공식 문서</a>.
연구 배경: <a href="https://aclanthology.org/2022.acl-long.437/">GAME</a>, <a href="https://link.springer.com/article/10.1007/s40747-025-02023-3">MSGCA</a>,
<a href="https://developers.lseg.com/en/product/news/news_analytics">LSEG News Analytics</a>. 이번 결합기는 이 논문들의 재현 모델이 아닙니다.</p></div>
<div class="card"><h2>최종 종목이 뽑힌 과정</h2><p>고정 예시: 가격20+뉴스10, 대표 기사2건, 뉴스50%.
아래 숫자는 정규화된 순위 점수의 기여도이며 상승확률이나 예측 수익률이 아닙니다.
LLM은 기사 정보를 추출하고, 최종 점수와 순위는 고정 수식으로 계산합니다.
원문 인용 근거와 실패 상태를 포함한 전체 기록은 각 전략의 <code>*_decisions.csv</code>에 있습니다.</p>{''.join(audit)}</div>
</html>'''
    (out/'report.html').write_text(text,encoding='utf-8')
    print('Report:',str((out/'report.html').resolve()))

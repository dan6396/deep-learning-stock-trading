"""Continuous-window report with frozen July selection and clustered intervals."""
from pathlib import Path
import json

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from news_fusion.news import save_json
from run_news_continuous_models import FEATURES,OUT
from run_news_residual_research import read,sha

LABELS={'price_rank':'가격 단독','title_tfidf':'제목 글자 패턴','title_e5':'제목 의미',
        'event_e5':'사건 제목 의미','title_tree':'뉴스+가격 트리','event_counts':'간단한 사건 지표',
        'company_identity':'종목 이름만','news_volume':'뉴스 양만','price_tree':'가격만 트리',
        'selected_news':'7월 검증으로 선택'}


def report():
    metrics=pd.read_csv(FEATURES/'metrics.csv')
    daily=pd.read_csv(FEATURES/'daily.csv')
    ic=pd.read_csv(FEATURES/'daily_ic.csv')
    pivot=ic[ic.block=='all'].pivot(index='date',columns='strategy',values='rank_ic')
    n=len(pivot);rng=np.random.default_rng(6396)
    starts=rng.integers(0,n,size=(10000,int(np.ceil(n/5))))
    indices=((starts[:,:,None]+np.arange(5)[None,None,:])%n).reshape(10000,-1)[:,:n]
    uncertainty=[]
    for name in pivot:
        delta=(pivot[name]-pivot.price_rank).to_numpy();samples=delta[indices].mean(axis=1)
        uncertainty.append({'strategy':name,'ic_gain':float(delta.mean()),
                            'block95_low':float(np.quantile(samples,.025)),
                            'block95_high':float(np.quantile(samples,.975)),
                            'improved_days':int((delta>0).sum()),'days':n})
    save_json(FEATURES/'ic_uncertainty.json',uncertainty)
    # Invariance of the baseline against independently replaying the saved price scores.
    assert metrics.independent_ledger_max_error.max()<1e-6
    for p,h in read(FEATURES/'protocol.json')['source_hashes'].items():assert sha(p)==h,p
    for record in read(FEATURES/'fit_audit.json'):
        assert record['last_training_date']<record['forecast_date']
    assert sha(FEATURES/'frozen_forecasts.parquet')==read(FEATURES/'score_audit.json')['sha256']
    save_json(FEATURES/'integrity_audit.json',{'source_hashes':'passed','chronology':'passed','ledger_max_error':float(metrics.independent_ledger_max_error.max())})
    configs=read(FEATURES/'frozen_configs.json');selected=read(FEATURES/'selected_strategy.json')['selected']
    plt.rcParams.update({'font.family':'Malgun Gothic','axes.unicode_minus':False,'font.size':11})
    fig,ax=plt.subplots(figsize=(12,5.6))
    for name,color,style in [('price_rank','#2764AC','-'),('selected_news','#D86929','--')]:
        d=daily[(daily.block=='all')&(daily.strategy==name)].sort_values('date')
        x=pd.to_datetime(d.date)
        x=pd.DatetimeIndex([x.iloc[0]-pd.Timedelta(days=1),*x])
        y=np.r_[1000,d.end_equity.to_numpy()/10000]
        ax.plot(x,y,color=color,ls=style,lw=2.4,label=f'{LABELS[name]}: {y[-1]:,.1f}만 원')
    ax.axhline(1000,color='#999999',ls=':',lw=1)
    ax.set_title(f'1,000만 원 연속 투자 · {n}거래일\n6월 학습 → 7월 설정 선택 → 8~9월 설정 고정')
    ax.set_ylabel('자산 (만 원)');ax.grid(alpha=.15);ax.legend(loc='best')
    fig.text(.5,.01,'Top-5 보유·교체 / 편도 비용0.125% / 이미 본 기간을 확대한 탐색 결과',ha='center',fontsize=10,color='#555555')
    fig.tight_layout(rect=[0,.045,1,1]);fig.savefig('docs/validation/news_continuous_equity.png',dpi=170);plt.close(fig)
    panel=pd.read_parquet(FEATURES/'panel.parquet')
    permonth=panel.groupby(panel.entry_date.dt.month).agg(days=('entry_date','nunique'),rows=('ticker','size'),titles=('title_text',lambda s:s.ne('').sum()),events=('event_text',lambda s:s.ne('').sum()))
    totals=metrics[metrics.block=='all'].set_index('strategy')
    chosen=totals.loc['selected_news'];price=totals.loc['price_rank']
    selected_u=next(x for x in uncertainty if x['strategy']=='selected_news')
    lines=['# 연속된 6~9월 자료로 확대한 뉴스 실험','',
           f'가격 단독 최종 자산은 **{price.final_equity:,.0f}원**, 7월 검증에서 고른 전략은 **{chosen.final_equity:,.0f}원**입니다. 차이는 **{chosen.final_equity-price.final_equity:+,.0f}원**입니다.',
           f'Rank IC는 {price.rank_ic:.5f} → {chosen.rank_ic:.5f}, 차이의5일 블록 재표집95% 구간은 [{selected_u["block95_low"]:+.5f}, {selected_u["block95_high"]:+.5f}]입니다.',
           '',f'7월에서 고른 방법: **{LABELS.get(selected,selected)}**. '+('뉴스 비중이 검증 기준을 넘지 못해 가격 단독으로 돌아갔습니다.' if selected=='price_rank' else '이후8~9월에서는 방법·비중을 다시 고르지 않고 과거 자료로 모델 계수만 갱신했습니다.'),'',
           '**모든 가격 평가 기간을 이미 살펴본 뒤 수행한 확대 탐색입니다. 새 독립 holdout으로 발표할 수 없습니다.** [설계](news_continuous_design.md), [앞선 연구와 발견한 데이터 문제](news_research_conclusion.md).','',
           '![연속 투자](validation/news_continuous_equity.png)','','## 자료 범위','',
           '| 월 | 거래일 | 종목·일 | 제목 있음 | 사건 제목 있음 |','|---|---:|---:|---:|---:|']
    for month,r in permonth.iterrows():lines.append(f'| {month}월 | {r.days:,} | {r.rows:,} | {r.titles:,} | {r.events:,} |')
    audit=read(OUT/'collection_audit.json')
    lines+=['',f'누락 날짜 보충 검색 기록 {len(audit):,}개 중 상한 도달 표시 {sum(x["possibly_truncated"] for x in audit):,}개입니다. 분할 전 검색도 포함한 개수이며, 분할 후에도 검색 누락이 없다는 뜻은 아닙니다.',
            '이번 확대는 가격 후보 선택과 무관한 전체 종목 제목 연구입니다. 본문을 추가로 전부 수집·분석한 실험이 아닙니다. 유료 API 추가 호출은0회입니다.','',
            '## 7월에서 고정한 설정','',
            '| 방법 | 정규화 | 뉴스 비중 | 7월 검증 Rank IC |','|---|---:|---:|---:|']
    for name,c in configs.items():lines.append(f'| {LABELS[name]} | {c["alpha"]:g} | {c["weight"]:.2f} | {c["validation_ic"]:.5f} |')
    lines+=['','## 8~9월 연속투자: 모든 방법','',
            'fixed는 사전에 정한 기본값(정규화10·비중0.25), validated는7월에서 고정한 값입니다. fixed 결과가 더 좋더라도 검증에서 선택한 승자로 바꾸어 소개하지 않습니다.','',
            '| 방법 | Rank IC | 최종 자산 | MDD | 거래비용 | 장중 손익 | 야간 손익 |','|---|---:|---:|---:|---:|---:|---:|']
    for r in metrics[metrics.block=='all'].itertuples():
        lines.append(f'| {r.strategy} | {r.rank_ic:.5f} | {r.final_equity:,.0f} | {r.mdd:.2%} | {r.total_fees:,.0f} | {r.intraday_pnl:,.0f} | {r.overnight_pnl:,.0f} |')
    lines+=['','## 예측력 차이의 불확실성','',
            '| 방법 | 가격 대비 IC 차이 | 95% 탐색 구간 | 개선 일수 |','|---|---:|---:|---:|']
    for r in uncertainty:
        lines.append(f'| {r["strategy"]} | {r["ic_gain"]:+.5f} | [{r["block95_low"]:+.5f}, {r["block95_high"]:+.5f}] | {r["improved_days"]}/{r["days"]} |')
    lines+=['','## 월별 보조 결과','',
            '다음 표는 각 월에 자금을 다시1,000만 원으로 시작합니다. 위 연속투자와 별도 계산입니다.','',
            '| 월 | 방법 | Rank IC | 최종 자산 |','|---|---|---:|---:|']
    for r in metrics[(metrics.block!='all')&metrics.strategy.isin(['price_rank','selected_news'])].itertuples():
        lines.append(f'| {r.block} | {r.strategy} | {r.rank_ic:.5f} | {r.final_equity:,.0f} |')
    lines+=['','## 해석 제한과 재현','',
            '기사의 사후 검색·상한과 시점별 구성종목 복원의 한계가 남습니다. 사건 키워드는 확정된 사건 라벨이 아니며, E5는 금융 전용 모델이 아닌 고정 다국어 표현기입니다. 반복적인 연구 선택을 신뢰구간으로 보정하지 않았습니다.','',
            '실행: `run_news_continuous.py collect` → `run_news_continuous_models.py features`, `embeddings`, `fit`, `evaluate` → `report_news_continuous.py`. 입력 해시·검증 선택표·예측 점수·일별 투자 원장·연산 감사 결과는 `outputs/news_continuous_v1/models/`에 저장됩니다.','']
    Path('docs/news_continuous_results.md').write_text('\n'.join(lines),encoding='utf-8')
    print('Selected',selected)
    print(metrics[(metrics.block=='all')&metrics.strategy.isin(['price_rank','selected_news'])][['strategy','rank_ic','final_equity','mdd']].to_string(index=False))


if __name__=='__main__':report()

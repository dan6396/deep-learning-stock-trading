"""Report every residual experiment, with date-block and alignment diagnostics."""
from pathlib import Path
import json

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import rankdata

from news_fusion.news import save_json
from run_news_residual_research import OUT

NAMES = {'price_rank':'가격 단독', 'title_tfidf_fixed':'제목 글자 패턴',
         'body_tfidf_fixed':'본문 글자 패턴', 'title_e5_fixed':'제목 의미',
         'body_e5_fixed':'본문 의미', 'title_e5_context_fixed':'제목 의미×가격 상태',
         'coverage_fixed':'뉴스 유무만 (대조군)', 'selected_news':'이전 검증으로 선택한 뉴스 결합'}
BLOCKS = {'down':'6/30~7/13 · 10거래일', 'up':'7/29~8/11 · 10거래일', 'sep':'9/15~9/23 · 7거래일'}


def diagnostics():
    forecasts=pd.read_parquet(OUT/'frozen_forecasts.parquet')
    labels=pd.read_parquet(OUT/'feature_panel.parquet')[['entry_date','ticker','actual_oc']]
    forecasts=forecasts.merge(labels,on=['entry_date','ticker'],validate='one_to_one')
    ic=pd.read_csv(OUT/'daily_ic.csv');strategies=list(ic.strategy.unique())
    pivot=ic.pivot(index='date',columns='strategy',values='rank_ic')
    rng=np.random.default_rng(20260926)
    # Resample short contiguous blocks WITHIN each period, never across a month-long gap.
    parts=[]
    for block in ['down','up','sep']:
        days=sorted(ic.loc[ic.block==block,'date'].unique())
        n=len(days);positions=pivot.index.get_indexer(days)
        starts=rng.integers(0,n,size=(5000,int(np.ceil(n/3))))
        offsets=(starts[:,:,None]+np.arange(3)[None,None,:])%n
        parts.append(positions[offsets.reshape(5000,-1)[:,:n]])
    draws=np.concatenate(parts,axis=1)
    output=[]
    for strategy in strategies:
        if strategy=='price_rank':continue
        delta=(pivot[strategy]-pivot.price_rank).to_numpy()
        boot=delta[draws].mean(axis=1)
        # Conditional alignment diagnostic: shuffle correction among similarly ranked
        # stocks on the same date; does not rerun training or selection under the null.
        samples=[];actual=[]
        for _,g in forecasts.groupby('entry_date'):
            base=g.price_rank.to_numpy();correction=(g[strategy]-g.price_rank).to_numpy()
            target=rankdata(g.actual_oc.to_numpy());target-=target.mean()
            bucket=np.minimum((base*5).astype(int),4)
            shuffled=np.tile(correction,(300,1))
            for q in range(5):
                idx=np.flatnonzero(bucket==q)
                for row in shuffled:row[idx]=rng.permutation(correction[idx])
            ranked=rankdata(base[None,:]+shuffled,axis=1)
            ranked-=ranked.mean(axis=1,keepdims=True)
            sim=(ranked@target)/(np.linalg.norm(ranked,axis=1)*np.linalg.norm(target))
            samples.append(sim)
            actual.append(float(g[strategy].corr(g.actual_oc,method='spearman')))
        null=np.mean(samples,axis=0);observed=np.mean(actual)
        output.append({'strategy':strategy,'mean_rank_ic_gain':float(delta.mean()),
                       'moving_block_95_low':float(np.quantile(boot,.025)),
                       'moving_block_95_high':float(np.quantile(boot,.975)),
                       'positive_gain_days':int((delta>0).sum()),'days':len(delta),
                       'shuffled_alignment_mean_ic':float(null.mean()),
                       'observed_ic':float(observed),
                       'alignment_tail_fraction':float((1+(null>=observed).sum())/(1+len(null))),
                       'caution':'post-selection diagnostic, not a confirmatory p value; multiple trials unadjusted'})
    save_json(OUT/'diagnostics.json',output)
    return pd.DataFrame(output)


def report():
    diagnostic=diagnostics()
    m=pd.read_csv(OUT/'metrics.csv');daily=pd.read_csv(OUT/'daily.csv')
    frame=pd.read_parquet(OUT/'feature_panel.parquet')
    choices=json.loads((OUT/'choices.json').read_text(encoding='utf-8'))
    counts=pd.Series([x['selected'] for x in choices if x['branch']=='selected_news']).value_counts().to_dict()
    plt.rcParams.update({'font.family':'Malgun Gothic','axes.unicode_minus':False,'font.size':11})
    colors={'price_rank':'#2764AC','selected_news':'#D86929'}
    fig,axes=plt.subplots(1,3,figsize=(16,5),sharey=False)
    for ax,(block,label) in zip(axes,BLOCKS.items()):
        for name in colors:
            g=daily[(daily.block==block)&(daily.strategy==name)].sort_values('date')
            curve=np.r_[1000,g.end_equity.to_numpy()/10000]
            ax.plot(range(len(curve)),curve,color=colors[name],lw=2.5,label=NAMES[name])
            ax.annotate(f'{curve[-1]:,.1f}만 원',(len(curve)-1,curve[-1]),xytext=(-4,8 if name=='price_rank' else -16),
                        textcoords='offset points',ha='right',color=colors[name],fontsize=10)
        ax.axhline(1000,color='#888888',ls=':',lw=1);ax.set_title(label)
        ax.set_xlabel('해당 구간 거래일 (0일 = 시작)');ax.set_ylabel('자산 (만 원)');ax.grid(alpha=.15)
    fig.suptitle('매 구간 1,000만 원 · 가격 단독 vs 이전 날짜 검증으로 고른 뉴스 결합',fontsize=16)
    handles,labels=axes[0].get_legend_handles_labels();fig.legend(handles,labels,loc='lower center',ncol=2,bbox_to_anchor=(.5,.025))
    fig.text(.5,.002,'Top-5 보유·교체 / 편도 비용 0.125% / 이미 살펴본 기간을 재사용한 탐색 실험',ha='center',fontsize=10,color='#555555')
    fig.tight_layout(rect=[0,.10,1,.92])
    path=Path('docs/validation/news_residual_equity.png');path.parent.mkdir(exist_ok=True)
    fig.savefig(path,dpi=170);plt.close(fig)
    # Simple IC comparison. Price line is shared; zero is the no-correlation reference.
    keep=list(NAMES)
    avg=pd.read_csv(OUT/'daily_ic.csv').groupby('strategy').rank_ic.mean()
    fig,ax=plt.subplots(figsize=(11,6))
    vals=[avg[n] for n in keep]
    ax.barh([NAMES[n] for n in keep],vals,color=['#2764AC' if n=='price_rank' else '#D86929' if n=='selected_news' else '#96A7B8' for n in keep])
    ax.axvline(avg.price_rank,color='#2764AC',ls='--',label=f'가격 단독 {avg.price_rank:.4f}')
    ax.axvline(0,color='#777777',lw=.7)
    ax.set_xlim(min(0,min(vals)*1.1),max(vals)*1.13)
    for i,v in enumerate(vals):ax.text(v+.001,i,f'{v:.4f}',va='center',fontsize=10)
    ax.invert_yaxis();ax.set_xlabel('27거래일 평균 Rank IC · 높을수록 실제 수익률 순서를 잘 맞춤')
    ax.set_title('뉴스를 넣었을 때 종목 순위 예측력이 개선됐는가?');ax.legend(loc='lower right')
    fig.tight_layout();fig.savefig('docs/validation/news_residual_rankic.png',dpi=170);plt.close(fig)
    lines=['# 뉴스로 가격 모델의 순위 오차를 보정한 실험','',
           '[연구 근거와 설계](news_research_design.md). 유료 API 추가 호출 0회. 공개 E5는 문장 표현기로 고정하고 순위 보정기만 학습했습니다.','',
           '**전체 37일 중 첫 10일은 준비, 나머지 27일은 하루씩 이전 자료로만 학습·예측했습니다. 모두 이미 관찰한 날짜이므로 독립 최종 test는 아닙니다.**','',
           '## 핵심 비교','',
           '아래 뉴스 결합은 수익률을 본 뒤 고른 승자가 아닙니다. 매 예측일 전에 과거 검증 Rank IC로 방법·계수·비중을 선택했고, 개선이 없으면 가격 단독을 사용합니다.','',
           '| 기간 | 가격 단독 자산 | 검증 선택 뉴스 자산 | 뉴스 결합 차이 | 가격 IC | 뉴스 IC |','|---|---:|---:|---:|---:|---:|']
    for block in BLOCKS:
        b=m[(m.block==block)&(m.strategy=='price_rank')].iloc[0]
        n=m[(m.block==block)&(m.strategy=='selected_news')].iloc[0]
        lines.append(f'| {BLOCKS[block]} | {b.final_equity:,.0f}원 | {n.final_equity:,.0f}원 | {n.final_equity-b.final_equity:+,.0f}원 | {b.rank_ic:.4f} | {n.rank_ic:.4f} |')
    lines+=['','![구간별 자산](validation/news_residual_equity.png)','','![순위 예측력 비교](validation/news_residual_rankic.png)','',
            '## 모든 방법 공개','',
            'fixed는 정규화 계수10·뉴스 비중0.25, adaptive는 이전 5개 관측일 검증으로 결정합니다. 순위 점수를 상승확률로 해석하지 않으므로 방향정확도 대신 Top-5 실제 상승 비율을 표기합니다.','',
            '| 기간 | 방법 | Rank IC | 최종 자산 | MDD | 비용 | Top-5 상승 비율 |','|---|---|---:|---:|---:|---:|---:|']
    for row in m.itertuples():
        lines.append(f'| {row.block} | {row.strategy} | {row.rank_ic:.4f} | {row.final_equity:,.0f} | {row.mdd:.2%} | {row.total_fees:,.0f} | {row.top5_positive_rate:.1%} |')
    lines+=['','## 불확실성·대조 실험','',
            '| 방법 | 평균 IC 개선 | 일자 블록 재표집 95% 구간 | 실제 뉴스 배치 IC | 뉴스 보정치 섞기 평균 IC |','|---|---:|---:|---:|---:|']
    for row in diagnostic.itertuples():
        lines.append(f'| {row.strategy} | {row.mean_rank_ic_gain:+.5f} | [{row.moving_block_95_low:+.5f}, {row.moving_block_95_high:+.5f}] | {row.observed_ic:.5f} | {row.shuffled_alignment_mean_ic:.5f} |')
    lines+=['','3거래일 블록을 구간 내부에서 재표집했습니다. 뉴스 보정치는 같은 날 비슷한 가격 순위의 종목끼리 섞었습니다. 이 대조군은 예측 시점의 배치 효과 진단이며 전체 학습·선택을 다시 수행하는 유의성 검정이 아닙니다. 여러 방법을 반복 탐색한 영향을 보정하지 않았으므로 통계적 확증으로 해석할 수 없습니다.','',
            '## 데이터와 실행 기록','',
            f'- 전체 {len(frame):,}종목·일 중 제목이 있는 행 {frame.universe_title.ne("").sum():,}, 본문이 있는 행 {frame.body_text.ne("").sum():,}.',
            '- 9월에는 본문이 없어 본문 단독 보정은 0입니다. 9월에서 본문 방법이 가격 단독과 같은 결과인 것은 검증 성공이 아닙니다.',
            '- 본문 TF-IDF는 확보한 전문, E5는 결합 텍스트의 앞 256토큰을 사용했습니다. 긴 본문의 모든 내용을 의미 분석했다는 주장은 하지 않습니다.',
            f'- 검증 선택 횟수: {json.dumps(counts,ensure_ascii=False)}.',
            '- Google News RSS 사후 검색이고 결과 상한과 과거 본문 버전 불확실성이 있습니다. 기존 KOSPI200 종목 집합의 생존편향 가능성도 남습니다.',
            '- 최종 자산에는 기존 보유 종목의 야간 수익도 포함됩니다. Open→Close Rank IC와 자산 순위가 다른 것은 모순이 아닙니다.',
            '- 실행: `run_news_residual_corrected.py prepare`, `embeddings`, `fit`, `evaluate`, `report` 순서. 초기 제목 특징·임베딩은 `run_news_residual_research.py` 산출물을 재사용합니다.',
            f'- 원자료 해시·고정 언어모델 revision·선택 이력·예측 점수·원장 검증 결과: `{OUT.as_posix()}`.',
            '- 학습 종료일 < 예측일을 강제하고, 현재·미래 실현값을 제거해도 예측이 같은지 자동 테스트했습니다. 서비스 기본 모델은 변경하지 않았습니다.','']
    if 'corrected' in OUT.name:
        lines[2:2]=['**수정판 v3:** 각 날짜의 원래 수집 계획에 포함된 본문만 사용했습니다. v2는 다른 날짜 후보로 확보한 본문까지 풀어서 사용해 본문 존재 여부에 이후 후보 선정 정보가 섞일 여지가 있었습니다. v2의 본문 개선 수치는 채택 근거에서 제외하고 이 수정판으로 대체했습니다.','']
    Path('docs/news_residual_results.md').write_text('\n'.join(lines),encoding='utf-8')
    print(m[m.strategy.isin(['price_rank','selected_news'])][['block','strategy','rank_ic','final_equity']].to_string(index=False))
    print(diagnostic[diagnostic.strategy=='selected_news'].to_string(index=False))


if __name__=='__main__':report()

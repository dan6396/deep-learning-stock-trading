"""Summarize the bounded news-fusion experiments without selecting a winner."""
from __future__ import annotations

from pathlib import Path
import json

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


OUT = Path('outputs/news_experiments_20260926')
WALK = Path('outputs/news_walkforward_v1')
TEXT = Path('outputs/news_title_walkforward_v1')
LATER = Path('outputs/news_title_holdout_sep2026_v1')
SEMANTIC = Path('outputs/news_semantic_sensitivity_v1')
API = Path('outputs/news_event_audit_v3')


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    walk = pd.read_csv(WALK/'metrics.csv')
    text = pd.read_csv(TEXT/'metrics.csv')
    later = pd.read_csv(LATER/'metrics.csv')
    sem = pd.read_csv(SEMANTIC/'metrics.csv')
    later_days = pd.read_csv(LATER/'daily.csv')
    audit = read(LATER/'score_audit.json')
    collection = read(LATER/'collection_audit.json')
    ledger = read(API/'api_ledger.json')
    plt.rcParams['font.family'] = 'Malgun Gothic'
    plt.rcParams['axes.unicode_minus'] = False
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.1), sharey=True)
    for ax, policy in zip(axes, ['top5','cost_aware']):
        for strategy, label, color in [('huber_ensemble','가격 Huber','#2357A4'),
                                       ('title_ridge','가격+기사 제목','#D36A27')]:
            d=later_days[(later_days.strategy==strategy)&(later_days.turnover==policy)].sort_values('date')
            y=np.r_[10.,d.end_equity.to_numpy()/1e6]
            ax.plot(range(len(y)),y,label=label,color=color,lw=2.5)
        ax.axhline(10,color='#999999',lw=.8,ls='--')
        ax.set_title('매일 Top-5' if policy=='top5' else '왕복비용 초과 시 교체')
        ax.set_xlabel('거래일 (9/15 시작)')
        ax.grid(alpha=.2)
    axes[0].set_ylabel('평가자산 (백만 원)')
    handles, labels=axes[0].get_legend_handles_labels()
    fig.legend(handles,labels,loc='lower center',ncol=2,frameon=False)
    fig.suptitle('기존 뉴스 실험에 쓰지 않은 2026-09-15~23 · 각 1,000만 원',fontsize=12)
    fig.tight_layout(rect=[0,.10,1,.92])
    fig.savefig(OUT/'later_equity.png',dpi=170,bbox_inches='tight')
    plt.close(fig)

    lines=['# 뉴스 결합 알고리즘 반복 실험 결과','',
           '기존 Huber 가격 예측은 그대로 두고, 저장된 뉴스로 여러 결합 방식을 탐색했다. 앞의 30거래일은 이미 결과를 살펴본 기간이며, 마지막 7거래일은 그 이후의 별도 기간이다. 후자는 점수를 파일로 고정한 다음 실현 수익률을 계산했지만 기사 검색은 거래일 이후에 이루어져 당시 이용 가능했던 기사 원문을 증명하지 못한다.','',
           '## 앞선 30일: 첫 10일 학습, 이후 20일 날짜 순서대로 재학습·평가','',
           '가격만 재보정한 회귀모델과 뉴스 사건 특징을 추가한 선형 회귀, 비선형 트리, 기사 제목 글자 n-gram 회귀를 비교했다. 각 날짜의 모델은 그 이전 날짜의 수익률만 학습했다. 아래 자산은 국면별로 1,000만 원에서 다시 시작하고 매일 Top-5, 편도 0.125% 비용을 적용한 결과다.','',
           '| 국면 | 방식 | 일별 Rank IC 평균 | 최종 자산 |',
           '|---|---|---:|---:|']
    for regime, ko in [('down','하락 6/30~7/13'),('up','상승 7/29~8/11')]:
        for source, strategy, label in [(walk,'huber','Huber 가격 단독'),
                                        (walk,'news_ridge','기사 사건+가격 선형'),
                                        (walk,'news_tree','기사 사건+가격 트리'),
                                        (text,'title_ridge_a100','기사 제목+가격 선형')]:
            m=source[(source.regime==regime)&(source.strategy==strategy)&(source.turnover=='top5')].iloc[0]
            lines.append(f'| {ko} | {label} | {m.mean_daily_rank_ic:.4f} | {m.final_equity:,.0f}원 |')
    lines += ['', '확정되지 않은 수주·스포츠 구단 관련 기사 13건을 추가 배제한 실험에서도 사건+가격 선형모델의 Rank IC는 하락 구간 0.1469, 상승 구간 -0.0196으로 가격 단독(0.1587, -0.0015)에 미치지 못했다. 이 필터는 이미 기사 오류를 본 뒤 만든 것이므로 보조 진단일 뿐이다.','',
              '## 이후 7일: 고정한 제목 모델을 새 날짜에 한 번 적용','',
              f"과거 {audit['training_days']}일로 제목 모델을 학습했고, 2026-09-15~23의 {audit['holdout_days']}거래일에서 {audit['holdout_title_stock_days']:,}/{audit['holdout_days']*200:,} 종목·일에 제목이 연결됐다. 최근 주가 자료는 200종목 모두 확보했으며, 새 Huber 예측은 기존 중복 날짜 값을 최대 약 0.000000008만큼만 차이 나게 재현했다. 기사 검색 {len(collection):,}건 중 결과 상한에 닿은 조회는 {sum(bool(x.get('possibly_truncated')) for x in collection):,}건으로, 뉴스 표본이 불완전할 수 있다.",'',
              '| 방식 | 일별 Rank IC 평균 | 매일 Top-5 최종 자산 | 비용기준 교체 최종 자산 |',
              '|---|---:|---:|---:|']
    for strategy, label in [('huber_ensemble','Huber 가격 단독'),('title_ridge','기사 제목+가격')]:
        top=later[(later.strategy==strategy)&(later.turnover=='top5')].iloc[0]
        cost=later[(later.strategy==strategy)&(later.turnover=='cost_aware')].iloc[0]
        lines.append(f'| {label} | {top.mean_daily_rank_ic:.4f} | {top.final_equity:,.0f}원 | {cost.final_equity:,.0f}원 |')
    lines += ['', '![9월 후속 구간 자산](later_equity.png)','',
              '## 판정과 한계','',
              '- 어느 뉴스 결합 방식도 두 기존 평가 구간에서 가격 단독 대비 일관된 예측 개선을 보이지 않았다. 강하게 학습한 제목·사건 모델은 오히려 순위와 수익을 악화시켰고, 강한 정규화는 효과를 거의 0으로 줄였다.',
              '- 이후 7일에서도 제목 모델의 Rank IC 차이는 0.000005로 실질적으로 0에 가까웠고 투자 결과는 낮았다. 기간이 7일뿐이므로 일반적 결론은 낼 수 없다.',
              '- 앞선 30일을 보고 여러 방식을 탐색했으므로 그 결과로 최적 모델을 선택해 같은 기간을 새 테스트라고 부를 수 없다. 9월 기사도 거래 후 수집한 RSS 제목이며, 수집 상한과 누락이 있다.',
              '- 더 정확한 기업 역할·확정 여부 추출기는 15건 이하의 표본 감사부터 시도했으나 첫 OpenAI 요청이 HTTP 429로 거절돼 중단했다. 추가 호출·자동 대체는 없었다. 장부에는 불확실 호출에 대한 보수적 예약액만 기록돼 실제 청구액으로 해석할 수 없다.',
              f"- 해당 요청의 보수적 예약액: ${ledger[0]['accounted_usd']:.4f}; HTTP 상태 {ledger[0]['http_status']}.",
              '- 현재로서는 뉴스 점수를 실서비스 선정에 추가하지 않고, 기사 대상·상태의 정확도 검증과 실제 거래 시점에 저장되는 기사 자료를 확보하는 것이 다음 단계다.']
    (OUT/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('Report:',OUT/'report.md',flush=True)


if __name__=='__main__':
    run()

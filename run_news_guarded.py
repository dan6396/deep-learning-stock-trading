"""Replay a fixed, conservative news overlay on the prior three regime blocks.

Reads cached historical news labels only. This is an exploratory comparison on
previously inspected dates, not a fresh out-of-sample test or PIT news archive.
"""
from __future__ import annotations

from pathlib import Path
import hashlib
import json

import numpy as np
import pandas as pd

from news_fusion.efficient import features_for
from news_fusion.guarded import AGE_STRENGTH, EVENT_STRENGTH, MAX_NEWS_RETURN, overlay, select_top5
from news_fusion.news import now, save_json
from portfolio_replay import simulate


SOURCE = Path('outputs/news_regimes_calendar3_bounded')
OUT = Path('outputs/news_guarded_calendar3_v2')
BARS = Path('../../outputs/validation_report/inputs/daily_bars.parquet')
MARKET = Path('../execution_study/KPI200.parquet')
HURDLE = .0025  # .125% sell + .125% buy on a replacement


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def freeze_protocol(out):
    old = read(SOURCE/'protocol.json')
    files = [SOURCE/name for name in ['protocol.json', 'candidate_plan.parquet',
              'article_requests.json', 'body_audit.json', 'discovered_articles.json',
              'extractions.json', 'rejected_extractions.json']]
    files += [BARS, MARKET, Path('news_fusion/guarded.py'), Path('run_news_guarded.py')]
    record = {
        'version': 'news-guarded-calendar3-v2',
        'created_at': now(),
        'source': str(SOURCE),
        'selected_entry_dates': old['selected_entry_dates'],
        'selected_blocks': old['selected_blocks'],
        'input_sha256': {str(path): sha(path) for path in files},
        'candidate_policy': 'Existing price top20 + independent headline top10, up to two article bodies per candidate; full price universe gets zero news delta outside requested pool',
        'news_policy': 'Direct company event with positive or negative full-body label only; specified event strengths, 1-3 prior calendar day age factors, exact headline repeat proxy, known later body revisions excluded',
        'event_strength': EVENT_STRENGTH,
        'age_strength': AGE_STRENGTH,
        'news_return_cap': MAX_NEWS_RETURN,
        'replacement_hurdle': HURDLE,
        'transaction_cost_per_side': .00125,
        'capital_per_block': 10_000_000,
        'strategies': ['price_top5', 'news_top5', 'price_cost_aware', 'news_cost_aware'],
        'design_status': 'Fixed before this replay; numeric choices are heuristics, not estimated on a news training set',
        'interpretation': 'Previously inspected exploratory dates and retrospective article bodies; cannot establish out-of-sample improvement or point-in-time availability',
    }
    dest = out/'protocol.json'
    if dest.exists():
        saved = read(dest)
        record['created_at'] = saved['created_at']
        if saved != record:
            raise ValueError('Frozen protocol or input files changed; choose a new output directory')
    else:
        save_json(dest, record)
    return record


def run(out=OUT):
    out.mkdir(parents=True, exist_ok=True)
    protocol = freeze_protocol(out)
    plan = pd.read_parquet(SOURCE/'candidate_plan.parquet')
    features = features_for(plan, read(SOURCE/'article_requests.json'),
                            read(SOURCE/'body_audit.json'), read(SOURCE/'extractions.json'),
                            'union', 2, mode='calendar_lookback')
    panel = overlay(features, read(SOURCE/'body_audit.json'),
                    read(SOURCE/'discovered_articles.json'))
    panel.to_parquet(out/'scored_panel.parquet', index=False)
    bars = pd.read_parquet(BARS)
    bars['ticker'] = bars.ticker.astype(str).str.zfill(6)
    market = pd.read_parquet(MARKET)
    metrics, days_all, selections, trades_all = [], [], [], []
    for regime, block in protocol['selected_blocks'].items():
        dates = set(protocol['selected_entry_dates'][regime])
        group = panel[panel.entry_date.dt.strftime('%Y-%m-%d').isin(dates)].copy()
        for strategy, column, hurdle in [
            ('price_top5', 'huber_ensemble', 0.),
            ('news_top5', 'adjusted_score', 0.),
            ('price_cost_aware', 'huber_ensemble', HURDLE),
            ('news_cost_aware', 'adjusted_score', HURDLE),
        ]:
            selected = select_top5(group, column, hurdle)
            signals = selected[['date', 'entry_date', 'ticker', column]].rename(columns={column: 'huber_ensemble'})
            result, daily, orders, holdings = simulate(signals, bars, capital=10_000_000, cost=.00125)
            changes = daily.net_pnl/daily.start_equity
            deviation = changes.std(ddof=1)
            result.update(regime=regime, block=block['block'], start=block['start'], end=block['end'],
                          market_return=block['market_return'], strategy=strategy,
                          sharpe_annualized=float(changes.mean()/deviation*np.sqrt(252)) if deviation > 0 else np.nan,
                          selected_with_accepted_news=int(selected.accepted_articles.gt(0).sum()),
                          selected_news_delta_sum=float(selected.news_delta.sum()),
                          selected_news_delta_abs_sum=float(selected.news_delta.abs().sum()),
                          forced_exits=int(selected.groupby('entry_date').forced_exits.first().sum()),
                          hurdle_swaps=int(selected.groupby('entry_date').hurdle_swaps.first().sum()))
            metrics.append(result)
            daily['regime'] = regime; daily['strategy'] = strategy; days_all.append(daily)
            selected['regime'] = regime; selected['strategy'] = strategy; selections.append(selected)
            orders['regime'] = regime; orders['strategy'] = strategy; trades_all.append(orders)
            holdings.to_parquet(out/f'{regime}_{strategy}_holdings.parquet', index=False)
    metrics = pd.DataFrame(metrics)
    daily = pd.concat(days_all, ignore_index=True)
    selected = pd.concat(selections, ignore_index=True)
    orders = pd.concat(trades_all, ignore_index=True)
    metrics.to_csv(out/'metrics.csv', index=False, encoding='utf-8-sig')
    daily.to_csv(out/'daily.csv', index=False, encoding='utf-8-sig')
    selected.to_parquet(out/'selections.parquet', index=False)
    orders.to_parquet(out/'orders.parquet', index=False)
    audit = verify(panel, metrics, selected, protocol)
    save_json(out/'verification.json', audit)
    predictive = prediction_diagnostics(panel, bars, protocol)
    predictive.to_csv(out/'predictive_metrics.csv', index=False, encoding='utf-8-sig')
    report(out, panel, metrics, daily, selected, market, protocol, audit, predictive)
    print(metrics[['regime', 'strategy', 'final_equity', 'net_return', 'mdd', 'total_fees', 'buy_orders', 'selected_with_accepted_news']].to_string(index=False))


def verify(panel, metrics, selected, protocol):
    previous = pd.read_csv(SOURCE/'metrics.csv').set_index(['regime', 'strategy'])
    max_error = 0.
    changes = []
    for regime, dates in protocol['selected_entry_dates'].items():
        pair = metrics[(metrics.regime == regime)&(metrics.strategy == 'price_top5')].iloc[0]
        original = previous.loc[(regime, 'price_only')]
        for key in ['final_equity', 'net_return', 'mdd', 'total_fees']:
            max_error = max(max_error, abs(float(pair[key])-float(original[key])))
        for date in dates:
            entry = pd.Timestamp(date)
            sub = selected[(selected.regime == regime)&(selected.entry_date == entry)]
            if len(sub) != 20 or sub.groupby('strategy').ticker.nunique().ne(5).any():
                raise AssertionError('Incomplete five-stock selection')
            price = set(sub[sub.strategy == 'price_cost_aware'].ticker)
            news = set(sub[sub.strategy == 'news_cost_aware'].ticker)
            changes.append(len(price.symmetric_difference(news))//2)
    if max_error >= 1e-6:
        raise AssertionError(f'Price baseline changed: {max_error}')
    if metrics.independent_ledger_max_error.max() >= 1e-6:
        raise AssertionError('Portfolio ledger did not reconcile')
    if panel.news_delta.abs().max() > MAX_NEWS_RETURN+1e-12:
        raise AssertionError('News delta exceeded cap')
    return {'baseline_max_absolute_error': max_error,
            'ledger_max_error': float(metrics.independent_ledger_max_error.max()),
            'stock_days': len(panel), 'usable_label_stock_days': int(panel.usable_articles.gt(0).sum()),
            'accepted_event_stock_days': int(panel.accepted_articles.gt(0).sum()),
            'changed_positions_cost_aware_across_30_days': int(sum(changes)),
            'max_abs_news_delta': float(panel.news_delta.abs().max()),
            'no_new_api_calls': True}


def prediction_diagnostics(panel, bars, protocol):
    matched = panel.merge(bars[['date', 'ticker', 'Open', 'Close']],
                          left_on=['entry_date', 'ticker'], right_on=['date', 'ticker'],
                          validate='one_to_one')
    if len(matched) != len(panel) or (matched.Open <= 0).any():
        raise AssertionError('Missing or invalid realized open-close observations')
    matched['actual_oc'] = matched.Close/matched.Open-1
    rows = []
    for regime, dates in protocol['selected_entry_dates'].items():
        group = matched[matched.entry_date.dt.strftime('%Y-%m-%d').isin(dates)]
        for strategy, column in [('price', 'huber_ensemble'), ('news_overlay', 'adjusted_score')]:
            daily_ic = group.groupby('entry_date').apply(
                lambda d: d[column].corr(d.actual_oc, method='spearman'), include_groups=False)
            rows.append({'regime': regime, 'strategy': strategy,
                         'mean_daily_rank_ic': float(daily_ic.mean()),
                         'direction_accuracy': float((np.sign(group[column]) == np.sign(group.actual_oc)).mean()),
                         'observations': len(group), 'trading_days': len(daily_ic)})
    return pd.DataFrame(rows)


def report(out, panel, metrics, daily, selected, market, protocol, audit, predictive):
    import matplotlib.pyplot as plt

    plt.rcParams['font.family'] = 'Malgun Gothic'
    plt.rcParams['axes.unicode_minus'] = False
    labels = {'price_top5': '가격 단독 · 매일 Top-5',
              'news_top5': '뉴스 보정 · 매일 Top-5',
              'price_cost_aware': '가격 단독 · 비용 기준 교체',
              'news_cost_aware': '뉴스 보정 · 비용 기준 교체'}
    colors = {'price_top5': '#2357A4', 'news_top5': '#6E9ED2',
              'price_cost_aware': '#3D7C56', 'news_cost_aware': '#D36A27'}
    korean = {'sideways': '횡보', 'down': '하락', 'up': '상승'}
    fig, axes = plt.subplots(1, 3, figsize=(16, 4.8), sharey=True)
    for ax, (regime, block) in zip(axes, protocol['selected_blocks'].items()):
        dates = protocol['selected_entry_dates'][regime]
        previous_close = float(market.loc[market.index < pd.Timestamp(dates[0]), 'Close'].iloc[-1])
        index_values = [10*float(market.loc[pd.Timestamp(date), 'Close'])/previous_close for date in dates]
        ax.plot(range(1, 11), index_values, label='KOSPI200 기준', color='#777777', lw=1.6, ls='--')
        for strategy in labels:
            line = daily[(daily.regime == regime)&(daily.strategy == strategy)].sort_values('date')
            ax.plot(range(1, 11), line.end_equity/1e6, label=labels[strategy], color=colors[strategy], lw=2)
        ax.axhline(10, color='#AAAAAA', lw=.8)
        ax.set_title(f"{korean[regime]} · {block['start']}~{block['end']}\n지수 {block['market_return']:+.1%}")
        ax.set_xlabel('구간 내 거래일')
        ax.grid(alpha=.18)
    axes[0].set_ylabel('평가자산 (백만 원)')
    handles, legend_labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, legend_labels, loc='lower center', ncol=5, frameon=False)
    fig.suptitle('각 구간 1,000만 원 · 같은 Top-5 투자 엔진 및 비용', fontsize=13)
    fig.tight_layout(rect=[0, .08, 1, .94])
    fig.savefig(out/'equity_comparison.png', dpi=170, bbox_inches='tight')
    plt.close(fig)

    lines = ['# 가격 단독과 근거 제한 뉴스 보정: 세 국면 재검증', '',
             '기존 평가 기간에서 수집·분석했던 뉴스를 재사용한 **탐색적 비교**입니다. 추가 유료 API 호출은 없습니다. 뉴스 최대 보정폭 10bp와 교체 기준 25bp는 이 재검증 전에 고정했습니다. 25bp는 편도 비용 12.5bp × 매도·매수 두 거래입니다. 기사 본문이 과거 시점에 같았는지는 확인되지 않았습니다.', '',
             '| 구간 | 시장 지수 | 가격 Top-5 | 뉴스 Top-5 | 가격 비용기준 | 뉴스 비용기준 | 비용기준 뉴스-가격 |',
             '|---|---:|---:|---:|---:|---:|---:|']
    for regime, block in protocol['selected_blocks'].items():
        m = metrics[metrics.regime == regime].set_index('strategy')
        values = [m.loc[key, 'final_equity'] for key in labels]
        lines.append(f"| {korean[regime]} {block['start']}~{block['end']} | {block['market_return']:+.2%} | {values[0]:,.0f}원 | {values[1]:,.0f}원 | {values[2]:,.0f}원 | {values[3]:,.0f}원 | {values[3]-values[2]:+,.0f}원 |")
    lines += ['', '![국면별 평가자산](equity_comparison.png)', '',
              '## 교체 비용 및 위험', '',
              '| 구간 | 전략 | 수익률 | MDD | 거래비용 | 매수 건수 | 뉴스 근거가 있는 선정 건수 |',
              '|---|---|---:|---:|---:|---:|---:|']
    for regime in protocol['selected_blocks']:
        for strategy in labels:
            m = metrics[(metrics.regime == regime)&(metrics.strategy == strategy)].iloc[0]
            lines.append(f"| {korean[regime]} | {labels[strategy]} | {m.net_return:+.2%} | {m.mdd:.2%} | {m.total_fees:,.0f}원 | {m.buy_orders} | {m.selected_with_accepted_news} |")
    lines += ['', '## 예측력 진단', '',
              '전체 종목·일을 같은 실제 시가→종가 수익률에 맞춰 비교했습니다. Rank IC는 매일 종목 간 Spearman 상관의 평균입니다.', '',
              '| 구간 | 가격 Rank IC | 뉴스 보정 Rank IC | 가격 방향정확도 | 뉴스 보정 방향정확도 |',
              '|---|---:|---:|---:|---:|']
    for regime in protocol['selected_blocks']:
        p = predictive[(predictive.regime == regime)&(predictive.strategy == 'price')].iloc[0]
        n = predictive[(predictive.regime == regime)&(predictive.strategy == 'news_overlay')].iloc[0]
        lines.append(f'| {korean[regime]} | {p.mean_daily_rank_ic:.4f} | {n.mean_daily_rank_ic:.4f} | {p.direction_accuracy:.2%} | {n.direction_accuracy:.2%} |')
    lines += ['', '## 적용한 규칙', '',
              '- 가격 예측값은 기존 Huber Ensemble의 다음 거래일 시가→종가 예상 수익률입니다. 뉴스는 이를 최대 ±0.10%p만 수정합니다.',
              '- 최근 3개 달력일 기사 중 종목 직접 관련, 구체적 기업 사건, 긍정·부정 근거가 있는 본문만 사용합니다. 오래된 기사는 점수를 줄이고, 동일 제목의 반복과 매매 시점 이후 수정이 확인된 본문은 배제합니다.',
              '- 뉴스가 없거나 근거가 부족하면 보정값은 0입니다. 동일한 가격·뉴스 점수를 매일 Top-5 또는 왕복 비용을 넘을 때만 교체하는 규칙으로 각각 평가했습니다.',
              '- 각 구간마다 1,000만 원에서 시작하며 동일한 보유·교체 투자 엔진과 편도 0.125% 거래비용을 적용합니다.', '',
              '## 검증 범위', '',
              f"- 기존 가격 단독 결과 재현 최대 오차: {audit['baseline_max_absolute_error']:.9f}원; 거래 장부 최대 오차: {audit['ledger_max_error']:.9f}원.",
              f"- 후보 {audit['stock_days']:,} 종목·일 중 유효 뉴스 분류 {audit['usable_label_stock_days']:,}건, 보정 규칙을 통과한 사건 {audit['accepted_event_stock_days']:,}건. 비용기준 전략끼리 다른 보유 종목은 전체 30일에 걸쳐 {audit['changed_positions_cost_aware_across_30_days']}자리.",
              '- 본문 기사 수집과 시장 국면 선택은 이미 결과를 본 평가 기간에서 이뤄졌습니다. RSS 검색은 누락될 수 있고, 언론사 본문은 사후 수정될 수 있습니다. 알려진 사후 수정만 제외했으며 과거 원문을 증명하지는 못합니다.',
              '- 뉴스 보정폭과 사건별 강도는 별도의 훈련 데이터로 학습한 값이 아닙니다. 전체 종목의 Rank IC가 분명히 개선되었다고 볼 수 없습니다. 따라서 이 결과는 제품/논문 수준의 뉴스 알파 입증이 아니며, 새 시점의 사전 고정 평가가 필요합니다.']
    (out/'report.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')


if __name__ == '__main__':
    run()

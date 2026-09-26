"""Exploratory expanding-window fusion on cached news and price predictions.

The first 10 trading days train the fusion; each later day is predicted using
only prior realized open-to-close labels. The full 30-day period was previously
inspected, so this is NOT an independent out-of-sample claim.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from news_fusion.guarded import AGE_STRENGTH, EVENT_STRENGTH, select_top5
from news_fusion.news import now, save_json
from portfolio_replay import simulate


SOURCE = Path('outputs/news_guarded_calendar3_v2')
OUT = Path('outputs/news_walkforward_v1')
BARS = Path('../../outputs/validation_report/inputs/daily_bars.parquet')
WARMUP_DAYS = 10
RIDGE_ALPHA = 100.0
NEWS_COLUMNS = [f'{event}_{direction}' for event in EVENT_STRENGTH for direction in ['positive', 'negative']]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def freeze(out):
    paths = [SOURCE/'scored_panel.parquet', SOURCE/'protocol.json', BARS, Path(__file__)]
    record = {'version': 'news-walkforward-v1', 'created_at': now(),
              'source_hashes': {str(path): sha(path) for path in paths},
              'warmup_trading_days': WARMUP_DAYS,
              'ridge_alpha': RIDGE_ALPHA,
              'tree': {'max_iter': 100, 'learning_rate': .05, 'max_leaf_nodes': 8,
                       'min_samples_leaf': 100, 'l2_regularization': 10., 'random_state': 42},
              'target': 'daily cross-sectional centered next-session open-to-close return',
              'features': {'price': 'daily centered fixed Huber forecast', 'news': NEWS_COLUMNS},
              'strategies': ['huber', 'price_ridge', 'news_ridge', 'news_tree'],
              'portfolio': 'KRW 10m reset at each 10-day evaluation block; Top5; same portfolio_replay, .125% per side',
              'status': 'exploratory: news article versions not point-in-time verified; all 30 dates previously inspected'}
    destination = out/'protocol.json'
    if destination.exists():
        old = json.loads(destination.read_text(encoding='utf-8'))
        record['created_at'] = old['created_at']
        if old != record:
            raise ValueError('Protocol or source changed; use a new output directory')
    else:
        save_json(destination, record)
    return record


def feature_panel(panel, bars):
    frame = panel[['date', 'entry_date', 'ticker', 'huber_ensemble', 'audited_evidence']].copy()
    frame['price_centered'] = frame.huber_ensemble - frame.groupby('entry_date').huber_ensemble.transform('mean')
    for name in NEWS_COLUMNS:
        frame[name] = 0.
    for idx, value in frame.audited_evidence.items():
        for event in json.loads(value):
            if event['gate'] != 'accepted':
                continue
            name = f"{event['event_type']}_{event['sentiment']}"
            frame.at[idx, name] += AGE_STRENGTH[event['age_calendar_days']]
    # Multiple accounts of the same event should not multiply a feature without bound.
    frame[NEWS_COLUMNS] = frame[NEWS_COLUMNS].clip(upper=2.)
    real = bars[['date', 'ticker', 'Open', 'Close']].copy()
    frame = frame.merge(real, left_on=['entry_date', 'ticker'], right_on=['date', 'ticker'],
                        validate='one_to_one')
    frame = frame.rename(columns={'date_x': 'date'}).drop(columns='date_y')
    if len(frame) != len(panel) or (frame.Open <= 0).any():
        raise ValueError('Missing or invalid open-close labels')
    frame['actual_oc'] = frame.Close/frame.Open-1
    frame['target'] = frame.actual_oc-frame.groupby('entry_date').actual_oc.transform('mean')
    return frame


def walkforward(frame, protocol):
    dates = sorted(frame.entry_date.unique())
    if len(dates) != 30:
        raise ValueError('Expected the frozen 30 trading days')
    tree_args = protocol['tree']
    predictions = []
    fits = []
    for date in dates[WARMUP_DAYS:]:
        train = frame[frame.entry_date < date]
        test = frame[frame.entry_date == date].copy()
        if train.entry_date.nunique() < WARMUP_DAYS or test.empty or train.entry_date.max() >= date:
            raise AssertionError('Chronological fit violation')
        x_price = ['price_centered']
        x_news = x_price+NEWS_COLUMNS
        y = train.target.to_numpy(float)
        price_model = make_pipeline(StandardScaler(), Ridge(alpha=RIDGE_ALPHA)).fit(train[x_price], y)
        news_model = make_pipeline(StandardScaler(), Ridge(alpha=RIDGE_ALPHA)).fit(train[x_news], y)
        tree_model = HistGradientBoostingRegressor(**tree_args).fit(train[x_news], y)
        test['huber'] = test.huber_ensemble
        test['price_ridge'] = price_model.predict(test[x_price])
        test['news_ridge'] = news_model.predict(test[x_news])
        test['news_tree'] = tree_model.predict(test[x_news])
        if not np.isfinite(test[['huber', 'price_ridge', 'news_ridge', 'news_tree']]).all().all():
            raise ValueError('Nonfinite forecast')
        predictions.append(test)
        fits.append({'forecast_date': str(pd.Timestamp(date).date()),
                     'last_training_date': str(pd.Timestamp(train.entry_date.max()).date()),
                     'train_days': int(train.entry_date.nunique()),
                     'price_coefficient': float(price_model[-1].coef_[0]),
                     'news_coefficients': dict(zip(x_news, map(float, news_model[-1].coef_)))})
    return pd.concat(predictions, ignore_index=True), fits


def evaluate(out, forecast, bars, protocol):
    old = json.loads((SOURCE/'protocol.json').read_text(encoding='utf-8'))
    metrics, daily_all, selections = [], [], []
    for regime in ['down', 'up']:
        dates = set(old['selected_entry_dates'][regime])
        group = forecast[forecast.entry_date.dt.strftime('%Y-%m-%d').isin(dates)]
        if group.entry_date.nunique() != 10:
            raise ValueError('Missing evaluation block')
        for strategy in protocol['strategies']:
            daily_ic = group.groupby('entry_date').apply(
                lambda g: g[strategy].corr(g.actual_oc, method='spearman'), include_groups=False)
            for turnover, hurdle in [('top5', 0.), ('cost_aware', .0025)]:
                chosen = select_top5(group, strategy, hurdle)
                signal = chosen[['date', 'entry_date', 'ticker', strategy]].rename(columns={strategy: 'huber_ensemble'})
                result, days, trades, _ = simulate(signal, bars)
                result.update(regime=regime, strategy=strategy, turnover=turnover,
                              mean_daily_rank_ic=float(daily_ic.mean()),
                              top5_mean_gross_oc=float(chosen.actual_oc.mean()),
                              selected_news_feature_stock_days=int(chosen[NEWS_COLUMNS].gt(0).any(axis=1).sum()))
                metrics.append(result)
                days['regime'] = regime; days['strategy'] = strategy; days['turnover'] = turnover
                daily_all.append(days)
                chosen['regime'] = regime; chosen['strategy'] = strategy; chosen['turnover'] = turnover
                selections.append(chosen)
    results = pd.DataFrame(metrics)
    results.to_csv(out/'metrics.csv', index=False, encoding='utf-8-sig')
    pd.concat(daily_all).to_csv(out/'daily.csv', index=False, encoding='utf-8-sig')
    pd.concat(selections).to_parquet(out/'selections.parquet', index=False)
    return results


def run(out=OUT):
    out.mkdir(parents=True, exist_ok=True)
    protocol = freeze(out)
    bars = pd.read_parquet(BARS)
    bars['ticker'] = bars.ticker.astype(str).str.zfill(6)
    panel = pd.read_parquet(SOURCE/'scored_panel.parquet')
    frame = feature_panel(panel, bars)
    forecast, fits = walkforward(frame, protocol)
    forecast.to_parquet(out/'forecasts.parquet', index=False)
    save_json(out/'fit_history.json', fits)
    result = evaluate(out, forecast, bars, protocol)
    print(result[['regime', 'strategy', 'turnover', 'mean_daily_rank_ic', 'final_equity', 'mdd', 'total_fees']].to_string(index=False))


if __name__ == '__main__':
    run()

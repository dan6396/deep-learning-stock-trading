"""Small, chronological news rank-error models. Research only; scores are not returns."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack, issparse
from sklearn.linear_model import Ridge

ALPHAS = (1., 10., 100.)
WEIGHTS = (.25, .5, 1.)
MIN_VALIDATION_GAIN = .005


def ranks(values, dates):
    return pd.Series(values).groupby(np.asarray(dates)).rank(pct=True).to_numpy()


def mean_ic(values, target, dates):
    a = pd.DataFrame({'s': values, 'y': target, 'd': np.asarray(dates)})
    return float(a.groupby('d').apply(lambda g: g.s.corr(g.y, method='spearman'),
                                     include_groups=False).mean())


def context_features(matrix, price_rank):
    """Allow the same news to have different effects at low/high price-model ranks."""
    x = csr_matrix(matrix)
    return hstack([x, x.multiply((np.asarray(price_rank)-.5)[:, None])], format='csr')


def residual_predict(matrix, target_residual, train_idx, test_idx, alpha):
    # No intercept: no usable news produces exactly zero correction.
    model = Ridge(alpha=alpha, fit_intercept=False, solver='lsqr', tol=1e-5)
    model.fit(matrix[train_idx], np.asarray(target_residual)[train_idx])
    return np.clip(model.predict(matrix[test_idx]), -1., 1.)


def forecast_day(frame, matrices, date):
    """Choose only on the last five PAST dates, then refit on all past dates."""
    dates = sorted(frame.entry_date.unique())
    past_dates = [d for d in dates if d < date]
    if len(past_dates) < 10:
        raise ValueError('At least ten prior dates required')
    cutoff = past_dates[-5]
    fit = np.flatnonzero((frame.entry_date < cutoff).to_numpy())
    valid = np.flatnonzero(((frame.entry_date >= cutoff) & (frame.entry_date < date)).to_numpy())
    train = np.flatnonzero((frame.entry_date < date).to_numpy())
    test = np.flatnonzero((frame.entry_date == date).to_numpy())
    assert frame.entry_date.iloc[fit].max() < frame.entry_date.iloc[valid].min()
    assert frame.entry_date.iloc[train].max() < frame.entry_date.iloc[test].min()
    price = frame.price_rank.to_numpy()
    # Read labels only for training and validation indices. Test labels are never used.
    residual = np.zeros(len(frame), dtype=float)
    residual[train] = frame.target_rank.to_numpy()[train] - price[train]
    valid_y = frame.target_rank.to_numpy()[valid]
    valid_dates = frame.entry_date.to_numpy()[valid]
    baseline_ic = mean_ic(price[valid], valid_y, valid_dates)
    output = frame.iloc[test][['date', 'entry_date', 'ticker', 'huber_ensemble', 'price_rank']].copy()
    choices = []
    pool = (baseline_ic + MIN_VALIDATION_GAIN, 'price_rank', 0., 0.)
    for name, matrix in matrices.items():
        best = (baseline_ic + MIN_VALIDATION_GAIN, 0., 0.)
        for alpha in ALPHAS:
            correction = residual_predict(matrix, residual, fit, valid, alpha)
            for weight in WEIGHTS:
                ic = mean_ic(price[valid] + weight*correction, valid_y, valid_dates)
                if np.isfinite(ic) and ic > best[0]:
                    best = (ic, alpha, weight)
        fixed = residual_predict(matrix, residual, train, test, 10.)
        output[name+'_fixed'] = price[test] + .25*fixed
        if best[2]:
            correction = residual_predict(matrix, residual, train, test, best[1])
            output[name+'_adaptive'] = price[test] + best[2]*correction
        else:
            output[name+'_adaptive'] = price[test]
        choices.append({'forecast_date': str(pd.Timestamp(date).date()), 'branch': name,
                        'fit_last_date': str(pd.Timestamp(frame.entry_date.iloc[fit].max()).date()),
                        'validation_first': str(pd.Timestamp(cutoff).date()),
                        'refit_last_date': str(pd.Timestamp(past_dates[-1]).date()),
                        'baseline_validation_ic': baseline_ic,
                        'chosen_validation_ic': best[0] if best[2] else baseline_ic,
                        'alpha': best[1], 'weight': best[2]})
        # Coverage is a diagnostic, never an eligible "news content" winner.
        if name != 'coverage' and best[2] and best[0] > pool[0]:
            pool = (best[0], name+'_adaptive', best[1], best[2])
    output['selected_news'] = output[pool[1]]
    choices.append({'forecast_date': str(pd.Timestamp(date).date()), 'branch': 'selected_news',
                    'selected': pool[1], 'alpha': pool[2], 'weight': pool[3]})
    return output, choices

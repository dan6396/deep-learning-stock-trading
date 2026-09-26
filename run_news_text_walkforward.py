"""Exploratory title-text fusion without API sentiment labels.

Vectorizer and ridge are refit only on prior dates. This is a deliberately
small-data diagnostic, not evidence of deployable news alpha.
"""
from __future__ import annotations

from pathlib import Path
import hashlib
import json

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import Ridge

from news_fusion.news import now, save_json
from run_news_walkforward import BARS, SOURCE, feature_panel, evaluate


OUT = Path('outputs/news_title_walkforward_v1')
OLD = Path('outputs/news_regimes_calendar3_bounded')
ALPHAS = [10.0, 100.0]  # both reported; neither chosen on evaluation outcomes


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def add_titles(frame):
    headlines = {article['article_id']: article['title'] for article in read(OLD/'selected_headlines.json')}
    by_stock_day = {}
    for request in read(OLD/'article_requests.json'):
        key = (request['entry_date'], request['ticker'])
        title = headlines.get(request['parent_article_id'])
        if title:
            by_stock_day.setdefault(key, []).append(title)
    result = frame.copy()
    result['title_text'] = [' '.join(dict.fromkeys(by_stock_day.get((str(d.date()), t), [])))
                            for d, t in zip(result.entry_date, result.ticker)]
    return result


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    sources = [SOURCE/'scored_panel.parquet', OLD/'selected_headlines.json',
               OLD/'article_requests.json', BARS, Path(__file__)]
    protocol = {'version':'title-tfidf-walkforward-v1', 'created_at':now(),
                'source_sha256': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
                'first_training_days':10, 'alphas':ALPHAS,
                'vectorizer':{'analyzer':'char','ngram_range':[2,4],'min_df':2,'max_features':3000},
                'status':'exploratory; retrospective RSS titles and previously inspected dates'}
    p = OUT/'protocol.json'
    if p.exists():
        old = read(p); protocol['created_at'] = old['created_at']
        if old != protocol:
            raise ValueError('Frozen protocol or inputs changed')
    else:
        save_json(p, protocol)
    bars = pd.read_parquet(BARS)
    bars['ticker'] = bars.ticker.astype(str).str.zfill(6)
    frame = feature_panel(pd.read_parquet(SOURCE/'scored_panel.parquet'), bars)
    frame = add_titles(frame)
    dates = sorted(frame.entry_date.unique())
    if len(dates) != 30:
        raise ValueError('Expected 30 dates')
    forecasts = []
    coverage = []
    for date in dates[10:]:
        train = frame[frame.entry_date < date]
        test = frame[frame.entry_date == date].copy()
        vectorizer = TfidfVectorizer(analyzer='char', ngram_range=(2,4), min_df=2,
                                     max_features=3000, sublinear_tf=True)
        train_title = vectorizer.fit_transform(train.title_text)
        test_title = vectorizer.transform(test.title_text)
        mean = float(train.price_centered.mean())
        std = max(float(train.price_centered.std(ddof=0)),1e-8)
        price_train = csr_matrix(((train.price_centered-mean)/std).to_numpy()[:,None])
        price_test = csr_matrix(((test.price_centered-mean)/std).to_numpy()[:,None])
        train_x = hstack([price_train, train_title], format='csr')
        test_x = hstack([price_test, test_title], format='csr')
        test['huber'] = test.huber_ensemble
        # Same regression target and chronological window as the labeled-news model.
        baseline = Ridge(alpha=100., solver='lsqr').fit(price_train, train.target)
        test['price_ridge'] = baseline.predict(price_test)
        for alpha in ALPHAS:
            model = Ridge(alpha=alpha, solver='lsqr').fit(train_x, train.target)
            test[f'title_ridge_a{int(alpha)}'] = model.predict(test_x)
        forecasts.append(test)
        coverage.append({'forecast_date':str(pd.Timestamp(date).date()),
                         'last_training_date':str(pd.Timestamp(train.entry_date.max()).date()),
                         'training_title_stock_days':int(train.title_text.ne('').sum()),
                         'test_title_stock_days':int(test.title_text.ne('').sum()),
                         'vocabulary_size':len(vectorizer.vocabulary_)})
    predictions = pd.concat(forecasts, ignore_index=True)
    predictions.to_parquet(OUT/'forecasts.parquet', index=False)
    save_json(OUT/'coverage.json', coverage)
    eval_protocol = {'strategies':['huber','price_ridge']+[f'title_ridge_a{int(a)}' for a in ALPHAS]}
    metrics = evaluate(OUT, predictions, bars, eval_protocol)
    print(metrics[['regime','strategy','turnover','mean_daily_rank_ic','final_equity','total_fees']].to_string(index=False),flush=True)


if __name__ == '__main__':
    run()

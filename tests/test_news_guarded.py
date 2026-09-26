import json
import unittest

import pandas as pd

from news_fusion.guarded import MAX_NEWS_RETURN, overlay, select_top5


class GuardedNewsTests(unittest.TestCase):
    def test_direct_event_is_bounded_and_absence_is_zero(self):
        day = pd.Timestamp('2026-06-05')
        article = {'article_id': 'body1', 'ticker': '000001', 'published_at': '2026-06-04T10:00:00+09:00',
                   'modified_at': None, 'title': '기업 실적 발표'}
        body = {'status': 'body_extracted', 'title': article['title'], 'article': article}
        evidence = {'article_id': 'body1', 'title': article['title'], 'sentiment': 'positive',
                    'relevance': 'direct', 'event_type': 'earnings'}
        features = pd.DataFrame([
            {'entry_date': day, 'ticker': '000001', 'decision_at': '2026-06-05T08:30:00+09:00',
             'huber_ensemble': .001, 'evidence': json.dumps([evidence])},
            {'entry_date': day, 'ticker': '000002', 'decision_at': '2026-06-05T08:30:00+09:00',
             'huber_ensemble': .002, 'evidence': '[]'},
        ])
        result = overlay(features, [body], [article]).set_index('ticker')
        self.assertAlmostEqual(result.loc['000001', 'news_delta'], MAX_NEWS_RETURN)
        self.assertEqual(result.loc['000002', 'news_delta'], 0)

    def test_known_later_revision_and_repeated_headline_are_excluded(self):
        article = {'article_id': 'body1', 'ticker': '000001', 'published_at': '2026-06-04T10:00:00+09:00',
                   'modified_at': '2026-09-01T10:00:00+09:00', 'title': '기업 실적 발표'}
        body = {'status': 'body_extracted', 'title': article['title'], 'article': article}
        evidence = {'article_id': 'body1', 'title': article['title'], 'sentiment': 'positive',
                    'relevance': 'direct', 'event_type': 'earnings'}
        feature = pd.DataFrame([{'entry_date': pd.Timestamp('2026-06-05'), 'ticker': '000001',
                    'decision_at': '2026-06-05T08:30:00+09:00', 'huber_ensemble': .001,
                    'evidence': json.dumps([evidence])}])
        result = overlay(feature, [body], [article])
        self.assertEqual(result.news_delta.iloc[0], 0)
        self.assertEqual(json.loads(result.audited_evidence.iloc[0])[0]['gate'], 'known_later_revision')
        article['modified_at'] = None
        earlier = {**article, 'published_at': '2026-06-03T11:00:00+09:00'}
        result = overlay(feature, [body], [earlier, article])
        self.assertEqual(result.news_delta.iloc[0], 0)
        self.assertEqual(json.loads(result.audited_evidence.iloc[0])[0]['gate'], 'repeated_exact_headline')

    def test_replacement_requires_net_predicted_gain(self):
        records = []
        for day in pd.to_datetime(['2026-06-01', '2026-06-02']):
            scores = {'A': .005, 'B': .004, 'C': .003, 'D': .002, 'E': .001, 'F': .0009}
            if day.day == 2:
                scores['F'] = .0034  # 24 bp better than held E: below the 25 bp hurdle
            for ticker, score in scores.items():
                records.append({'entry_date': day, 'ticker': ticker, 'score': score})
        panel = pd.DataFrame(records)
        selected = select_top5(panel, 'score', .0025)
        self.assertEqual(set(selected[selected.entry_date.dt.day == 2].ticker), set('ABCDE'))
        panel.loc[(panel.entry_date.dt.day == 2)&(panel.ticker == 'F'), 'score'] = .0036
        selected = select_top5(panel, 'score', .0025)
        self.assertEqual(set(selected[selected.entry_date.dt.day == 2].ticker), set('ABCDF'))


if __name__ == '__main__':
    unittest.main()

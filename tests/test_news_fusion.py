"""Leakage, attribution, replay and API budget checks; synthetic data only."""
import unittest
from unittest.mock import patch
from tempfile import TemporaryDirectory
from pathlib import Path
import numpy as np
import pandas as pd
from news_fusion.news import eligible,deduplicate,collect_google_rss
from news_fusion.gemini import GeminiExtractor,validate_result
from news_fusion.fusion import build_features,score_and_select,fit_fusion,replay_selection,FEATURES

def article(**changes):
    a={'article_id':'a','ticker':'000001','company_name':'가상기업','title':'가상기업 공급계약 체결',
       'text':'가상기업 공급계약 체결','published_at':'2026-06-01T12:00:00+09:00',
       'retrieved_at':'2026-09-17T10:00:00+09:00','modified_at':None,'timestamp_quality':'verified'}
    return dict(a,**changes)

def result():return {'sentiment':'positive','relevance':'direct','event_type':'contract',
                    'evidence_quote':'공급계약 체결','reason':'계약 체결','insufficient_context':False}

def prices():
    return pd.DataFrame([{'date':pd.Timestamp('2026-06-01'),'entry_date':pd.Timestamp('2026-06-02'),
                          'ticker':str(i).zfill(6),'huber_ensemble':float(10-i)/100} for i in range(1,11)])

class Tests(unittest.TestCase):
    def test_historical_search_not_pit(self):
        self.assertFalse(eligible(article(),'2026-06-02 08:30',mode='strict'))
        self.assertTrue(eligible(article(),'2026-06-02 08:30',mode='exploratory'))

    def test_future_and_revised_news_excluded(self):
        self.assertFalse(eligible(article(published_at='2026-06-02T11:00:00+09:00'),'2026-06-02 08:30',mode='exploratory'))
        self.assertFalse(eligible(article(modified_at='2026-06-02T18:00:00+09:00'),'2026-06-02 08:30',mode='exploratory'))

    def test_unverified_time_delayed(self):
        a=article(published_at='2026-06-02T01:00:00+09:00',timestamp_quality='feed_time_unverified')
        self.assertFalse(eligible(a,'2026-06-02 08:30',mode='exploratory'))

    def test_duplicate_news_not_double_counted(self):
        self.assertEqual(len(deduplicate([article(),article(article_id='b')])),1)

    def test_no_news_is_not_negative(self):
        f=build_features(prices(),[],[])
        self.assertTrue(f.news_missing.eq(1).all());self.assertTrue(f.sentiment.eq(0).all())

    def test_unprocessed_not_neutral(self):
        f=build_features(prices(),[article()],[],mode='exploratory')
        self.assertEqual(int(f.unprocessed_articles.sum()),1)
        self.assertEqual(int(f.usable_articles.sum()),0)

    def test_identity_preserves_top5(self):
        f=build_features(prices(),[],[]);s=score_and_select(f)
        self.assertEqual(s[s.selected].ticker.tolist(),['000001','000002','000003','000004','000005'])

    def test_fusion_reorders_and_attributes(self):
        f=build_features(prices(),[],[],mode='exploratory');f.loc[f.ticker=='000010','sentiment']=10
        m={'format':'linear-news-fusion-v1','features':FEATURES,'available_after':'2026-05-31',
           'mean':[0]*5,'std':[1]*5,'coefficients':[1,1,0,0,0],'intercept':.2,'availability_mode':'exploratory'}
        s=score_and_select(f,m)
        self.assertEqual(s.iloc[0].ticker,'000010')
        np.testing.assert_allclose(s.final_score,s.price_contribution+s.news_contribution+.2)
        m['available_after']='2026-06-03'
        with self.assertRaises(ValueError):score_and_select(f,m)

    def test_fabricated_evidence_rejected(self):
        r=result();r['evidence_quote']='없는 문장'
        with self.assertRaises(ValueError):validate_result(r,article()['text'])

    def test_zero_budget_makes_no_call(self):
        with TemporaryDirectory() as tmp,patch('news_fusion.gemini.requests.post') as post:
            e=GeminiExtractor('test',tmp,max_calls=0)
            with self.assertRaises(RuntimeError):e.extract(article())
            post.assert_not_called()

    def test_quota_stop_and_no_key_logging(self):
        with TemporaryDirectory() as tmp,patch('news_fusion.gemini.requests.post') as post:
            post.return_value.status_code=429;e=GeminiExtractor('SENSITIVE_TEST',tmp,max_calls=5,interval=0)
            with self.assertRaises(RuntimeError):e.extract(article())
            with self.assertRaises(RuntimeError):e.extract(article())
            self.assertEqual(post.call_count,1)
            self.assertNotIn('SENSITIVE_TEST',''.join(p.read_text() for p in Path(tmp).glob('*')))

    def test_rss_outside_dates_removed(self):
        xml=b'<rss><channel><item><title>test</title><pubDate>Mon, 08 Jun 2026 07:00:00 GMT</pubDate><link>x</link></item></channel></rss>'
        with TemporaryDirectory() as tmp,patch('news_fusion.news.requests.get') as get:
            get.return_value.status_code=200;get.return_value.content=xml
            r=collect_google_rss('test','1','2026-06-01','2026-06-08',tmp)
            self.assertEqual(r['retained_count'],0);self.assertEqual(r['rejected_count'],1)

    def test_chronological_fit_and_oof_guard(self):
        rng=np.random.default_rng(42);rows=[]
        for date in pd.bdate_range('2025-01-01',periods=50):
            for ticker in range(10):
                price,news=rng.normal(size=2)
                rows.append(dict(date=date-pd.Timedelta(days=1),entry_date=date,ticker=str(ticker),
                    decision_at=str(date.date())+' 08:30',price_training_end='2024-12-01',
                    prediction_kind='walk_forward',label_available_at=str(date.date())+' 16:00',
                    price_z=price,sentiment=news,negative_share=float(news<0),news_volume=1.,news_missing=0.,
                    return_1=.01*price+.005*news,usable_articles=1,availability_mode='exploratory'))
        f=pd.DataFrame(rows);m=fit_fusion(f,'2025-02-04','2025-03-31')
        self.assertGreater(m['validation_rank_ic'],.9)
        f.loc[0,'price_training_end']='2025-03-01'
        with self.assertRaises(ValueError):fit_fusion(f,'2025-02-04','2025-03-31')

    def test_replay_retains_unchanged_positions(self):
        f=build_features(prices(),[],[]);s=score_and_select(f)
        second=s.copy();second['date']+=pd.Timedelta(days=1);second['entry_date']+=pd.Timedelta(days=1)
        s=pd.concat([s,second]);bars=pd.DataFrame([dict(date=d,ticker=t,Open=100,Close=100,Volume=1000)
            for d in s.entry_date.unique() for t in s.ticker.unique()])
        met,_,trades,_=replay_selection(s,bars)
        self.assertEqual(len(trades),10);self.assertEqual(met['buy_orders'],5)
        self.assertAlmostEqual(met['final_equity'],10_000_000*(1-.00125)/(1+.00125))

if __name__=='__main__':unittest.main()

"""Decision-time, independent candidate, bounded sampling and attribution tests."""
import unittest
from unittest.mock import patch
from tempfile import TemporaryDirectory
from pathlib import Path
import numpy as np
import pandas as pd
from news_fusion.news import digest, eligible
from news_fusion.news import save_json
from news_fusion.efficient import candidate_plan, features_for, representatives, score


def price_panel():
    return pd.DataFrame([{'date':pd.Timestamp('2026-05-29'),'entry_date':pd.Timestamp('2026-06-01'),
        'ticker':str(i).zfill(6),'huber_ensemble':-i*.001} for i in range(1,201)])


def article(**changes):
    a={'article_id':'headline','ticker':'000080','company_name':'가상회사','title':'가상회사 대규모 공급계약 체결',
        'text':'가상회사 대규모 공급계약 체결','published_at':'2026-05-31T10:00:00+09:00',
        'retrieved_at':'2026-09-25T10:00:00+09:00','timestamp_quality':'feed_time_unverified',
        'modified_at':None,'url':'https://example.com/a'}
    return dict(a,**changes)


class Tests(unittest.TestCase):
    def test_calendar_lookback_uses_publication_date_without_time_or_revision_gate(self):
        decision='2026-06-01T08:30:00+09:00'
        friday=article(published_at='2026-05-29T23:59:00+09:00',
                       modified_at='2026-06-02T12:00:00+09:00')
        self.assertTrue(eligible(friday,decision,mode='calendar_lookback'))
        self.assertFalse(eligible(friday,decision,mode='exploratory'))
        self.assertTrue(eligible(article(published_at='2026-05-31T23:59:59+09:00'),
                                 decision,mode='calendar_lookback'))
        self.assertFalse(eligible(article(published_at='2026-06-01T00:00:00+09:00'),
                                  decision,mode='calendar_lookback'))
        self.assertFalse(eligible(article(published_at='2026-05-28T23:59:59+09:00'),
                                  decision,mode='calendar_lookback'))

    def test_cost_cap_blocks_paid_call(self):
        from run_news_efficiency import analyze
        with TemporaryDirectory() as directory:
            out=Path(directory)
            a=article(article_id='body',parent_article_id='headline')
            save_json(out/'body_articles.json',[a])
            save_json(out/'article_requests.json',[{'parent_article_id':'headline','decision_at':'2026-06-01 08:30'}])
            with patch('run_news_efficiency.reusable',return_value=([],[])), \
                 patch('run_news_efficiency.load_openai_key',return_value='FAKE_SECRET'), \
                 patch('run_news_efficiency.BUDGET',0), \
                 patch('run_news_efficiency.requests.post') as post:
                with self.assertRaisesRegex(RuntimeError,'cap reached'):
                    analyze(out,out,'unused')
                post.assert_not_called()
            self.assertNotIn('FAKE_SECRET',''.join(p.read_text(encoding='utf-8') for p in out.glob('*.json')))

    def test_price_rank_80_can_enter_and_be_selected(self):
        plan, req, _=candidate_plan(price_panel(),[article()])
        row=plan[plan.ticker=='000080'].iloc[0]
        self.assertFalse(row.in_price_pool); self.assertTrue(row.in_news_pool)
        body=article(article_id='body',parent_article_id='headline',text_scope='publisher_body')
        label={'article_id':'body','input_sha256':digest(body['text']), 'result':{
            'insufficient_context':False,'relevance':'direct','sentiment':'positive','event_type':'contract',
            'evidence_quote':'공급계약 체결','reason':'계약'}}
        f=features_for(plan,req,[{'parent_article_id':'headline','status':'body_extracted','article':body}],[label],'union',1)
        s=score(f,.5)
        self.assertTrue(s.loc[s.ticker=='000080','selected'].item())
        np.testing.assert_allclose(s.final_score,s.price_contribution+s.news_contribution)
        self.assertEqual(int(s.selected.sum()),5)

    def test_news_selection_independent_of_price_scores(self):
        p=price_panel(); a=candidate_plan(p,[article()])[0]
        p.huber_ensemble=-p.huber_ensemble
        b=candidate_plan(p,[article()])[0]
        self.assertEqual(set(a[a.in_news_pool].ticker),set(b[b.in_news_pool].ticker))

    def test_future_news_cannot_enter_even_with_best_headline(self):
        plan,req,selected=candidate_plan(price_panel(),[article(published_at='2026-06-01T11:00:00+09:00')])
        self.assertFalse(plan.in_news_pool.any());self.assertEqual(req,[]);self.assertEqual(selected,[])

    def test_no_news_preserves_top5_and_marks_missing(self):
        plan,req,_=candidate_plan(price_panel(),[])
        f=features_for(plan,req,[],[],'union',2)
        for weight in [.25,.5,.75]:
            s=score(f,weight)
            self.assertEqual(s[s.selected].ticker.tolist(),[str(i).zfill(6) for i in range(1,6)])
        self.assertTrue(f.news_missing.all());self.assertFalse(f.usable_articles.any())

    def test_duplicate_removal_preserves_changed_numbers(self):
        a=article(title='가상회사 100억원 공급계약 체결')
        b=article(article_id='b',title='가상회사 100억원 공급계약 체결!')
        c=article(article_id='c',title='가상회사 200억원 공급계약 체결')
        self.assertEqual(len(representatives([a,b,c])),2)

    def test_max_two_articles_and_no_failure_fallback(self):
        articles=[article(article_id=str(i),title='가상회사 '+str(i*100)+'억원 공급계약 체결') for i in range(1,5)]
        plan,req,chosen=candidate_plan(price_panel(),articles)
        self.assertEqual(len(req),2);self.assertEqual(len(chosen),2)
        f=features_for(plan,req,[],[],'union',1)
        row=f[f.ticker=='000080'].iloc[0]
        self.assertEqual(row.requested_articles,1);self.assertEqual(row.news_state,'body_unavailable')

    def test_body_revision_after_decision_excluded(self):
        plan,req,_=candidate_plan(price_panel(),[article()])
        body=article(article_id='body',parent_article_id='headline',modified_at='2026-06-02T12:00:00+09:00')
        f=features_for(plan,req,[{'parent_article_id':'headline','status':'body_extracted','article':body}],[],'union',2)
        row=f[f.ticker=='000080'].iloc[0]
        self.assertEqual(row.news_state,'time_excluded');self.assertEqual(row.news_signal,0.)

    def test_calendar_lookback_keeps_prior_date_body_despite_later_revision(self):
        plan,req,_=candidate_plan(price_panel(),[article()],mode='calendar_lookback')
        body=article(article_id='body',parent_article_id='headline',modified_at='2026-06-02T12:00:00+09:00')
        label={'article_id':'body','input_sha256':digest(body['text']), 'result':{
            'insufficient_context':False,'relevance':'direct','sentiment':'positive','event_type':'contract',
            'evidence_quote':'공급계약 체결','reason':'계약'}}
        f=features_for(plan,req,[{'parent_article_id':'headline','status':'body_extracted','article':body}],
                       [label],'union',1,mode='calendar_lookback')
        row=f[f.ticker=='000080'].iloc[0]
        self.assertEqual(row.news_state,'usable')
        self.assertGreater(row.news_signal,0.)


if __name__=='__main__':unittest.main()

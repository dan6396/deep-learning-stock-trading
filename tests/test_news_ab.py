import json
import unittest
import pandas as pd
from run_news_ab import select_with_news,parse_batch,make_batches


def fixture(sentiment='negative',event='legal',modified=None):
    date=pd.Timestamp('2026-06-02')
    pool=pd.DataFrame([{'entry_date':date,'date':date-pd.Timedelta(days=1),'ticker':str(i),
                        'huber_ensemble':20-i,'price_rank':i,'company_name':'Company'} for i in range(1,21)])
    requests=[{'entry_date':'2026-06-02','ticker':str(i),'decision_at':'2026-06-02T08:30:00+09:00',
               'parent_article_id':'parent' if i==1 else None} for i in range(1,21)]
    article={'article_id':'body','parent_article_id':'parent','url':'https://example.com',
             'text':'회사가 소송을 당했다.','published_at':'2026-06-01T12:00:00+09:00',
             'timestamp_quality':'publisher_declared','modified_at':modified}
    bodies=[{'parent_article_id':'parent','status':'body_extracted','article':article}]
    result={'sentiment':sentiment,'relevance':'direct','event_type':event,'evidence_quote':'소송을 당했다.',
            'reason':'소송','insufficient_context':False}
    labels=[{'article_id':'body','result':result}]
    return pool,requests,bodies,labels


class Tests(unittest.TestCase):
    def test_batch_never_mixes_later_decision_news(self):
        _,req,b,_=fixture();a=b[0]['article']
        second=dict(a,article_id='later',parent_article_id='later-parent',published_at='2026-06-02T10:00:00+09:00')
        req=req+[{'parent_article_id':'later-parent','decision_at':'2026-06-03T08:30:00+09:00'}]
        batches,rejected,count=make_batches([a,second],req)
        self.assertEqual([[a['article_id'] for a in batch] for batch in batches],[['body'],['later']])
        self.assertEqual(count,2);self.assertFalse(rejected)

    def test_direct_negative_demotes_without_reordering_others(self):
        f=select_with_news(*fixture())
        self.assertEqual(list(f[f.selected].ticker),['2','3','4','5','6'])
        self.assertEqual(int(f.negative_filter.sum()),1)

    def test_positive_has_no_bonus(self):
        f=select_with_news(*fixture('positive'))
        self.assertEqual(list(f[f.selected].ticker),['1','2','3','4','5'])

    def test_promotional_other_event_is_not_automatic_veto(self):
        f=select_with_news(*fixture(event='other'))
        self.assertFalse(f.negative_filter.any())

    def test_future_revision_cannot_change_selection(self):
        f=select_with_news(*fixture(modified='2026-06-03T10:00:00+09:00'))
        self.assertEqual(f[f.ticker=='1'].news_state.iloc[0],'body_time_excluded')
        self.assertFalse(f.negative_filter.any())

    def test_missing_body_is_audited_and_keeps_price_order(self):
        pool,req,_,labels=fixture()
        f=select_with_news(pool,req,[],labels)
        self.assertEqual(f[f.ticker=='1'].news_state.iloc[0],'body_unavailable')
        self.assertEqual(list(f[f.selected].ticker),['1','2','3','4','5'])

    def test_batch_quote_must_belong_to_its_own_article(self):
        _,_,b,l=fixture();a=b[0]['article'];other=dict(a,article_id='other',text='매출이 늘었다.')
        data=[dict(l[0]['result'],article_id='body'),dict(l[0]['result'],article_id='other')]
        good,bad=parse_batch(json.dumps(data),[a,other])
        self.assertEqual([r['article_id'] for r in good],['body'])
        self.assertEqual([r['article_id'] for r in bad],['other'])

    def test_batch_duplicate_id_fails(self):
        _,_,b,l=fixture();a=b[0]['article'];other=dict(a,article_id='other')
        data=[dict(l[0]['result'],article_id='body')]*2
        with self.assertRaises(ValueError):parse_batch(json.dumps(data),[a,other])

if __name__=='__main__':unittest.main()

import json
import unittest
from run_news_ab_openai import request_body,response_text,usage_cost,cost_reservation


class Tests(unittest.TestCase):
    def test_request_excludes_outcomes_and_keeps_full_text(self):
        article={'article_id':'one','ticker':'123456','company_name':'기업','text':'본문 '*2000,
                 'return_1':.8,'huber_ensemble':.2}
        body=request_body([article]);sent=json.loads(body['input'])[0]
        self.assertEqual(sent['text'],article['text'])
        self.assertNotIn('return_1',sent);self.assertNotIn('huber_ensemble',sent)
        self.assertFalse(body['store'])

    def test_incomplete_response_and_refusal_rejected(self):
        for obj in [{'status':'incomplete'}, {'status':'completed','output':[{'type':'message','content':[{'type':'refusal'}]}]}]:
            with self.assertRaises(ValueError):response_text(obj)

    def test_response_extracts_only_message_text(self):
        obj={'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'{"articles": {}}'}]}]}
        self.assertEqual(json.loads(response_text(obj)),[])

    def test_schema_requires_every_article_id(self):
        a={'article_id':'one','ticker':'1','company_name':'기업','text':'본문'}
        b=dict(a,article_id='two')
        schema=request_body([a,b])['text']['format']['schema']['properties']['articles']
        self.assertEqual(schema['required'],['one','two'])
        self.assertFalse(schema['additionalProperties'])

    def test_cached_input_pricing_and_budget_reservation(self):
        cost=usage_cost({'input_tokens':1000000,'output_tokens':1000000,'input_tokens_details':{'cached_tokens':500000}})
        self.assertAlmostEqual(cost,1.85)
        self.assertGreater(cost_reservation(request_body([])),.0192)

if __name__=='__main__':unittest.main()

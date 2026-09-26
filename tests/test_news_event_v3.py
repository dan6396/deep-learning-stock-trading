import json
import unittest

from news_fusion.event_v3 import request_body, validate_response


class EventV3Tests(unittest.TestCase):
    def test_request_contains_article_but_no_return_target(self):
        article = {'article_id': 'a1', 'ticker': '005930', 'company_name': '삼성전자',
                   'text': '삼성전자는 계약을 추진하고 있다.'}
        body = request_body([article])
        self.assertEqual(json.loads(body['input'])[0]['text'], article['text'])
        self.assertNotIn('actual_return', body['input'])
        self.assertNotIn('huber_ensemble', body['input'])

    def test_evidence_quote_must_be_in_source(self):
        article = {'article_id': 'a1', 'ticker': '005930', 'company_name': '삼성전자',
                   'text': '삼성전자는 계약을 추진하고 있다.'}
        result = {'target_relation': 'operating_company', 'target_role': 'actor',
                  'event_state': 'proposal_or_bidding', 'economic_effect': 'unclear',
                  'event_type': 'contract', 'materiality_evidence': 'unclear',
                  'evidence_quote': '계약을 추진하고 있다', 'reason': '아직 추진 단계'}
        response = {'status': 'completed', 'output': [{'type':'message', 'content':[
            {'type':'output_text', 'text':json.dumps({'articles':{'a1':result}}, ensure_ascii=False)}]}]}
        self.assertEqual(validate_response(response,[article])[0]['result']['event_state'], 'proposal_or_bidding')
        result['evidence_quote'] = '이미 계약했다'
        response['output'][0]['content'][0]['text'] = json.dumps({'articles':{'a1':result}}, ensure_ascii=False)
        with self.assertRaises(ValueError):
            validate_response(response,[article])


if __name__ == '__main__':
    unittest.main()

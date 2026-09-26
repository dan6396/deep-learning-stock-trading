import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from news_fusion.body import extract_page,fetch_article_body,parse_time,title_similarity,public_url
from news_fusion.gemini import GeminiExtractor,align_evidence,validate_result
from news_fusion.news import eligible

def source():
    return {'article_id':'headline','ticker':'000001','company_name':'가상기업',
            'title':'가상기업 실적 발표','published_at':'2026-06-01T16:00:00+09:00',
            'retrieved_at':'2026-09-17T00:00:00+09:00','url':'https://example.com/news',
            'text':'가상기업 실적 발표','text_scope':'headline_only'}

def page(mod='2026-06-01T18:00:00+09:00',extra=''):
    data={'@type':'NewsArticle','headline':'가상기업 실적 발표','datePublished':'2026-06-01T14:00:00+09:00',
          'dateModified':mod,'articleBody':'매출이 증가했지만 시장 예상치에는 미달했다. '*30}
    return ('<html><head><script type="application/ld+json">'+json.dumps(data,ensure_ascii=False)+
            '</script>'+extra+'</head><body><nav>메뉴</nav><h1>가상기업 실적 발표</h1></body></html>').encode()

class Tests(unittest.TestCase):
    def test_quote_whitespace_restores_exact_source_span(self):
        text='머리말 SK\n하이닉스 매출 증가\n. 뒷말'
        r,a=align_evidence({'evidence_quote':'SK하이닉스 매출 증가.'},text)
        self.assertEqual(r['evidence_quote'],'SK\n하이닉스 매출 증가\n.')
        self.assertIn(r['evidence_quote'],text)
        self.assertEqual(a['original_model_quote'],'SK하이닉스 매출 증가.')

    def test_quote_paraphrase_still_rejected(self):
        r={'sentiment':'positive','relevance':'direct','event_type':'earnings',
           'evidence_quote':'매출 증가','reason':'증가','insufficient_context':False}
        r,a=align_evidence(r,'매출 감소')
        self.assertIsNone(a)
        with self.assertRaises(ValueError):validate_result(r,'매출 감소')

    def test_response_failure_records_safe_diagnostic(self):
        with TemporaryDirectory() as tmp,patch('news_fusion.gemini.requests.post') as post:
            post.return_value.status_code=200
            post.return_value.json.return_value={'candidates':[{'finishReason':'MAX_TOKENS'}]}
            with self.assertRaises(RuntimeError):GeminiExtractor('test-key',tmp).extract(source())
            audit=json.loads(next(Path(tmp).glob('*.error.json')).read_text())
            self.assertEqual(audit['finish_reason'],'MAX_TOKENS')
            self.assertEqual(audit['error_detail'],'Incomplete or blocked Gemini response')

    def test_structured_body_and_timestamps(self):
        p=extract_page(page(),'https://example.com/news')
        self.assertGreater(len(p['body']),300);self.assertNotIn('메뉴',p['body'])
        self.assertEqual(p['published_candidates'][0]['value'],'2026-06-01T14:00:00+09:00')

    def test_body_changes_id_and_preserves_rss_provenance(self):
        with TemporaryDirectory() as tmp,patch('news_fusion.body.fetch_public',return_value=('https://example.com/news',page())):
            r=fetch_article_body(source(),tmp)
            self.assertEqual(r['status'],'body_extracted')
            self.assertNotEqual(r['article']['article_id'],'headline')
            self.assertEqual(r['article']['parent_article_id'],'headline')
            self.assertFalse(r['article']['original_version_verified'])
            self.assertFalse(eligible(r['article'],'2026-06-02 08:30',mode='strict'))

    def test_later_revision_excluded_from_historical_use(self):
        with TemporaryDirectory() as tmp,patch('news_fusion.body.fetch_public',return_value=('https://example.com/news',page('2026-09-18T15:00:00+09:00'))):
            r=fetch_article_body(source(),tmp)
            self.assertEqual(r['status'],'body_extracted')
            self.assertFalse(eligible(r['article'],'2026-06-02 08:30',mode='exploratory'))

    def test_conflicting_dates_rejected(self):
        raw=page(extra='<meta property="article:published_time" content="2026-06-02T14:00:00+09:00">')
        with TemporaryDirectory() as tmp,patch('news_fusion.body.fetch_public',return_value=('https://example.com/news',raw)):
            r=fetch_article_body(source(),tmp)
            self.assertEqual(r['failure_reason'],'conflicting_published_dates')
            self.assertNotIn('article',r)

    def test_short_snippet_not_body(self):
        raw=b'<html><h1>Short headline</h1><p>Short teaser only</p></html>'
        with TemporaryDirectory() as tmp,patch('news_fusion.body.fetch_public',return_value=('https://example.com/news',raw)):
            r=fetch_article_body(source(),tmp)
            self.assertEqual(r['failure_reason'],'insufficient_body')

    def test_paywall_not_accepted(self):
        raw=page().replace(b'"@type": "NewsArticle"',b'"@type": "NewsArticle", "isAccessibleForFree": false')
        with TemporaryDirectory() as tmp,patch('news_fusion.body.fetch_public',return_value=('https://example.com/news',raw)):
            self.assertEqual(fetch_article_body(source(),tmp)['failure_reason'],'paywall_declared')

    def test_bad_url_and_localhost_rejected(self):
        with self.assertRaises(ValueError):public_url('file:///tmp/a')
        with self.assertRaises(ValueError):public_url('http://127.0.0.1/news')

    def test_full_text_after_4000_characters_sent(self):
        a=source();a['text']='내용 '*1500+'마지막 문장의 악재';a['text_scope']='publisher_body'
        result={'sentiment':'negative','relevance':'direct','event_type':'earnings',
                'evidence_quote':'마지막 문장의 악재','reason':'본문 끝의 악재','insufficient_context':False}
        with TemporaryDirectory() as tmp,patch('news_fusion.gemini.requests.post') as post:
            post.return_value.status_code=200
            post.return_value.json.return_value={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps(result)}]}}]}
            e=GeminiExtractor('test',tmp,interval=0)
            r=e.extract(a)
            payload=json.loads(post.call_args.kwargs['json']['contents'][0]['parts'][0]['text'])
            self.assertEqual(payload['text'],a['text']);self.assertEqual(r['input_chars'],len(a['text']))
            self.assertFalse(r['input_truncated'])

    def test_oversize_never_silently_truncated(self):
        a=source();a['text']='x'*30001
        with TemporaryDirectory() as tmp,patch('news_fusion.gemini.requests.post') as post:
            with self.assertRaises(ValueError):GeminiExtractor('test',tmp).extract(a)
            post.assert_not_called()

    def test_title_mismatch(self):
        self.assertLess(title_similarity('가상기업 실적 발표','오늘의 스포츠 야구 경기'),.45)

    def test_inline_numbers_and_acronyms_preserved(self):
        text='<span>SK</span>하이닉스 <b>HBM4</b> 배당금 <span>1500</span>원. '*30
        raw=('<html><h1>제목</h1><div itemprop="articleBody">'+text+
             '<div class="article-openlink-vertical">오늘의 다른 기사</div></div></html>').encode()
        b=extract_page(raw,'https://example.com')['body']
        self.assertIn('1500',b);self.assertIn('HBM4',b);self.assertNotIn('오늘의 다른 기사',b)

    def test_headline_and_body_mixing_rejected(self):
        from news_fusion.fusion import build_features
        import pandas as pd
        with self.assertRaises(ValueError):
            build_features(pd.DataFrame(),[source(),dict(source(),text_scope='publisher_body')],[])

if __name__=='__main__':unittest.main()

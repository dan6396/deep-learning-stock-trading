"""Fetch public publisher pages, not headline snippets; preserve version uncertainty."""
from __future__ import annotations
import hashlib
import ipaddress
import json
import re
import socket
from pathlib import Path
from urllib.parse import urljoin,urlparse
from bs4 import BeautifulSoup
import pandas as pd
import requests
import trafilatura
from .news import digest,normalize_title,now,save_json,timestamp

EXTRACTOR_VERSION='publisher-body-v2'
MAX_BYTES=8_000_000

def public_url(url):
    p=urlparse(url)
    if p.scheme not in ('http','https') or not p.hostname or p.username or p.password:
        raise ValueError('Invalid public article URL')
    if p.port not in (None,80,443):raise ValueError('Nonstandard article port')
    addresses=socket.getaddrinfo(p.hostname,p.port or (443 if p.scheme=='https' else 80))
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Nonpublic article host')
    return url

def fetch_public(url):
    """Bound redirects and page size. No login, proxy, challenge or paywall bypass."""
    for _ in range(6):
        public_url(url)
        with requests.get(url,timeout=(10,25),allow_redirects=False,stream=True,
                          headers={'User-Agent':'KOSPI-News-Research/1.0','Accept':'text/html'}) as r:
            if r.status_code in (301,302,303,307,308):
                url=urljoin(url,r.headers.get('Location',''));continue
            if r.status_code!=200:raise RuntimeError(f'publisher_http_{r.status_code}')
            if 'html' not in r.headers.get('Content-Type','').lower():
                raise RuntimeError('not_html')
            parts=[];size=0
            for part in r.iter_content(65536):
                size+=len(part)
                if size>MAX_BYTES:raise RuntimeError('page_too_large')
                parts.append(part)
            return url,b''.join(parts)
    raise RuntimeError('too_many_redirects')

def nodes(value):
    if isinstance(value,dict):
        yield value
        for v in value.values():yield from nodes(v)
    elif isinstance(value,list):
        for v in value:yield from nodes(v)

def parse_time(value):
    if not isinstance(value,str) or not re.search(r'\d{4}[-./년]\s*\d{1,2}',value):return None
    clean=value.strip().replace('년','-').replace('월','-').replace('일',' ')
    clean=re.sub(r'(?<=\d)\.(?=\d)','-',clean)
    try:
        t=timestamp(clean)
        return {'value':t.isoformat(),'raw':value,'precision':'minute' if re.search(r'\d{1,2}:\d{2}',value) else 'day'}
    except (ValueError,TypeError,OverflowError):return None

def title_similarity(left,right):
    a=normalize_title(left);b=normalize_title(right)
    if not a or not b:return 0.
    if a in b or b in a:return 1.
    x={a[i:i+2] for i in range(len(a)-1)};y={b[i:i+2] for i in range(len(b)-1)}
    return 2*len(x&y)/max(1,len(x)+len(y))

def extract_page(raw,url):
    soup=BeautifulSoup(raw,'lxml')
    title='';pub=[];mod=[];structured_body=[];paywall=False
    for tag in soup.select('script[type="application/ld+json"]'):
        try: data=json.loads(tag.string or tag.get_text())
        except (ValueError,TypeError):continue
        for n in nodes(data):
            types=n.get('@type',[]);types=[types] if isinstance(types,str) else types
            if not any(str(t).endswith(('Article','NewsArticle','ReportageNewsArticle','BlogPosting')) for t in types):continue
            title=title or n.get('headline','')
            if n.get('isAccessibleForFree') in [False,'false','False']:paywall=True
            if isinstance(n.get('articleBody'),str):structured_body.append(n['articleBody'])
            for field,dest in [('datePublished',pub),('dateModified',mod)]:
                parsed=parse_time(n.get(field))
                if parsed:dest.append(dict(parsed,source='jsonld:'+field))
    for tag in soup.find_all('meta'):
        name=(tag.get('property') or tag.get('name') or tag.get('itemprop') or '').lower()
        content=tag.get('content','')
        if name=='og:title':title=title or content
        if name in ['article:published_time','datepublished','pubdate','pub_date','publish_date','date','dcterms.created','dc.date.issued']:
            p=parse_time(content)
            if p:pub.append(dict(p,source='meta:'+name))
        if name in ['article:modified_time','datemodified','last-modified','lastmod','dcterms.modified']:
            p=parse_time(content)
            if p:mod.append(dict(p,source='meta:'+name))
    title=title or (soup.h1.get_text(' ',strip=True) if soup.h1 else '')
    visible=soup.get_text(' ',strip=True)
    if not pub:
        match=re.search(r'(?:송고|기사입력|입력|등록|발행일)\s*[:：]?\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)',visible)
        if match:
            p=parse_time(match.group(1))
            if p:pub.append(dict(p,source='visible:publication_label'))
    if not mod:
        match=re.search(r'(?:기사수정|수정|업데이트)\s*[:：]?\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)',visible)
        if match:
            p=parse_time(match.group(1))
            if p:mod.append(dict(p,source='visible:modification_label'))
    body='';method=''
    if structured_body:
        body=max(structured_body,key=len);method='jsonld:articleBody'
    if len(body)<300:
        # Narrow publisher containers; never use an entire page as article text.
        for selector in ['[itemprop="articleBody"]','#dic_area','#articeBody','#articleBodyContents','#newsct_article','.story-news.article','.article-txt','#article-view-content-div','.article-body','#articleBody','.article_view','.news_view','.article-body-contents']:
            node=soup.select_one(selector)
            if node:
                for unwanted in node.select('script,style,nav,aside,iframe,form,button,figure,.ad,.advertisement,.related-news,.copyright,[class*="article-openlink"]'):unwanted.decompose()
                value=node.get_text('\n',strip=True)
                if len(value)>=300:body=value;method='selector:'+selector;break
    if len(body)<300:
        body=trafilatura.extract(raw,url=url,include_comments=False,include_tables=False,
                                 favor_precision=True,deduplicate=True) or ''
        method='trafilatura'
    body=re.sub(r'[ \t]+',' ',body).strip()
    return {'publisher_title':title,'body':body,'extraction_method':method,
            'published_candidates':pub,'modified_candidates':mod,'paywall_declared':paywall}

def resolve_google(url):
    if urlparse(url).hostname!='news.google.com':return url
    from googlenewsdecoder import gnewsdecoder
    result=gnewsdecoder(url,interval=1,timeout=15)
    if not result.get('success'):raise RuntimeError('source_url_unresolved')
    result=result.get('decoded_url','')
    if urlparse(result).hostname=='news.google.com':raise RuntimeError('source_url_unresolved')
    return result

def fetch_article_body(article,cache_dir,resolved_url=None):
    cache_dir=Path(cache_dir);cache_dir.mkdir(parents=True,exist_ok=True)
    key=digest({'parent':article['article_id'],'resolved_url':resolved_url,'version':EXTRACTOR_VERSION})
    path=cache_dir/(key+'.json')
    if path.exists():return json.loads(path.read_text(encoding='utf-8'))
    record={'parent_article_id':article['article_id'],'title':article['title'],'ticker':article['ticker'],
            'status':'failed','attempted_at':now(),'extractor_version':EXTRACTOR_VERSION}
    try:
        url=resolved_url or resolve_google(article['url'])
        url,raw=fetch_public(url);page=extract_page(raw,url)
        record.update(resolved_url=url,**page)
        record['html_sha256']=hashlib.sha256(raw).hexdigest()
        (cache_dir/(key+'.html')).write_bytes(raw)
        record['body_chars']=len(page['body'])
        record['title_similarity']=title_similarity(article['title'],page['publisher_title'])
        if page['paywall_declared']:raise RuntimeError('paywall_declared')
        if len(page['body'])<300:raise RuntimeError('insufficient_body')
        if record['title_similarity']<.45:raise RuntimeError('title_mismatch')
        # A long menu or blocking page must not count as full text.
        if len(re.findall('[가-힣]',page['body']))<100:raise RuntimeError('insufficient_korean_body')
        pub=page['published_candidates'];mod=page['modified_candidates']
        if len({timestamp(v['value']).date() for v in pub})>1:raise RuntimeError('conflicting_published_dates')
        published=pub[0]['value'] if pub else article['published_at']
        if abs((timestamp(published).date()-timestamp(article['published_at']).date()).days)>1:
            raise RuntimeError('rss_publisher_date_mismatch')
        modified=max([p['value'] for p in mod],key=timestamp) if mod else None
        if modified and timestamp(modified)<timestamp(published):raise RuntimeError('invalid_modified_time')
        body_article=dict(article,parent_article_id=article['article_id'],url=url,
            rss_url=article['url'],rss_published_at=article['published_at'],
            text=page['publisher_title']+'\n\n'+page['body'],body=page['body'],
            text_scope='publisher_body',published_at=published,modified_at=modified,
            retrieved_at=now(),timestamp_quality='publisher_declared' if pub else 'feed_time_unverified',
            original_version_verified=False,modification_status='declared' if mod else 'unknown',
            body_extractor_version=EXTRACTOR_VERSION,html_sha256=record['html_sha256'])
        body_article['article_id']=digest({'ticker':article['ticker'],'url':url,'text':body_article['text']})
        record.update(status='body_extracted',article=body_article)
    except (requests.RequestException,RuntimeError,ValueError,TypeError,OSError) as exc:
        record['failure_reason']=str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__
    save_json(path,record)
    return record

"""News collection stores provenance; search results are NOT a PIT archive."""
from __future__ import annotations
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
import xml.etree.ElementTree as ET
import pandas as pd
import requests

KST = 'Asia/Seoul'

def now():
    return datetime.now(timezone.utc).isoformat()

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

def save_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    temp.replace(path)

def timestamp(value):
    t = pd.Timestamp(value)
    if pd.isna(t):
        raise ValueError('Missing timestamp')
    return t.tz_localize(KST) if t.tzinfo is None else t.tz_convert(KST)

def normalize_title(title):
    return re.sub(r'[^가-힣a-z0-9]', '', html.unescape(title).lower())

def collect_google_rss(company, ticker, start, end, cache_dir):
    """[start,end) by KST calendar date. Explicit local date filtering after search.

    Google RSS is a discovery sample, not an exhaustive historical data product.
    Keep the raw XML and query log; >=100 results is flagged as possibly truncated.
    Do not decode redirects or scrape publisher bodies in this collector.
    """
    query = f'"{company}" after:{start} before:{end}'
    key = digest({'provider':'google-news-rss-v1', 'query':query, 'ticker':ticker})
    cache_dir = Path(cache_dir); cache_dir.mkdir(parents=True, exist_ok=True)
    cache = cache_dir / (key + '.json')
    if cache.exists():
        return json.loads(cache.read_text(encoding='utf-8'))
    r = requests.get('https://news.google.com/rss/search',
                     params={'q':query, 'hl':'ko', 'gl':'KR', 'ceid':'KR:ko'}, timeout=25)
    if r.status_code != 200:
        raise RuntimeError(f'News search HTTP {r.status_code}')
    items = ET.fromstring(r.content).findall('.//item')
    (cache_dir / (key + '.xml')).write_bytes(r.content)
    retrieved = now(); articles=[]; rejected=0
    for item in items:
        try:
            published = timestamp(parsedate_to_datetime(item.findtext('pubDate')))
        except (TypeError, ValueError):
            rejected += 1; continue
        if not timestamp(start) <= published < timestamp(end):
            rejected += 1; continue
        source = item.findtext('source') or ''
        title = html.unescape(item.findtext('title') or '')
        if source and title.endswith(' - ' + source):
            title = title[:-(len(source)+3)]
        if not title.strip():
            rejected += 1; continue
        url = item.findtext('link') or ''
        record={'ticker':str(ticker).zfill(6), 'company_name':company,
                'title':title, 'text':title, 'text_scope':'headline_only',
                'published_at':published.isoformat(), 'retrieved_at':retrieved,
                'modified_at':None, 'timestamp_quality':'feed_time_unverified',
                'original_version_verified':False, 'source':source, 'url':url,
                'provider':'google_news_rss', 'query':query}
        record['article_id']=digest({'ticker':record['ticker'],'url':url,'text':title})
        articles.append(record)
    result={'query':query,'retrieved_at':retrieved,'requested_start':start,'requested_end':end,
            'raw_count':len(items),'retained_count':len(articles),'rejected_count':rejected,
            'possibly_truncated':len(items)>=100,'exhaustive':False,'articles':articles}
    save_json(cache,result)
    return result

def deduplicate(articles):
    """Collapse identical normalized headlines across publishers per company/day.
    Semantically similar but differently worded articles are not guaranteed deduplicated.
    """
    found={}
    for a in sorted(articles,key=lambda a:(a['published_at'],a['article_id'])):
        key=(a['ticker'],timestamp(a['published_at']).date().isoformat(),normalize_title(a['title']))
        found.setdefault(key,a)
    return list(found.values())

def eligible(article, decision_at, lookback_days=3, mode='strict'):
    decision=timestamp(decision_at); published=timestamp(article['published_at'])
    if mode == 'calendar_lookback':
        # Exploratory historical replay: accept only whole publication dates
        # preceding the trade date. Retrieval/revision times are not verified.
        day=decision.normalize(); publication_day=published.normalize()
        return day-pd.Timedelta(days=lookback_days) <= publication_day < day
    if not decision-pd.Timedelta(days=lookback_days) <= published < decision:
        return False
    if article.get('modified_at') and timestamp(article['modified_at']) >= decision:
        return False
    if mode == 'strict':
        # A page discovered today cannot be silently treated as a historical snapshot.
        if timestamp(article['retrieved_at']) >= decision:
            return False
        available=published
        if article.get('timestamp_quality') != 'verified':
            available=published.normalize()+pd.Timedelta(days=1)
        return available < decision
    if mode != 'exploratory':
        raise ValueError('mode must be strict or exploratory')
    # Even exploratory runs do not use unverified same-day RSS timestamps.
    available=published if article.get('timestamp_quality')=='verified' else published.normalize()+pd.Timedelta(days=1)
    return available < decision

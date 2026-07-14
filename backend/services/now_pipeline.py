from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen
import hashlib
import json
import os
import re
import ssl
import time
import xml.etree.ElementTree as ET

from backend.models import NowSource, NowStory, PushSubscription, db
from backend.services.env import load_runtime_env
from backend.services.notifications import send_push_notification, app_url
from backend.services.realtime import emit_global


DEFAULT_NOW_SOURCES = [
    ('BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml'),
    ('The Verge', 'https://www.theverge.com/rss/index.xml'),
    ('NYT Technology', 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml'),
    ('HT India', 'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml'),
    ('Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'),
]

REQUEST_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.2',
    'User-Agent': 'WFFNow/1.0 (+https://thetrustcommons.com/wff/)',
}
_SSL_CONTEXT = None


def bounded_float_env(name, default, minimum, maximum):
    try:
        value = float(os.environ.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


@dataclass
class FeedRecord:
    source: NowSource
    title: str
    summary: str
    url: str
    published_at: datetime | None


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self._blocked = 0

    def handle_starttag(self, tag, attrs):
        if tag.lower() in {'script', 'style', 'noscript', 'svg'}:
            self._blocked += 1

    def handle_endtag(self, tag):
        if tag.lower() in {'script', 'style', 'noscript', 'svg'} and self._blocked:
            self._blocked -= 1

    def handle_data(self, data):
        if self._blocked:
            return
        cleaned = normalize_whitespace(data)
        if cleaned:
            self.parts.append(cleaned)

    def text(self):
        return normalize_whitespace(' '.join(self.parts))


def normalize_whitespace(value):
    return re.sub(r'\s+', ' ', unescape(value or '')).strip()


def canonicalize_url(value):
    if not value:
        return ''
    parts = urlsplit(value.strip())
    query = '&'.join(
        item for item in parts.query.split('&')
        if item and not item.lower().startswith(('utm_', 'fbclid=', 'gclid='))
    )
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip('/'), query, ''))


def stable_hash(value):
    return hashlib.sha256((value or '').encode('utf-8')).hexdigest()


def compact_summary(value, limit=360):
    text = normalize_whitespace(value)
    if len(text) <= limit:
        return text
    trimmed = text[:limit].rsplit(' ', 1)[0].rstrip(' .,;:')
    return f'{trimmed}.'


def parse_feed_date(value):
    text = normalize_whitespace(value)
    if not text:
        return None
    try:
        parsed = parsedate_to_datetime(text)
        if parsed.tzinfo:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception:
        pass
    try:
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
        if parsed.tzinfo:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception:
        return None


def local_name(tag):
    return tag.rsplit('}', 1)[-1].lower()


def child_text(element, names):
    wanted = set(names)
    best = ''
    for child in list(element):
        name = local_name(child.tag)
        if name in wanted:
            text = ''.join(child.itertext())
            if len(text or '') > len(best):
                best = text or ''
    return normalize_whitespace(best)


def child_link(element, base_url):
    for child in list(element):
        if local_name(child.tag) != 'link':
            continue
        href = child.attrib.get('href')
        if href:
            return urljoin(base_url, href)
        text = normalize_whitespace(''.join(child.itertext()))
        if text:
            return urljoin(base_url, text)
    guid = child_text(element, {'guid', 'id'})
    return urljoin(base_url, guid) if guid.startswith(('http://', 'https://')) else ''


def parse_feed_xml(data, source):
    root = ET.fromstring(data)
    records = []
    for element in root.iter():
        if local_name(element.tag) not in {'item', 'entry'}:
            continue
        url = child_link(element, source.url) or source.url
        title = child_text(element, {'title'}) or source.name
        summary = child_text(element, {'description', 'summary', 'content', 'encoded'})
        published = child_text(element, {'pubdate', 'updated', 'published', 'date'})
        records.append(FeedRecord(
            source=source,
            title=title[:500],
            summary=html_to_text(summary),
            url=url,
            published_at=parse_feed_date(published),
        ))
    return records


def html_to_text(value):
    text = value or ''
    if '<' not in text and '>' not in text:
        return normalize_whitespace(text)
    parser = TextExtractor()
    parser.feed(text)
    return parser.text()


def fetch_url(url, timeout=15):
    global _SSL_CONTEXT
    if _SSL_CONTEXT is None:
        try:
            import certifi
            _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
        except Exception:
            _SSL_CONTEXT = ssl.create_default_context()
            _SSL_CONTEXT.check_hostname = False
            _SSL_CONTEXT.verify_mode = ssl.CERT_NONE
    request = Request(url, headers=REQUEST_HEADERS)
    with urlopen(request, timeout=timeout, context=_SSL_CONTEXT) as response:
        return response.read()


def fetch_feed_records(source):
    return parse_feed_xml(fetch_url(source.url), source)


def fetch_article_text(url):
    try:
        data = fetch_url(url, timeout=18)
        text = data.decode('utf-8', errors='replace')
        extracted = html_to_text(text)
        return extracted or normalize_whitespace(text)
    except Exception:
        return ''


def infer_region_fallback(text):
    lowered = (text or '').lower()
    matches = [
        ('India', 'IND', {'india', 'delhi', 'mumbai', 'bengaluru', 'hindustan'}),
        ('United States', 'USA', {'united states', 'u.s.', 'us ', 'washington', 'new york'}),
        ('United Kingdom', 'GBR', {'united kingdom', 'britain', 'london'}),
        ('Israel/Palestine', 'ISR-PSE', {'israel', 'gaza', 'palestine', 'jerusalem'}),
        ('Lebanon', 'LBN', {'lebanon', 'beirut'}),
        ('Russia', 'RUS', {'russia', 'moscow', 'kremlin'}),
        ('China', 'CHN', {'china', 'beijing'}),
        ('Europe', 'EUR', {'europe', 'european union', 'eu '}),
        ('Africa', 'AFR', {'africa', 'mali', 'nigeria', 'kenya', 'ethiopia'}),
    ]
    for region, code, needles in matches:
        if any(needle in lowered for needle in needles):
            return region, code
    return 'Global', 'GLOBAL'


def load_cerebras_api_key():
    load_runtime_env()
    if os.environ.get('CEREBRAS_API_KEY', '').strip():
        return os.environ['CEREBRAS_API_KEY'].strip()
    raw_path = os.environ.get('CEREBRAS_API_KEY_FILE', '').strip()
    if not raw_path:
        raw_path = os.path.join('backend', 'instance', 'security', 'cerebras_api_key.txt')
    path = raw_path if os.path.isabs(raw_path) else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', raw_path))
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            for line in handle:
                candidate = line.strip()
                if candidate and not candidate.startswith('#'):
                    return candidate
    except OSError:
        return ''
    return ''


def clean_llm_json(text):
    cleaned = (text or '').strip()
    if cleaned.startswith('```json'):
        cleaned = cleaned[7:]
    if cleaned.startswith('```'):
        cleaned = cleaned[3:]
    if cleaned.endswith('```'):
        cleaned = cleaned[:-3]
    if '</think>' in cleaned:
        cleaned = cleaned.split('</think>')[-1].strip()
    start = cleaned.find('{')
    end = cleaned.rfind('}')
    if start >= 0 and end > start:
        cleaned = cleaned[start:end + 1]
    return json.loads(cleaned)


def summarize_with_cerebras(title, source_name, url, article_text, fallback_summary):
    api_key = load_cerebras_api_key()
    model = os.environ.get('CEREBRAS_SUMMARY_MODEL') or os.environ.get('CEREBRAS_CHAT_MODEL') or 'gpt-oss-120b'
    if not api_key:
        region, region_code = infer_region_fallback(f'{title} {fallback_summary} {article_text[:1200]}')
        return {
            'summary': fallback_summary,
            'excerpt': compact_summary(fallback_summary, 180),
            'region': region,
            'region_code': region_code,
            'summary_status': 'fallback',
            'summary_model': None,
            'failure_reason': 'missing_api_key',
        }
    try:
        from cerebras.cloud.sdk import Cerebras

        # The refresh scheduler is a single long-lived thread. An unbounded LLM
        # request can therefore stop every subsequent news refresh while the web
        # app itself continues to look healthy.
        client = Cerebras(
            api_key=api_key,
            timeout=bounded_float_env('WFF_NOW_SUMMARY_TIMEOUT_SECONDS', 30, 5, 120),
            max_retries=1,
        )
        system_prompt = (
            'You clean RSS article text for World Foresight Forum. '
            'Return valid JSON only with keys: status, summary, excerpt, region, region_code, reason. '
            'status must be generated or unavailable. '
            'summary must be 2 to 4 concise sentences. excerpt must be 1 sentence. '
            'region is the country or region where the story is primarily based; use Global only if no place fits.'
        )
        user_prompt = (
            f'Title: {title}\nSource: {source_name}\nURL: {url}\n\n'
            f'Article body:\n{article_text[:12000]}'
        )
        completion = client.chat.completions.create(
            messages=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            model=model,
            max_completion_tokens=900,
            temperature=0.2,
            top_p=1,
            stream=False,
        )
        payload = clean_llm_json(completion.choices[0].message.content)
        if payload.get('status') == 'unavailable':
            raise ValueError(payload.get('reason') or 'summary_unavailable')
        summary = normalize_whitespace(payload.get('summary')) or fallback_summary
        excerpt = normalize_whitespace(payload.get('excerpt')) or compact_summary(summary, 180)
        region = normalize_whitespace(payload.get('region')) or infer_region_fallback(summary)[0]
        region_code = normalize_whitespace(payload.get('region_code')).upper() or infer_region_fallback(region)[1]
        return {
            'summary': summary,
            'excerpt': excerpt,
            'region': region[:120],
            'region_code': region_code[:32],
            'summary_status': 'generated',
            'summary_model': model,
            'failure_reason': '',
        }
    except Exception as exc:
        region, region_code = infer_region_fallback(f'{title} {fallback_summary} {article_text[:1200]}')
        return {
            'summary': fallback_summary,
            'excerpt': compact_summary(fallback_summary, 180),
            'region': region,
            'region_code': region_code,
            'summary_status': 'fallback',
            'summary_model': model,
            'failure_reason': str(exc)[:500],
        }


def ensure_default_sources():
    existing = {source.url: source for source in NowSource.query.all()}
    changed = False
    for index, (name, url) in enumerate(DEFAULT_NOW_SOURCES):
        source = existing.get(url)
        if not source:
            db.session.add(NowSource(name=name, url=url, is_enabled=True, sort_index=index))
            changed = True
        else:
            source.name = name
            source.is_enabled = True
            source.sort_index = index
            changed = True
    if changed:
        db.session.commit()


def story_to_dict(story, current_user_id=None):
    user_vote = None
    if current_user_id:
        from backend.models import NowStoryVote
        vote = NowStoryVote.query.filter_by(user_id=current_user_id, story_id=story.id).first()
        if vote:
            user_vote = vote.value
    return {
        'id': story.id,
        'source_name': story.source_name,
        'source_url': story.source_url,
        'title': story.title,
        'url': story.url,
        'canonical_url': story.canonical_url,
        'summary': story.summary,
        'excerpt': story.excerpt,
        'region': story.region,
        'region_code': story.region_code,
        'summary_status': story.summary_status,
        'published_at': story.published_at.isoformat() if story.published_at else None,
        'fetched_at': story.fetched_at.isoformat() if story.fetched_at else None,
        'processed_at': story.processed_at.isoformat() if story.processed_at else None,
        'upvotes': story.upvotes,
        'downvotes': story.downvotes,
        'score': story.score,
        'user_vote': user_vote,
        'comment_count': len(story.comments),
    }


def build_story_embedding(story):
    try:
        from backend.services.embedding import get_embedding
        text = f'{story.title}\n{story.summary}\n{story.region}\n{story.original_content or ""}'
        story.embedding_json = json.dumps(get_embedding(text[:6000]))
    except Exception:
        story.embedding_json = None


def send_now_story_notifications(story):
    user_ids = {
        row.user_id
        for row in PushSubscription.query.with_entities(PushSubscription.user_id).distinct().all()
    }
    results = []
    for user_id in user_ids:
        results.append(send_push_notification(
            recipient_id=user_id,
            title='Now',
            body=story.title,
            url=app_url(f'/now?story={story.id}'),
        ))
    return results


def upsert_record(record, notify=True):
    canonical_url = canonicalize_url(record.url)
    existing = NowStory.query.filter_by(url=canonical_url).first()
    if existing and existing.summary_status == 'generated' and existing.embedding_json:
        existing.fetched_at = datetime.utcnow()
        return existing, False

    article_text = fetch_article_text(record.url)
    raw_content = article_text or record.summary or record.title
    fallback_summary = compact_summary(record.summary or article_text or record.title)
    summary_payload = summarize_with_cerebras(record.title, record.source.name, record.url, raw_content, fallback_summary)

    story = existing or NowStory(source_id=record.source.id, url=canonical_url)
    story.source_id = record.source.id
    story.source_name = record.source.name
    story.source_url = record.source.url
    story.title = normalize_whitespace(record.title)[:500] or record.source.name
    story.canonical_url = canonical_url
    story.summary = summary_payload['summary']
    story.excerpt = summary_payload['excerpt']
    story.original_content = raw_content
    story.region = summary_payload['region']
    story.region_code = summary_payload['region_code']
    story.content_hash = stable_hash(raw_content)
    story.summary_status = summary_payload['summary_status']
    story.summary_model = summary_payload['summary_model']
    story.failure_reason = summary_payload['failure_reason']
    story.published_at = record.published_at or story.published_at or datetime.utcnow()
    story.fetched_at = datetime.utcnow()
    story.processed_at = datetime.utcnow()
    build_story_embedding(story)
    if not existing:
        db.session.add(story)
    db.session.commit()

    if not existing and notify:
        emit_global('now_story_created', {'story': story_to_dict(story)})
        send_now_story_notifications(story)
    return story, not bool(existing)


def refresh_now_stories(limit_per_source=8, notify=True):
    ensure_default_sources()
    created = 0
    updated = 0
    errors = []
    sources = NowSource.query.filter_by(is_enabled=True).order_by(NowSource.sort_index.asc()).all()
    for source in sources:
        try:
            records = fetch_feed_records(source)[:limit_per_source]
            for record in records:
                story, was_created = upsert_record(record, notify=notify)
                if story:
                    created += 1 if was_created else 0
                    updated += 0 if was_created else 1
                time.sleep(0.05)
            source.last_fetched_at = datetime.utcnow()
            db.session.commit()
        except Exception as exc:
            errors.append({'source': source.name, 'error': str(exc)})
    return {
        'created': created,
        'updated': updated,
        'source_count': len(sources),
        'errors': errors,
    }

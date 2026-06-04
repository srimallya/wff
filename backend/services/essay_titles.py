import json
import os
import re

from backend.models import Essay, db
from backend.services.now_pipeline import clean_llm_json, load_cerebras_api_key, normalize_whitespace


TITLE_MODEL = os.environ.get('CEREBRAS_TITLE_MODEL') or os.environ.get('CEREBRAS_CHAT_MODEL') or 'gpt-oss-120b'


def clean_title(value):
    title = normalize_whitespace(value)
    title = re.sub(r'^[\'"“”‘’]+|[\'"“”‘’]+$', '', title).strip()
    title = re.sub(r'[.!?]+$', '', title).strip()
    if len(title) < 5 or not re.search(r'[A-Za-z0-9]', title):
        return ''
    if title.startswith(('{', '[', '}', ']')) or title.lower().startswith(('count:', '. count')):
        return ''
    if len(title) <= 50:
        return title
    return title[:50].rsplit(' ', 1)[0].strip(' ,;:-') or title[:50].strip()


def fallback_title(content):
    text = normalize_whitespace(content)
    first_sentence = re.split(r'(?<=[.!?])\s+', text, maxsplit=1)[0]
    return clean_title(first_sentence) or 'Untitled Future'


def title_from_reasoning(value):
    text = value or ''
    quoted = re.findall(r'"([^"]{5,80})"', text)
    for candidate in reversed(quoted):
        title = clean_title(candidate)
        if title:
            return title
    match = re.search(r'(?:title|like|called)\s*[:\-]?\s*([A-Z][^.\n]{5,80})', text, re.IGNORECASE)
    if match:
        return clean_title(match.group(1))
    return ''


def generate_title_with_cerebras(content):
    api_key = load_cerebras_api_key()
    if not api_key:
        return fallback_title(content), 'fallback', 'missing_api_key'
    try:
        from cerebras.cloud.sdk import Cerebras

        client = Cerebras(api_key=api_key)
        completion = client.chat.completions.create(
            messages=[
                {
                    'role': 'system',
                    'content': (
                        'Generate concise titles for World Foresight Forum essays. '
                        'Return valid JSON only with key title. The title must be specific, neutral, and at most 50 characters.'
                    ),
                },
                {'role': 'user', 'content': f'Essay:\n{content[:5000]}'},
            ],
            model=TITLE_MODEL,
            max_completion_tokens=320,
            temperature=0.2,
            top_p=1,
            stream=False,
        )
        message = completion.choices[0].message
        raw = message.content or ''
        try:
            payload = clean_llm_json(raw)
            title = clean_title(payload.get('title'))
        except Exception:
            title = clean_title(raw)
        if not title:
            title = title_from_reasoning(getattr(message, 'reasoning', '') or '')
        if not title:
            raise ValueError('empty_title')
        return title, TITLE_MODEL, ''
    except Exception as exc:
        return fallback_title(content), 'fallback', str(exc)[:500]


def backfill_essay_titles(limit=None, commit_every=10, force=False):
    query = Essay.query.order_by(Essay.id.asc())
    if not force:
        query = query.filter((Essay.title.is_(None)) | (Essay.title == ''))
    if limit:
        query = query.limit(limit)
    essays = query.all()
    results = []
    for index, essay in enumerate(essays, start=1):
        title, model, error = generate_title_with_cerebras(essay.content)
        essay.title = title
        results.append({
            'id': essay.id,
            'title': title,
            'model': model,
            'error': error,
        })
        if commit_every and index % commit_every == 0:
            db.session.commit()
    if essays:
        db.session.commit()
    return {
        'updated': len(essays),
        'results': results,
    }

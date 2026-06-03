from collections import Counter
from datetime import datetime, timedelta
import json

from backend.models import NowStory, db
from backend.services.now_pipeline import story_to_dict


def _normalize_limit(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = 30
    return max(1, min(parsed, 100))


def _normalize_region(value):
    normalized = str(value or '').strip().upper()
    return normalized or None


def _normalize_hours(value):
    if value in (None, ''):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _story_corpus(story):
    return ' '.join([
        story.title or '',
        story.summary or '',
        story.excerpt or '',
        story.region or '',
        story.source_name or '',
        (story.original_content or '')[:4000],
    ]).lower()


def _semantic_matches(query, stories, existing_ids, min_similarity=0.22):
    try:
        import numpy as np
        from backend.services.embedding import get_embedding, embedding_from_json, cosine_similarity

        query_emb = np.array(get_embedding(query), dtype=np.float32)
    except Exception:
        return []

    scored = []
    for story in stories:
        if story.id in existing_ids:
            continue
        emb = None
        if story.embedding_json:
            try:
                emb = embedding_from_json(story.embedding_json)
            except Exception:
                emb = None
        if emb is None:
            try:
                emb = np.array(get_embedding(_story_corpus(story)), dtype=np.float32)
                story.embedding_json = json.dumps(emb.tolist())
            except Exception:
                continue
        try:
            similarity = cosine_similarity(query_emb, emb)
            if similarity >= min_similarity:
                scored.append((similarity, story))
        except Exception:
            continue

    if scored:
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()

    scored.sort(key=lambda item: (item[0], item[1].published_at or item[1].fetched_at or datetime.min), reverse=True)
    return [story for _, story in scored]


def _query_matched_stories(query):
    stories = NowStory.query.order_by(NowStory.published_at.desc(), NowStory.fetched_at.desc()).all()
    normalized_query = (query or '').strip().lower()
    if not normalized_query:
        return stories

    terms = [term for term in normalized_query.split() if len(term) > 1] or [normalized_query]
    lexical = [
        story for story in stories
        if all(term in _story_corpus(story) for term in terms)
    ]
    lexical_ids = {story.id for story in lexical}
    return lexical + _semantic_matches(normalized_query, stories, lexical_ids)


def _region_facets(stories):
    labels = {}
    counts = Counter()
    for story in stories:
        code = story.region_code or 'GLOBAL'
        labels[code] = story.region or 'Global'
        counts[code] += 1
    return [
        {'region_code': code, 'region': labels[code], 'count': count}
        for code, count in sorted(counts.items(), key=lambda item: (-item[1], labels[item[0]], item[0]))
    ]


def _histogram(stories, bucket_hours=6, bucket_count=28):
    now = datetime.utcnow()
    buckets = [
        {
            'start': (now - timedelta(hours=bucket_hours * (bucket_count - index))).isoformat(),
            'end': (now - timedelta(hours=bucket_hours * (bucket_count - index - 1))).isoformat(),
            'count': 0,
        }
        for index in range(bucket_count)
    ]
    for story in stories:
        stamp = story.published_at or story.fetched_at
        if not stamp:
            continue
        hours_ago = (now - stamp).total_seconds() / 3600
        index = bucket_count - 1 - int(hours_ago // bucket_hours)
        if 0 <= index < bucket_count:
            buckets[index]['count'] += 1
    return buckets


def search_now_stories(query='', region_code=None, hours_back=None, current_user_id=None, limit=30):
    normalized_region = _normalize_region(region_code)
    normalized_hours = _normalize_hours(hours_back)
    normalized_limit = _normalize_limit(limit)

    query_matches = _query_matched_stories(query)
    region_facets = _region_facets(query_matches)

    region_matches = query_matches
    if normalized_region:
        region_matches = [
            story for story in query_matches
            if (story.region_code or 'GLOBAL').upper() == normalized_region
        ]

    histogram = _histogram(region_matches)
    final_matches = region_matches
    if normalized_hours:
        threshold = datetime.utcnow() - timedelta(hours=normalized_hours)
        final_matches = [
            story for story in region_matches
            if (story.published_at or story.fetched_at or datetime.min) >= threshold
        ]

    return {
        'stories': [story_to_dict(story, current_user_id) for story in final_matches[:normalized_limit]],
        'total': len(final_matches),
        'facets': {
            'regions': region_facets,
            'histogram': histogram,
        },
        'applied_filters': {
            'query': (query or '').strip(),
            'region_code': normalized_region,
            'hours_back': normalized_hours,
        },
    }

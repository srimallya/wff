from collections import Counter
from datetime import datetime, timedelta
import json
import re

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


def _normalize_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).replace(tzinfo=None)
    except (TypeError, ValueError):
        return None


def _story_corpus(story):
    return ' '.join([
        story.title or '',
        story.summary or '',
        story.excerpt or '',
        story.region or '',
        story.source_name or '',
        (story.original_content or '')[:4000],
    ]).lower()


def _primary_story_corpus(story):
    return ' '.join([
        story.title or '',
        story.summary or '',
        story.excerpt or '',
        story.region or '',
        story.source_name or '',
    ]).lower()


def _semantic_story_corpus(story):
    return ' '.join([
        story.title or '',
        story.summary or '',
        story.excerpt or '',
        story.region or '',
        story.source_name or '',
        (story.original_content or '')[:1200],
    ])


def _query_terms(query):
    return [term for term in re.findall(r'[a-z0-9][a-z0-9\-]+', (query or '').lower()) if len(term) > 1]


def _lexical_score(query, story):
    normalized_query = (query or '').strip().lower()
    terms = _query_terms(normalized_query)
    if not normalized_query or not terms:
        return 0.0

    title = (story.title or '').lower()
    summary = (story.summary or '').lower()
    excerpt = (story.excerpt or '').lower()
    metadata = f'{story.region or ""} {story.source_name or ""}'.lower()
    original = ((story.original_content or '')[:1200]).lower()
    primary = f'{title} {summary} {excerpt} {metadata}'

    score = 0.0
    if normalized_query in title:
        score += 12.0
    elif normalized_query in primary:
        score += 8.0
    elif normalized_query in original:
        score += 0.5

    for term in terms:
        if term in title:
            score += 5.0
        elif term in summary:
            score += 3.0
        elif term in excerpt:
            score += 2.0
        elif term in metadata:
            score += 1.0
        elif term in original:
            score += 0.15

    matched_primary_terms = sum(1 for term in terms if term in primary)
    if len(terms) > 1 and matched_primary_terms == len(terms):
        score += 4.0
    return score


def _semantic_scores(query, stories, min_similarity=0.22):
    try:
        import numpy as np
        from backend.services.embedding import get_embedding, embedding_from_json, cosine_similarity

        query_emb = np.array(get_embedding(query), dtype=np.float32)
    except Exception:
        return []

    scored = []
    for story in stories:
        emb = None
        if story.embedding_json:
            try:
                emb = embedding_from_json(story.embedding_json)
            except Exception:
                emb = None
        if emb is None:
            try:
                emb = np.array(get_embedding(_semantic_story_corpus(story)), dtype=np.float32)
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

    return scored


def _query_matched_stories(query):
    stories = NowStory.query.order_by(NowStory.published_at.desc(), NowStory.fetched_at.desc()).all()
    normalized_query = (query or '').strip().lower()
    if not normalized_query:
        return stories

    scores = {}
    for story in stories:
        score = _lexical_score(normalized_query, story)
        if score >= 1.0:
            scores[story.id] = {'story': story, 'score': score, 'semantic': 0.0}

    for similarity, story in _semantic_scores(normalized_query, stories):
        item = scores.setdefault(story.id, {'story': story, 'score': 0.0, 'semantic': 0.0})
        item['semantic'] = max(item['semantic'], similarity)
        item['score'] += similarity * 5.0

    ranked = sorted(
        scores.values(),
        key=lambda item: (
            item['score'],
            item['semantic'],
            item['story'].score,
            _story_time(item['story']),
        ),
        reverse=True,
    )
    for item in ranked:
        try:
            setattr(item['story'], '_now_search_relevance', item['score'])
        except Exception:
            pass
    return [item['story'] for item in ranked]


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


def _archive_hours(stories):
    now = datetime.utcnow()
    hours = [
        max(1, int((now - (story.published_at or story.fetched_at)).total_seconds() // 3600))
        for story in stories
        if story.published_at or story.fetched_at
    ]
    return max(hours, default=168)


def _histogram(stories, bucket_count=28):
    now = datetime.utcnow()
    max_hours = _archive_hours(stories)
    bucket_hours = max(1, max_hours / bucket_count)
    buckets = [
        {
            'index': index,
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
        if hours_ago >= max_hours:
            index = 0
        if 0 <= index < bucket_count:
            buckets[index]['count'] += 1
    return {
        'buckets': buckets,
        'max_hours': max_hours,
    }


def _story_time(story):
    return story.published_at or story.fetched_at or datetime.min


def _rank_filtered_stories(stories, query=''):
    normalized_query = (query or '').strip().lower()
    if normalized_query:
        return sorted(
            stories,
            key=lambda story: (
                getattr(story, '_now_search_relevance', 0.0),
                _lexical_score(normalized_query, story),
                story.score,
                _story_time(story),
            ),
            reverse=True,
        )
    return sorted(stories, key=lambda story: (story.score, _story_time(story)), reverse=True)


def search_now_stories(query='', region_code=None, hours_back=None, time_start=None, time_end=None, current_user_id=None, limit=30):
    normalized_region = _normalize_region(region_code)
    normalized_hours = _normalize_hours(hours_back)
    normalized_start = _normalize_datetime(time_start)
    normalized_end = _normalize_datetime(time_end)
    normalized_limit = _normalize_limit(limit)

    query_matches = _query_matched_stories(query)
    region_facets = _region_facets(query_matches)

    region_matches = query_matches
    if normalized_region:
        region_matches = [
            story for story in query_matches
            if (story.region_code or 'GLOBAL').upper() == normalized_region
        ]

    histogram_payload = _histogram(region_matches)
    histogram = histogram_payload['buckets']
    max_hours = histogram_payload['max_hours']
    final_matches = region_matches
    if normalized_start and normalized_end:
        start, end = sorted([normalized_start, normalized_end])
        final_matches = [
            story for story in region_matches
            if start <= _story_time(story) < end
        ]
    elif normalized_hours:
        threshold = datetime.utcnow() - timedelta(hours=normalized_hours)
        final_matches = [
            story for story in region_matches
            if _story_time(story) >= threshold
        ]

    if (query or '').strip() or normalized_region or normalized_hours or (normalized_start and normalized_end):
        final_matches = _rank_filtered_stories(final_matches, query)

    return {
        'stories': [story_to_dict(story, current_user_id) for story in final_matches[:normalized_limit]],
        'total': len(final_matches),
        'facets': {
            'regions': region_facets,
            'histogram': histogram,
            'archive': {
                'max_hours': max_hours,
                'selected_hours': normalized_hours,
                'selected_start': normalized_start.isoformat() if normalized_start else None,
                'selected_end': normalized_end.isoformat() if normalized_end else None,
            },
        },
        'applied_filters': {
            'query': (query or '').strip(),
            'region_code': normalized_region,
            'hours_back': normalized_hours,
            'time_start': normalized_start.isoformat() if normalized_start else None,
            'time_end': normalized_end.isoformat() if normalized_end else None,
        },
    }

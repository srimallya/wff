from collections import Counter
from datetime import datetime

from backend.models import Comment, Essay, PolicyProposal, Vote
from backend.services.recommendation_features import cosine_for_essays, year_bucket
from backend.services.search_service import _normalize_country_code, _normalize_year, _query_matched_essays


DEFAULT_SOURCE_LIMIT = 80


def _add_candidate(candidates, essay, source):
    if not essay:
        return
    if essay.id not in candidates:
        candidates[essay.id] = {'essay': essay, 'sources': set()}
    candidates[essay.id]['sources'].add(source)


def recent_posts(limit=DEFAULT_SOURCE_LIMIT):
    return Essay.query.order_by(Essay.created_at.desc()).limit(limit).all()


def search_context_posts(query=None, country_code=None, year=None, limit=DEFAULT_SOURCE_LIMIT):
    if not query and not country_code and year is None:
        return []
    normalized_country_code = _normalize_country_code(country_code)
    normalized_year = _normalize_year(year)
    matches = _query_matched_essays(query or '')
    if normalized_country_code:
        matches = [
            essay for essay in matches
            if (essay.country_code or 'GLOBAL').upper() == normalized_country_code
        ]
    if normalized_year is not None:
        matches = [essay for essay in matches if essay.target_calendar_year == normalized_year]
    return matches[:limit]


def _user_anchor_posts(current_user_id):
    if not current_user_id:
        return []
    anchors = []
    voted_ids = [
        vote.essay_id for vote in Vote.query
        .filter(Vote.user_id == current_user_id)
        .filter(Vote.value > 0)
        .limit(30)
        .all()
    ]
    written_ids = [
        essay.id for essay in Essay.query
        .filter(Essay.user_id == current_user_id)
        .order_by(Essay.created_at.desc())
        .limit(20)
        .all()
    ]
    commented_ids = [
        comment.essay_id for comment in Comment.query
        .filter(Comment.user_id == current_user_id)
        .order_by(Comment.created_at.desc())
        .limit(30)
        .all()
    ]
    for essay_id in dict.fromkeys(voted_ids + written_ids + commented_ids):
        essay = Essay.query.get(essay_id)
        if essay:
            anchors.append(essay)
    return anchors


def semantic_neighbor_posts(current_user_id=None, query=None, limit=DEFAULT_SOURCE_LIMIT):
    anchors = _user_anchor_posts(current_user_id)
    scored = {}
    corpus = Essay.query.order_by(Essay.created_at.desc()).limit(500).all()
    for candidate in corpus:
        if current_user_id and candidate.user_id == current_user_id:
            continue
        best = 0.0
        for anchor in anchors:
            if anchor.id == candidate.id:
                continue
            best = max(best, cosine_for_essays(candidate, anchor))
        if best > 0.35:
            scored[candidate.id] = (best, candidate)

    if query:
        try:
            import numpy as np
            from backend.services.embedding import cosine_similarity, embedding_from_json, get_embedding

            query_embedding = np.array(get_embedding(query), dtype=np.float32)
            for candidate in corpus:
                if not candidate.embedding_json:
                    continue
                embedding = embedding_from_json(candidate.embedding_json)
                if embedding is not None:
                    similarity = (cosine_similarity(query_embedding, embedding) + 1.0) / 2.0
                    if similarity > 0.45:
                        current = scored.get(candidate.id, (0.0, candidate))[0]
                        scored[candidate.id] = (max(current, similarity), candidate)
        except Exception:
            pass

    return [essay for _, essay in sorted(scored.values(), key=lambda item: item[0], reverse=True)[:limit]]


def vote_affinity_posts(current_user_id=None, limit=DEFAULT_SOURCE_LIMIT):
    if not current_user_id:
        return []
    user_upvoted_ids = {
        vote.essay_id for vote in Vote.query
        .filter(Vote.user_id == current_user_id)
        .filter(Vote.value > 0)
        .all()
    }
    if not user_upvoted_ids:
        return []
    similar_user_ids = {
        vote.user_id for vote in Vote.query
        .filter(Vote.essay_id.in_(user_upvoted_ids))
        .filter(Vote.value > 0)
        .filter(Vote.user_id != current_user_id)
        .limit(100)
        .all()
    }
    if not similar_user_ids:
        return []
    rows = (
        Vote.query
        .filter(Vote.user_id.in_(similar_user_ids))
        .filter(Vote.value > 0)
        .filter(~Vote.essay_id.in_(user_upvoted_ids))
        .order_by(Vote.created_at.desc())
        .limit(limit * 3)
        .all()
    )
    counts = Counter(row.essay_id for row in rows)
    essays = []
    for essay_id, _ in counts.most_common(limit):
        essay = Essay.query.get(essay_id)
        if essay:
            essays.append(essay)
    return essays


def comment_development_posts(limit=DEFAULT_SOURCE_LIMIT):
    essays = Essay.query.order_by(Essay.created_at.desc()).limit(500).all()
    scored = []
    for essay in essays:
        comments = list(essay.comments)
        if not comments:
            continue
        reply_count = sum(1 for comment in comments if comment.parent_id)
        score = len(comments) + reply_count + sum(max(0, comment.score) for comment in comments)
        avg_len = sum(len(comment.content or '') for comment in comments) / len(comments)
        if avg_len >= 50:
            score += 2
        if score > 0:
            scored.append((score, essay))
    scored.sort(key=lambda item: (item[0], item[1].created_at), reverse=True)
    return [essay for _, essay in scored[:limit]]


def policy_posts(limit=DEFAULT_SOURCE_LIMIT):
    proposal_ids = [row.essay_id for row in PolicyProposal.query.limit(limit * 2).all()]
    query = Essay.query.filter(Essay.is_policy_proposal.is_(True))
    if proposal_ids:
        query = query.union(Essay.query.filter(Essay.id.in_(proposal_ids)))
    return query.order_by(Essay.created_at.desc()).limit(limit).all()


def temporal_gravity_posts(limit=DEFAULT_SOURCE_LIMIT):
    current_year = datetime.utcnow().year
    return (
        Essay.query
        .filter(Essay.target_calendar_year >= current_year - 1)
        .order_by(Essay.target_calendar_year.asc(), Essay.created_at.desc())
        .limit(limit)
        .all()
    )


def exploration_posts(limit=DEFAULT_SOURCE_LIMIT):
    essays = Essay.query.order_by(Essay.created_at.desc()).limit(1000).all()
    country_counts = Counter(essay.country_code or 'GLOBAL' for essay in essays)
    bucket_counts = Counter(year_bucket(essay.target_calendar_year) for essay in essays)
    category_counts = Counter(
        essay.policy_proposal.category if essay.policy_proposal else 'none'
        for essay in essays
    )
    scored = []
    for essay in essays:
        country = essay.country_code or 'GLOBAL'
        bucket = year_bucket(essay.target_calendar_year)
        category = essay.policy_proposal.category if essay.policy_proposal else 'none'
        substance = min(1.0, len(essay.content or '') / 700.0)
        scarcity = (
            1.0 / max(country_counts[country], 1)
            + 1.0 / max(bucket_counts[bucket], 1)
            + 1.0 / max(category_counts[category], 1)
        )
        scored.append((scarcity + substance, essay))
    scored.sort(key=lambda item: (item[0], item[1].created_at), reverse=True)
    return [essay for _, essay in scored[:limit]]


def generate_recommendation_candidates(current_user_id=None, query=None, country_code=None, year=None, limit=DEFAULT_SOURCE_LIMIT):
    candidates = {}
    source_counts = {}
    if query:
        essays = search_context_posts(query, country_code, year, limit * 3)
        source_counts['search_context_posts'] = len(essays)
        for essay in essays:
            _add_candidate(candidates, essay, 'search_context_posts')
        return candidates, source_counts

    sources = [
        ('recent_posts', recent_posts(limit)),
        ('search_context_posts', search_context_posts(query, country_code, year, limit)),
        ('semantic_neighbor_posts', semantic_neighbor_posts(current_user_id, query, limit)),
        ('vote_affinity_posts', vote_affinity_posts(current_user_id, limit)),
        ('comment_development_posts', comment_development_posts(limit)),
        ('policy_posts', policy_posts(limit)),
        ('temporal_gravity_posts', temporal_gravity_posts(limit)),
        ('exploration_posts', exploration_posts(limit)),
    ]

    for source_name, essays in sources:
        source_counts[source_name] = len(essays)
        for essay in essays:
            _add_candidate(candidates, essay, source_name)

    return candidates, source_counts

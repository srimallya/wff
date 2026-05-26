from collections import Counter
from datetime import datetime
import json

from backend.models import Essay, User, Vote, db


QUERY_EXPANSIONS = {
    'green': ['climate', 'environment', 'sustainability'],
}


def calculate_age_from_birthdate(birthdate_str):
    try:
        birth_date = datetime.strptime(birthdate_str, '%Y-%m-%d')
        today = datetime.now()
        age = today.year - birth_date.year
        if (today.month, today.day) < (birth_date.month, birth_date.day):
            age -= 1
        return age
    except Exception:
        return None


def essay_management_status(essay, current_user_id=None):
    from datetime import timedelta

    post_management_window = timedelta(days=30)
    is_owner = bool(current_user_id and essay.user_id == current_user_id)
    within_window = bool(essay.created_at and datetime.utcnow() - essay.created_at <= post_management_window)
    edit_count = essay.edit_count or 0
    return {
        'is_owner': is_owner,
        'can_edit': is_owner and within_window and edit_count < 1,
        'can_delete': is_owner and within_window,
        'edit_count': edit_count,
        'edited_at': essay.edited_at.isoformat() if essay.edited_at else None,
    }


def essay_to_dict(essay, current_user_id=None):
    user = User.query.get(essay.user_id)
    current_age = calculate_age_from_birthdate(user.birthdate) if user and user.birthdate else None

    user_vote = None
    if current_user_id:
        vote = Vote.query.filter_by(user_id=current_user_id, essay_id=essay.id).first()
        if vote:
            user_vote = vote.value

    return {
        'id': essay.id,
        'username': user.username if user else 'Unknown',
        'content': essay.content,
        'country': essay.country or 'Global',
        'country_code': essay.country_code or 'GLOBAL',
        'look_ahead_months': essay.look_ahead_months,
        'target_calendar_year': essay.target_calendar_year,
        'author_current_age': current_age,
        'target_age': essay.target_age,
        'created_at': essay.created_at.isoformat(),
        **essay_management_status(essay, current_user_id),
        'is_policy_proposal': essay.is_policy_proposal,
        'upvotes': essay.upvotes,
        'downvotes': essay.downvotes,
        'score': essay.score,
        'user_vote': user_vote,
        'comment_count': len(essay.comments),
    }


def search_terms_for_query(query):
    normalized_query = (query or '').lower().strip()
    terms = {normalized_query}

    for token in normalized_query.split():
        terms.update(QUERY_EXPANSIONS.get(token, []))

    return [term for term in terms if len(term) > 1]


def _normalize_country_code(country_code):
    if not country_code:
        return None
    normalized = str(country_code).strip().upper()
    return normalized or None


def _normalize_year(year):
    if year in (None, ''):
        return None
    try:
        return int(year)
    except (TypeError, ValueError):
        return None


def _normalize_limit(limit):
    try:
        parsed = int(limit)
    except (TypeError, ValueError):
        parsed = 20
    return max(1, min(parsed, 100))


def _country_facets(essays):
    countries = {}
    counts = Counter()
    for essay in essays:
        code = essay.country_code or 'GLOBAL'
        countries[code] = essay.country or 'Global'
        counts[code] += 1

    return [
        {
            'country_code': code,
            'country': countries[code],
            'count': count,
        }
        for code, count in sorted(counts.items(), key=lambda item: (-item[1], countries[item[0]], item[0]))
    ]


def _year_facets(essays):
    counts = Counter(essay.target_calendar_year for essay in essays if essay.target_calendar_year is not None)
    return [
        {
            'year': year,
            'count': count,
        }
        for year, count in sorted(counts.items())
    ]


def _semantic_matches(query, essays, existing_ids, min_similarity=0.25):
    try:
        import numpy as np
        from backend.services.embedding import get_embedding, embedding_from_json, cosine_similarity

        query_emb = np.array(get_embedding(query), dtype=np.float32)
    except Exception:
        return []

    scored = []
    for essay in essays:
        if essay.id in existing_ids:
            continue
        emb = None
        if essay.embedding_json:
            try:
                emb = embedding_from_json(essay.embedding_json)
            except Exception:
                emb = None
        if emb is None:
            try:
                emb = np.array(get_embedding(essay.content), dtype=np.float32)
                essay.embedding_json = json.dumps(emb.tolist())
            except Exception:
                continue
        try:
            similarity = cosine_similarity(query_emb, emb)
            if similarity >= min_similarity:
                scored.append((similarity, essay))
        except Exception:
            continue

    if scored:
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()

    scored.sort(key=lambda item: (item[0], item[1].created_at), reverse=True)
    return [essay for _, essay in scored]


def _query_matched_essays(query):
    essays = Essay.query.order_by(Essay.created_at.desc()).all()
    normalized_query = (query or '').strip()
    if not normalized_query:
        return essays

    search_terms = search_terms_for_query(normalized_query)
    lexical_matches = [
        essay for essay in essays
        if any(term in (essay.content or '').lower() for term in search_terms)
    ]
    lexical_ids = {essay.id for essay in lexical_matches}
    semantic_matches = _semantic_matches(normalized_query, essays, lexical_ids)

    return lexical_matches + semantic_matches


def search_essays_hierarchical(query, country_code=None, year=None, current_user_id=None, limit=20):
    normalized_query = (query or '').strip()
    normalized_country_code = _normalize_country_code(country_code)
    normalized_year = _normalize_year(year)
    normalized_limit = _normalize_limit(limit)

    query_matches = _query_matched_essays(normalized_query)
    country_facets = _country_facets(query_matches)

    country_matches = query_matches
    if normalized_country_code:
        country_matches = [
            essay for essay in query_matches
            if (essay.country_code or 'GLOBAL').upper() == normalized_country_code
        ]

    year_facets = _year_facets(country_matches)

    final_matches = country_matches
    if normalized_year is not None:
        final_matches = [
            essay for essay in country_matches
            if essay.target_calendar_year == normalized_year
        ]

    limited = final_matches[:normalized_limit]
    return {
        'essays': [essay_to_dict(essay, current_user_id) for essay in limited],
        'total': len(limited),
        'facets': {
            'countries': country_facets,
            'years': year_facets,
        },
        'applied_filters': {
            'query': normalized_query,
            'country_code': normalized_country_code,
            'year': normalized_year,
        },
    }

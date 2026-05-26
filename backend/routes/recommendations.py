from flask import Blueprint, jsonify, request

from backend.services.recommendation_candidates import generate_recommendation_candidates
from backend.services.recommendation_features import RecommendationContext
from backend.services.recommendation_serving import build_recommendation_feed
from backend.services.search_service import essay_to_dict


recommendations_bp = Blueprint('wff_recommendations', __name__)


def _bool_arg(value):
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _int_arg(name, default=None):
    raw = request.args.get(name)
    if raw in (None, ''):
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _query_embedding(query):
    if not query:
        return None
    try:
        import numpy as np
        from backend.services.embedding import get_embedding

        return np.array(get_embedding(query), dtype=np.float32)
    except Exception:
        return None


@recommendations_bp.route('/feed', methods=['GET'])
def recommendation_feed():
    query = (request.args.get('query') or '').strip()
    country_code = (request.args.get('country_code') or '').strip().upper() or None
    year = _int_arg('year')
    current_user_id = _int_arg('current_user_id')
    limit = max(1, min(_int_arg('limit', 20), 50))
    offset = max(0, _int_arg('offset', 0))
    debug_enabled = _bool_arg(request.args.get('debug'))

    candidates, source_counts = generate_recommendation_candidates(
        current_user_id=current_user_id,
        query=query,
        country_code=country_code,
        year=year,
        limit=max(limit + offset, 80),
    )
    context = RecommendationContext(
        current_user_id=current_user_id,
        query=query,
        country_code=country_code,
        year=year,
        search_mode=bool(query),
        query_embedding=_query_embedding(query),
        source_map={essay_id: payload['sources'] for essay_id, payload in candidates.items()},
    )
    served, debug = build_recommendation_feed(
        candidates,
        source_counts,
        context,
        limit=limit,
        offset=offset,
    )
    response = {
        'essays': [essay_to_dict(item.essay, current_user_id) for item in served],
        'total': len(served),
    }
    if debug_enabled:
        response['debug'] = debug
    return jsonify(response)

from flask import Blueprint, jsonify, request

from backend.models import NowStory, NowStoryVote, User, db
from backend.services.now_pipeline import refresh_now_stories, story_to_dict
from backend.services.now_search import search_now_stories
from backend.services.realtime import emit_global


now_bp = Blueprint('wff_now', __name__)


def _current_user_id_from_request():
    try:
        return int(request.args.get('current_user_id') or 0) or None
    except (TypeError, ValueError):
        return None


@now_bp.route('', methods=['GET'])
def list_now_stories():
    return jsonify(search_now_stories(
        query=request.args.get('q', ''),
        region_code=request.args.get('region_code'),
        hours_back=request.args.get('hours_back'),
        time_start=request.args.get('time_start'),
        time_end=request.args.get('time_end'),
        current_user_id=_current_user_id_from_request(),
        limit=request.args.get('limit', 30),
    ))


@now_bp.route('/search', methods=['POST'])
def search_now():
    data = request.get_json(silent=True) or {}
    try:
        current_user_id = int(data.get('current_user_id')) if data.get('current_user_id') else None
    except (TypeError, ValueError):
        current_user_id = None
    return jsonify(search_now_stories(
        query=data.get('query', ''),
        region_code=data.get('region_code'),
        hours_back=data.get('hours_back'),
        time_start=data.get('time_start'),
        time_end=data.get('time_end'),
        current_user_id=current_user_id,
        limit=data.get('limit', 30),
    ))


@now_bp.route('/refresh', methods=['POST'])
def refresh_now():
    data = request.get_json(silent=True) or {}
    limit = data.get('limit_per_source', 8)
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 8
    limit = max(1, min(limit, 20))
    result = refresh_now_stories(limit_per_source=limit, notify=bool(data.get('notify', True)))
    return jsonify(result)


@now_bp.route('/<int:story_id>', methods=['GET'])
def get_now_story(story_id):
    story = NowStory.query.get_or_404(story_id)
    return jsonify(story_to_dict(story, _current_user_id_from_request()))


@now_bp.route('/<int:story_id>/vote', methods=['POST'])
def vote_now_story(story_id):
    data = request.get_json(silent=True) or {}
    username = data.get('username')
    value = data.get('value')
    if value not in [1, -1, 0]:
        return jsonify({'error': 'Vote value must be 1, -1, or 0'}), 400

    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404

    story = NowStory.query.get_or_404(story_id)
    existing = NowStoryVote.query.filter_by(user_id=user.id, story_id=story.id).first()

    if value == 0:
        if existing:
            db.session.delete(existing)
            db.session.commit()
    elif existing:
        existing.value = value
        db.session.commit()
    else:
        db.session.add(NowStoryVote(user_id=user.id, story_id=story.id, value=value))
        db.session.commit()

    payload = {
        'story_id': story.id,
        'score': story.score,
        'upvotes': story.upvotes,
        'downvotes': story.downvotes,
        'user_vote': None if value == 0 else value,
    }
    emit_global('now_story_voted', payload)
    return jsonify(payload)

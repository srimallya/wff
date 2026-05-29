from flask import Blueprint, request, jsonify
from backend.models import db, Essay, User, Vote, Comment, CommentVote, Notification
from datetime import datetime, timedelta
import json
from sqlalchemy import func
from backend.routes.auth import require_current_user
from backend.services.realtime import emit_global
from backend.services.search_service import (
    calculate_age_from_birthdate,
    essay_to_dict,
    search_essays_hierarchical,
)

essays_bp = Blueprint('wff_essays', __name__)
POST_MANAGEMENT_WINDOW = timedelta(days=30)

def comment_to_dict(comment, current_user_id=None):
    user_vote = None
    if current_user_id:
        vote = CommentVote.query.filter_by(user_id=current_user_id, comment_id=comment.id).first()
        if vote:
            user_vote = vote.value
    return {
        'id': comment.id,
        'essay_id': comment.essay_id,
        'parent_id': comment.parent_id,
        'username': comment.user.username if comment.user else 'Unknown',
        'content': comment.content,
        'created_at': comment.created_at.isoformat(),
        'upvotes': comment.upvotes,
        'downvotes': comment.downvotes,
        'score': comment.score,
        'user_vote': user_vote,
    }

def notification_message(actor, kind):
    if kind == 'comment_reply':
        return f'{actor.username} replied to your comment'
    return f'{actor.username} commented on your post'

def add_comment_notifications(comment, essay, actor, parent=None):
    recipients = []

    if parent and parent.user_id != actor.id:
        recipients.append((parent.user_id, 'comment_reply'))

    if essay.user_id != actor.id and (not parent or essay.user_id != parent.user_id):
        recipients.append((essay.user_id, 'post_comment'))

    for recipient_id, kind in recipients:
        db.session.add(Notification(
            recipient_id=recipient_id,
            actor_id=actor.id,
            kind=kind,
            essay_id=essay.id,
            comment_id=comment.id,
            parent_comment_id=parent.id if parent else None,
            message=notification_message(actor, kind),
        ))

@essays_bp.route('', methods=['GET'])
def get_essays():
    year = request.args.get('year', type=int)
    country_code = request.args.get('country_code', type=str)
    username = request.args.get('username', type=str)
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    current_user_id = request.args.get('current_user_id', type=int)

    query = Essay.query

    if country_code:
        query = query.filter(Essay.country_code == country_code.strip().upper())

    if year:
        query = query.filter(Essay.target_calendar_year == year)
        essays = query.order_by(Essay.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
        return jsonify({
            'essays': [essay_to_dict(e, current_user_id) for e in essays.items],
            'total': essays.total,
            'pages': essays.pages,
            'current_page': essays.page
        })

    if username:
        user = User.query.filter_by(username=username).first()
        if user:
            query = query.filter(Essay.user_id == user.id)
        essays = query.order_by(Essay.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
        return jsonify({
            'essays': [essay_to_dict(e, current_user_id) for e in essays.items],
            'total': essays.total,
            'pages': essays.pages,
            'current_page': essays.page
        })

    essays = query.order_by(Essay.created_at.desc()).limit(10).all()
    return jsonify({
        'essays': [essay_to_dict(e, current_user_id) for e in essays],
        'total': len(essays),
        'pages': 1,
        'current_page': 1
    })

@essays_bp.route('/year-counts', methods=['GET'])
def get_year_counts():
    current_year = datetime.now().year
    start_year = request.args.get('start_year', current_year, type=int)
    end_year = request.args.get('end_year', current_year + 100, type=int)
    country_code = request.args.get('country_code', type=str)

    if end_year < start_year:
        start_year, end_year = end_year, start_year

    query = (
        db.session.query(Essay.target_calendar_year, func.count(Essay.id))
        .filter(Essay.target_calendar_year >= start_year)
        .filter(Essay.target_calendar_year <= end_year)
    )
    if country_code:
        query = query.filter(Essay.country_code == country_code.strip().upper())

    rows = query.group_by(Essay.target_calendar_year).all()
    counts_by_year = {year: count for year, count in rows}
    counts = [
        {'year': year, 'count': counts_by_year.get(year, 0)}
        for year in range(start_year, end_year + 1)
    ]

    return jsonify({
        'counts': counts,
        'max_count': max((item['count'] for item in counts), default=0),
        'start_year': start_year,
        'end_year': end_year
    })

@essays_bp.route('/<int:essay_id>', methods=['GET'])
def get_essay(essay_id):
    essay = Essay.query.get_or_404(essay_id)
    current_user_id = request.args.get('current_user_id', type=int)
    return jsonify(essay_to_dict(essay, current_user_id))


@essays_bp.route('', methods=['POST'])
def create_essay():
    data = request.get_json()

    if 'look_ahead_months' not in data:
        return jsonify({'error': 'look_ahead_months is required.'}), 400

    content = data.get('content', '')
    if not content or len(content) < 50:
        return jsonify({'error': 'Content must be at least 50 characters'}), 400
    if len(content) > 5000:
        return jsonify({'error': 'Content must be at most 5000 characters'}), 400

    username = data.get('username')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'error': 'Valid user required'}), 400

    if user.is_guest:
        return jsonify({'error': 'Guests cannot post.'}), 403
    if not user.is_bengali:
        return jsonify({'error': 'Only registered writing accounts can post.'}), 403
    if not user.birthdate:
        return jsonify({'error': 'Birthdate required to post.'}), 403

    look_ahead_months = data.get('look_ahead_months')
    country = str(data.get('country') or 'Global').strip()[:80] or 'Global'
    country_code = str(data.get('country_code') or 'GLOBAL').strip().upper()[:8] or 'GLOBAL'
    current_year = datetime.now().year
    target_calendar_year = current_year + (look_ahead_months // 12)

    current_age = calculate_age_from_birthdate(user.birthdate)
    target_age = None
    if current_age:
        target_age = current_age + (look_ahead_months // 12)

    essay = Essay(
        user_id=user.id,
        content=content,
        country=country,
        country_code=country_code,
        look_ahead_months=look_ahead_months,
        target_calendar_year=target_calendar_year,
        author_age_at_writing=current_age,
        target_age=target_age,
        is_policy_proposal=data.get('is_policy_proposal', False)
    )

    db.session.add(essay)
    db.session.commit()

    # Generate semantic embedding asynchronously (don't fail creation if this errors)
    try:
        from backend.services.embedding import get_embedding
        essay.embedding_json = json.dumps(get_embedding(content))
        db.session.commit()
    except Exception as e:
        import logging
        logging.warning(f"Embedding generation failed for essay {essay.id}: {e}")

    payload = essay_to_dict(essay, user.id)
    emit_global('essay_created', {'essay': payload})
    return jsonify(payload), 201

@essays_bp.route('/<int:essay_id>', methods=['PATCH'])
def update_essay(essay_id):
    user = require_current_user()
    essay = Essay.query.get_or_404(essay_id)

    if essay.user_id != user.id:
        return jsonify({'error': 'You can only edit your own post.'}), 403
    if datetime.utcnow() - essay.created_at > POST_MANAGEMENT_WINDOW:
        return jsonify({'error': 'Posts can only be edited within 30 days of posting.'}), 403
    if (essay.edit_count or 0) >= 1:
        return jsonify({'error': 'This post has already been edited once.'}), 403

    data = request.get_json() or {}
    content = str(data.get('content') or '').strip()
    if not content or len(content) < 50:
        return jsonify({'error': 'Content must be at least 50 characters'}), 400
    if len(content) > 5000:
        return jsonify({'error': 'Content must be at most 5000 characters'}), 400

    essay.content = content
    essay.edit_count = (essay.edit_count or 0) + 1
    essay.edited_at = datetime.utcnow()
    essay.embedding_json = None
    db.session.commit()

    try:
        from backend.services.embedding import get_embedding
        essay.embedding_json = json.dumps(get_embedding(content))
        db.session.commit()
    except Exception as e:
        import logging
        logging.warning(f"Embedding generation failed for edited essay {essay.id}: {e}")

    payload = essay_to_dict(essay, user.id)
    emit_global('essay_updated', {'essay': payload})
    return jsonify(payload)

@essays_bp.route('/<int:essay_id>', methods=['DELETE'])
def delete_essay(essay_id):
    user = require_current_user()
    essay = Essay.query.get_or_404(essay_id)

    if essay.user_id != user.id:
        return jsonify({'error': 'You can only delete your own post.'}), 403
    if datetime.utcnow() - essay.created_at > POST_MANAGEMENT_WINDOW:
        return jsonify({'error': 'Posts can only be deleted within 30 days of posting.'}), 403

    db.session.delete(essay)
    db.session.commit()
    emit_global('essay_deleted', {'essay_id': essay_id, 'user_id': user.id})
    return jsonify({'deleted': True, 'essay_id': essay_id})

@essays_bp.route('/search', methods=['POST'])
def search_essays():
    data = request.get_json(silent=True) or {}
    query = data.get('query', '').strip()
    try:
        limit = int(data.get('limit', 20))
    except (TypeError, ValueError):
        limit = 20
    try:
        current_user_id = int(data.get('current_user_id')) if data.get('current_user_id') else None
    except (TypeError, ValueError):
        current_user_id = None

    return jsonify(search_essays_hierarchical(
        query=query,
        country_code=data.get('country_code'),
        year=data.get('year'),
        current_user_id=current_user_id,
        limit=limit,
    ))

@essays_bp.route('/<int:essay_id>/vote', methods=['POST'])
def vote_essay(essay_id):
    data = request.get_json()
    username = data.get('username')
    value = data.get('value')

    if value not in [1, -1, 0]:
        return jsonify({'error': 'Vote value must be 1 (upvote), -1 (downvote), or 0 (remove)'}), 400

    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404

    essay = Essay.query.get_or_404(essay_id)

    existing = Vote.query.filter_by(user_id=user.id, essay_id=essay.id).first()

    if value == 0:
        if existing:
            db.session.delete(existing)
            db.session.commit()
        return jsonify({'score': essay.score, 'upvotes': essay.upvotes, 'downvotes': essay.downvotes, 'user_vote': None})

    if existing:
        existing.value = value
    else:
        vote = Vote(user_id=user.id, essay_id=essay.id, value=value)
        db.session.add(vote)

    db.session.commit()

    return jsonify({
        'score': essay.score,
        'upvotes': essay.upvotes,
        'downvotes': essay.downvotes,
        'user_vote': value
    })

@essays_bp.route('/<int:essay_id>/comments', methods=['GET'])
def get_comments(essay_id):
    Essay.query.get_or_404(essay_id)
    current_user_id = request.args.get('current_user_id', type=int)
    comments = (
        Comment.query
        .filter_by(essay_id=essay_id, parent_id=None)
        .order_by(Comment.created_at.asc())
        .all()
    )
    return jsonify({
        'comments': [
            {
                **comment_to_dict(comment, current_user_id),
                'replies': [
                    comment_to_dict(reply, current_user_id)
                    for reply in sorted(comment.replies, key=lambda item: item.created_at)
                ],
            }
            for comment in comments
        ],
        'total': len(comments),
    })

@essays_bp.route('/<int:essay_id>/comments', methods=['POST'])
def create_comment(essay_id):
    data = request.get_json() or {}
    essay = Essay.query.get_or_404(essay_id)
    username = data.get('username')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'error': 'Valid user required'}), 400

    content = str(data.get('content') or '').strip()
    if len(content) < 2:
        return jsonify({'error': 'Comment must be at least 2 characters'}), 400
    if len(content) > 5000:
        return jsonify({'error': 'Comment must be at most 5000 characters'}), 400

    parent_id = data.get('parent_id')
    parent = None
    if parent_id:
        parent = Comment.query.filter_by(id=parent_id, essay_id=essay.id).first()
        if not parent:
            return jsonify({'error': 'Parent comment not found'}), 404
        if parent.parent_id:
            return jsonify({'error': 'Only one level of replies is supported'}), 400

    comment = Comment(essay_id=essay.id, user_id=user.id, parent_id=parent.id if parent else None, content=content)
    db.session.add(comment)
    db.session.flush()
    add_comment_notifications(comment, essay, user, parent)
    db.session.commit()
    return jsonify(comment_to_dict(comment, user.id)), 201

@essays_bp.route('/comments/<int:comment_id>/vote', methods=['POST'])
def vote_comment(comment_id):
    data = request.get_json() or {}
    username = data.get('username')
    value = data.get('value')
    if value not in [1, -1, 0]:
        return jsonify({'error': 'Vote value must be 1, -1, or 0'}), 400

    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404

    comment = Comment.query.get_or_404(comment_id)
    existing = CommentVote.query.filter_by(user_id=user.id, comment_id=comment.id).first()

    if value == 0:
        if existing:
            db.session.delete(existing)
            db.session.commit()
        return jsonify({'score': comment.score, 'upvotes': comment.upvotes, 'downvotes': comment.downvotes, 'user_vote': None})

    if existing:
        existing.value = value
    else:
        db.session.add(CommentVote(user_id=user.id, comment_id=comment.id, value=value))
    db.session.commit()

    return jsonify({
        'score': comment.score,
        'upvotes': comment.upvotes,
        'downvotes': comment.downvotes,
        'user_vote': value,
    })

from flask import Blueprint, request, jsonify
from backend.models import db, Essay, User, Vote, Comment, CommentVote
from datetime import datetime
import json
from sqlalchemy import func
from backend.services.realtime import emit_global

essays_bp = Blueprint('wff_essays', __name__)

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
    except:
        return None

def essay_to_dict(e, current_user_id=None):
    user = User.query.get(e.user_id)
    current_age = calculate_age_from_birthdate(user.birthdate) if user and user.birthdate else None

    user_vote = None
    if current_user_id:
        vote = Vote.query.filter_by(user_id=current_user_id, essay_id=e.id).first()
        if vote:
            user_vote = vote.value

    return {
        'id': e.id,
        'username': user.username if user else 'Unknown',
        'content': e.content,
        'country': e.country or 'Global',
        'country_code': e.country_code or 'GLOBAL',
        'look_ahead_months': e.look_ahead_months,
        'target_calendar_year': e.target_calendar_year,
        'author_current_age': current_age,
        'target_age': e.target_age,
        'created_at': e.created_at.isoformat(),
        'is_policy_proposal': e.is_policy_proposal,
        'upvotes': e.upvotes,
        'downvotes': e.downvotes,
        'score': e.score,
        'user_vote': user_vote,
        'comment_count': len(e.comments),
    }

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

def search_terms_for_query(query):
    normalized_query = query.lower().strip()
    terms = {normalized_query}

    for token in normalized_query.split():
        terms.update(QUERY_EXPANSIONS.get(token, []))

    return [term for term in terms if len(term) > 1]

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

    if end_year < start_year:
        start_year, end_year = end_year, start_year

    rows = (
        db.session.query(Essay.target_calendar_year, func.count(Essay.id))
        .filter(Essay.target_calendar_year >= start_year)
        .filter(Essay.target_calendar_year <= end_year)
        .group_by(Essay.target_calendar_year)
        .all()
    )
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


@essays_bp.route('/graph', methods=['GET'])
def get_graph():
    from backend.models import Conversation, MessageRequest

    nodes = {}
    edges = []

    def add_node(node_id, node_type, label, **extra):
        nodes[node_id] = {
            'id': node_id,
            'type': node_type,
            'label': label,
            **extra,
        }

    def add_edge(source, target, relation, **extra):
        edges.append({
            'source': source,
            'target': target,
            'relation': relation,
            **extra,
        })

    users = User.query.order_by(User.id.asc()).all()
    for user in users:
        add_node(f'user:{user.id}', 'user', user.username, can_post=bool(user.is_bengali and not user.is_guest and user.birthdate and user.password_hash))

    essays = Essay.query.order_by(Essay.created_at.desc()).limit(120).all()
    essay_ids = [essay.id for essay in essays]
    for essay in essays:
        essay_node = f'post:{essay.id}'
        country_code = essay.country_code or 'GLOBAL'
        country_label = essay.country or 'Global'
        country_node = f'country:{country_code}'
        year_node = f'year:{essay.target_calendar_year}'
        add_node(essay_node, 'post', (essay.content or '')[:80], score=essay.score, created_at=essay.created_at.isoformat())
        add_node(country_node, 'country', country_label, code=country_code)
        add_node(year_node, 'year', str(essay.target_calendar_year))
        add_edge(f'user:{essay.user_id}', essay_node, 'wrote')
        add_edge(essay_node, country_node, 'country')
        add_edge(essay_node, year_node, 'year')

    comments = []
    if essay_ids:
        comments = (
            Comment.query
            .filter(Comment.essay_id.in_(essay_ids))
            .order_by(Comment.created_at.asc())
            .limit(240)
            .all()
        )
    for comment in comments:
        comment_node = f'comment:{comment.id}'
        add_node(comment_node, 'comment', (comment.content or '')[:70], score=comment.score, created_at=comment.created_at.isoformat())
        add_edge(f'user:{comment.user_id}', comment_node, 'commented')
        if comment.parent_id:
            add_edge(comment_node, f'comment:{comment.parent_id}', 'replied_to')
        else:
            add_edge(comment_node, f'post:{comment.essay_id}', 'on_post')

    conversations = Conversation.query.order_by(Conversation.updated_at.desc()).limit(120).all()
    for conversation in conversations:
        add_edge(f'user:{conversation.user_one_id}', f'user:{conversation.user_two_id}', 'friends', conversation_id=conversation.id)

    active_requests = MessageRequest.query.filter_by(status='active').limit(120).all()
    for message_request in active_requests:
        add_edge(f'user:{message_request.sender_id}', f'user:{message_request.receiver_id}', 'friends', request_id=message_request.id)

    return jsonify({
        'nodes': list(nodes.values()),
        'edges': edges,
        'counts': {
            'users': sum(1 for node in nodes.values() if node['type'] == 'user'),
            'posts': sum(1 for node in nodes.values() if node['type'] == 'post'),
            'comments': sum(1 for node in nodes.values() if node['type'] == 'comment'),
            'countries': sum(1 for node in nodes.values() if node['type'] == 'country'),
            'years': sum(1 for node in nodes.values() if node['type'] == 'year'),
            'relations': len(edges),
        },
    })


@essays_bp.route('', methods=['POST'])
def create_essay():
    data = request.get_json()

    if 'look_ahead_months' not in data:
        return jsonify({'error': 'look_ahead_months is required.'}), 400

    content = data.get('content', '')
    if not content or len(content) < 50:
        return jsonify({'error': 'Content must be at least 50 characters'}), 400
    if len(content) > 2000:
        return jsonify({'error': 'Content must be at most 2000 characters'}), 400

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

    if not query:
        return jsonify({'essays': [], 'total': 0})

    search_terms = search_terms_for_query(query)
    essays = Essay.query.all()
    lexical_matches = [
        essay for essay in essays
        if any(term in essay.content.lower() for term in search_terms)
    ]

    if lexical_matches:
        lexical_matches.sort(key=lambda essay: essay.created_at, reverse=True)
        top = [essay_to_dict(e, current_user_id) for e in lexical_matches[:limit]]
        return jsonify({'essays': top, 'total': len(top)})

    try:
        import numpy as np
        from backend.services.embedding import get_embedding, embedding_from_json, cosine_similarity
        query_emb = np.array(get_embedding(query), dtype=np.float32)
    except Exception as e:
        return jsonify({'error': f'Search unavailable: {str(e)}'}), 503

    scored = []

    for essay in essays:
        if essay.embedding_json:
            emb = embedding_from_json(essay.embedding_json)
            if emb is not None:
                sim = cosine_similarity(query_emb, emb)
                scored.append((sim, essay))
        else:
            # Fallback: generate embedding on-the-fly if missing
            try:
                emb = np.array(get_embedding(essay.content), dtype=np.float32)
                sim = cosine_similarity(query_emb, emb)
                scored.append((sim, essay))
                # Cache it
                essay.embedding_json = json.dumps(emb.tolist())
                db.session.commit()
            except Exception:
                pass

    scored.sort(key=lambda x: x[0], reverse=True)
    top = [essay_to_dict(e, current_user_id) for _, e in scored[:limit]]

    return jsonify({'essays': top, 'total': len(top)})

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
    if len(content) > 1000:
        return jsonify({'error': 'Comment must be at most 1000 characters'}), 400

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

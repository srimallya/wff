from backend.models import Comment, Conversation, Essay, MessageRequest, User


def build_recommendation_graph(post_limit=500, comment_limit=2000):
    """Build the internal relationship graph used by ranking.

    This is intentionally not a public API response. It is a backend feature
    source for recommendation and ranking jobs.
    """
    nodes = {}
    edges = []

    def add_node(node_id, node_type, label, **extra):
        nodes[node_id] = {
            'id': node_id,
            'type': node_type,
            'label': label,
            **extra,
        }

    def add_edge(source, target, relation, weight=1.0, **extra):
        edges.append({
            'source': source,
            'target': target,
            'relation': relation,
            'weight': weight,
            **extra,
        })

    users = User.query.order_by(User.id.asc()).all()
    for user in users:
        add_node(
            f'user:{user.id}',
            'user',
            user.username,
            can_post=bool(user.is_bengali and not user.is_guest and user.birthdate and user.password_hash),
        )

    essays = Essay.query.order_by(Essay.created_at.desc()).limit(post_limit).all()
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
        add_edge(f'user:{essay.user_id}', essay_node, 'wrote', weight=3.0)
        add_edge(essay_node, country_node, 'country', weight=1.0)
        add_edge(essay_node, year_node, 'year', weight=1.0)

    comments = []
    if essay_ids:
        comments = (
            Comment.query
            .filter(Comment.essay_id.in_(essay_ids))
            .order_by(Comment.created_at.asc())
            .limit(comment_limit)
            .all()
        )
    for comment in comments:
        comment_node = f'comment:{comment.id}'
        add_node(comment_node, 'comment', (comment.content or '')[:70], score=comment.score, created_at=comment.created_at.isoformat())
        add_edge(f'user:{comment.user_id}', comment_node, 'commented', weight=2.0)
        if comment.parent_id:
            add_edge(comment_node, f'comment:{comment.parent_id}', 'replied_to', weight=2.5)
        else:
            add_edge(comment_node, f'post:{comment.essay_id}', 'on_post', weight=2.0)

    conversations = Conversation.query.order_by(Conversation.updated_at.desc()).limit(500).all()
    for conversation in conversations:
        add_edge(f'user:{conversation.user_one_id}', f'user:{conversation.user_two_id}', 'connected', weight=4.0, conversation_id=conversation.id)
        add_edge(f'user:{conversation.user_two_id}', f'user:{conversation.user_one_id}', 'connected', weight=4.0, conversation_id=conversation.id)

    active_requests = MessageRequest.query.filter_by(status='active').limit(500).all()
    for message_request in active_requests:
        add_edge(f'user:{message_request.sender_id}', f'user:{message_request.receiver_id}', 'connected', weight=4.0, request_id=message_request.id)
        add_edge(f'user:{message_request.receiver_id}', f'user:{message_request.sender_id}', 'connected', weight=4.0, request_id=message_request.id)

    return {
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
    }

from flask import Blueprint, jsonify, request

from backend.models import Notification, PushSubscription, db
from backend.routes.auth import require_current_user
from backend.services.account_cleanup import can_use_private_features
from backend.services.notifications import vapid_public_key, web_push_configured

notifications_bp = Blueprint('wff_notifications', __name__)


def notification_to_dict(notification):
    actor = notification.actor
    return {
        'id': notification.id,
        'kind': notification.kind,
        'message': notification.message,
        'actor_username': actor.username if actor else 'Someone',
        'essay_id': notification.essay_id,
        'comment_id': notification.comment_id,
        'parent_comment_id': notification.parent_comment_id,
        'created_at': notification.created_at.isoformat() if notification.created_at else None,
        'read_at': notification.read_at.isoformat() if notification.read_at else None,
        'url': f'/posts/{notification.essay_id}#comment-{notification.comment_id}',
    }


@notifications_bp.route('', methods=['GET'])
def list_notifications():
    user = require_current_user()
    if not can_use_private_features(user):
        return jsonify({'error': 'Notifications require a registered writing account'}), 403

    notifications = (
        Notification.query
        .filter_by(recipient_id=user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(20)
        .all()
    )
    return jsonify({
        'notifications': [notification_to_dict(item) for item in notifications],
        'total': len(notifications),
    })


@notifications_bp.route('/vapid-public-key', methods=['GET'])
def get_vapid_public_key():
    return jsonify({
        'configured': web_push_configured(),
        'public_key': vapid_public_key(),
    })


@notifications_bp.route('/subscriptions', methods=['POST'])
def save_subscription():
    data = request.get_json(silent=True) or {}
    user = require_current_user()
    subscription = data.get('subscription') or {}
    keys = subscription.get('keys') or {}
    endpoint = subscription.get('endpoint')
    p256dh = keys.get('p256dh')
    auth = keys.get('auth')

    if not user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(user):
        return jsonify({'error': 'Notifications require a registered writing account'}), 403
    if not endpoint or not p256dh or not auth:
        return jsonify({'error': 'Valid subscription required'}), 400

    existing = PushSubscription.query.filter_by(endpoint=endpoint).first()
    if not existing:
        existing = PushSubscription(endpoint=endpoint)
        db.session.add(existing)

    existing.user_id = user.id
    existing.p256dh = p256dh
    existing.auth = auth
    db.session.commit()

    return jsonify({'saved': True, 'configured': web_push_configured()})


@notifications_bp.route('/subscriptions', methods=['DELETE'])
def delete_subscription():
    data = request.get_json(silent=True) or {}
    user = require_current_user()
    endpoint = data.get('endpoint')

    if not user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(user):
        return jsonify({'error': 'Notifications require a registered writing account'}), 403

    query = PushSubscription.query.filter_by(user_id=user.id)
    if endpoint:
        query = query.filter_by(endpoint=endpoint)
    deleted = query.delete(synchronize_session=False)
    db.session.commit()

    return jsonify({'deleted': deleted})

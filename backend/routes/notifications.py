from flask import Blueprint, jsonify, request

from backend.models import PushSubscription, User, db
from backend.services.account_cleanup import can_use_private_features
from backend.services.notifications import vapid_public_key, web_push_configured

notifications_bp = Blueprint('wff_notifications', __name__)


def current_user_from_data(data=None):
    data = data or {}
    username = data.get('username') or request.args.get('username')
    if not username:
        return None
    return User.query.filter_by(username=username).first()


@notifications_bp.route('/vapid-public-key', methods=['GET'])
def get_vapid_public_key():
    return jsonify({
        'configured': web_push_configured(),
        'public_key': vapid_public_key(),
    })


@notifications_bp.route('/subscriptions', methods=['POST'])
def save_subscription():
    data = request.get_json(silent=True) or {}
    user = current_user_from_data(data)
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
    user = current_user_from_data(data)
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

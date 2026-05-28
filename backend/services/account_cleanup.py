from datetime import datetime, timedelta

from backend.models import Conversation, MessageRequest, Notification, PushSubscription, User, Vote, db


def can_use_private_features(user):
    return bool(user and user.is_bengali and not user.is_guest and user.birthdate and user.password_hash)


def touch_user(user):
    if not user:
        return
    user.last_seen_at = datetime.utcnow()


def delete_private_user_data(user):
    MessageRequest.query.filter(
        (MessageRequest.sender_id == user.id) | (MessageRequest.receiver_id == user.id)
    ).delete(synchronize_session=False)
    PushSubscription.query.filter_by(user_id=user.id).delete(synchronize_session=False)
    Notification.query.filter(
        (Notification.recipient_id == user.id) | (Notification.actor_id == user.id)
    ).delete(synchronize_session=False)
    Vote.query.filter_by(user_id=user.id).delete(synchronize_session=False)

    conversations = Conversation.query.filter(
        (Conversation.user_one_id == user.id) | (Conversation.user_two_id == user.id)
    ).all()
    for conversation in conversations:
        db.session.delete(conversation)


def scrub_registered_account(user):
    delete_private_user_data(user)
    user.real_username = None
    user.password_hash = None
    user.birthdate = None
    user.is_guest = True
    user.is_bengali = False
    user.security_q1 = None
    user.security_a1_hash = None
    user.security_q2 = None
    user.security_a2_hash = None
    touch_user(user)


def delete_transient_account(user):
    delete_private_user_data(user)
    db.session.delete(user)


def cleanup_inactive_accounts(now=None):
    now = now or datetime.utcnow()
    transient_cutoff = now - timedelta(days=31)
    bengali_cutoff = now - timedelta(days=365)
    changed = False

    users = User.query.all()
    for user in users:
        last_seen = user.last_seen_at or user.created_at
        if not last_seen:
            continue

        if (user.is_guest or not user.is_bengali) and last_seen < transient_cutoff:
            delete_transient_account(user)
            changed = True
            continue

        if user.is_bengali and not user.is_guest and last_seen < bengali_cutoff:
            scrub_registered_account(user)
            changed = True

    if changed:
        db.session.commit()

    return changed

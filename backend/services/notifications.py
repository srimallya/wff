import json
import os
import base64

from backend.models import PushSubscription, User, db

DEFAULT_TTC_WEBAPP_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ttc_webapp')
)
DEFAULT_VAPID_PRIVATE_KEY_FILE = os.path.join(
    DEFAULT_TTC_WEBAPP_ROOT, 'database', 'security', 'vapid_private.pem'
)


def vapid_public_key():
    configured_key = os.environ.get('VAPID_PUBLIC_KEY', '').strip()
    if configured_key:
        return configured_key

    private_key_file = vapid_private_key_file()
    if not private_key_file:
        return ''
    try:
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        from py_vapid import Vapid

        vapid = Vapid.from_file(private_key_file)
        raw_bytes = vapid.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        return base64.urlsafe_b64encode(raw_bytes).rstrip(b'=').decode('ascii')
    except Exception:
        return ''


def vapid_private_key():
    return os.environ.get('VAPID_PRIVATE_KEY', '').strip()


def vapid_private_key_file():
    explicit_path = os.environ.get('VAPID_PRIVATE_KEY_FILE', '').strip()
    if explicit_path and os.path.exists(explicit_path):
        return explicit_path
    if os.path.exists(DEFAULT_VAPID_PRIVATE_KEY_FILE):
        return DEFAULT_VAPID_PRIVATE_KEY_FILE
    return ''


def vapid_claims():
    subject = os.environ.get('VAPID_SUBJECT', 'mailto:admin@example.com').strip()
    return {'sub': subject}


def web_push_configured():
    return bool(vapid_public_key() and (vapid_private_key() or vapid_private_key_file()))


def app_url(path):
    base_path = os.environ.get('WFF_BASE_PATH', '/wff').strip().rstrip('/')
    clean_path = f'/{path.lstrip("/")}'
    return f'{base_path}{clean_path}' if base_path else clean_path


def send_push_notification(recipient_id, title, body, url):
    if not web_push_configured():
        return {'sent': 0, 'skipped': 'vapid_not_configured'}

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        return {'sent': 0, 'skipped': 'pywebpush_not_installed'}

    payload = json.dumps({
        'title': title,
        'body': body[:128],
        'url': url,
    }, ensure_ascii=False)
    sent = 0
    stale = []

    subscriptions = PushSubscription.query.filter_by(user_id=recipient_id).all()
    for subscription in subscriptions:
        subscription_info = {
            'endpoint': subscription.endpoint,
            'keys': {
                'p256dh': subscription.p256dh,
                'auth': subscription.auth,
            },
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=vapid_private_key() or vapid_private_key_file(),
                vapid_claims=vapid_claims(),
            )
            sent += 1
        except WebPushException as exc:
            if getattr(exc.response, 'status_code', None) in [404, 410]:
                stale.append(subscription)

    for subscription in stale:
        db.session.delete(subscription)
    if stale:
        db.session.commit()

    return {'sent': sent, 'removed': len(stale)}


def send_message_notification(recipient_id, sender_username, body, conversation_id):
    return send_push_notification(
        recipient_id=recipient_id,
        title=sender_username,
        body=body,
        url=app_url(f'/messages/{conversation_id}'),
    )


def send_message_request_notification(recipient_id, sender_username, note):
    return send_push_notification(
        recipient_id=recipient_id,
        title=sender_username,
        body=note or 'New message request',
        url=app_url('/profile'),
    )

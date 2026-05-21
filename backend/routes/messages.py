import json
from datetime import datetime

from flask import Blueprint, jsonify, request
from sqlalchemy import and_, or_

from backend.models import ChatroomMessage, Conversation, ConversationRead, Message, MessageRequest, User, UserDeviceKey, db
from backend.services.account_cleanup import can_use_private_features
from backend.services.astr import ASTR_CLIENT_STATE_VERSION, apply_client_packet_transition, create_channel_state, dump_channel_state, load_channel_state, reconcile_channel_state
from backend.services.notifications import send_message_notification, send_message_request_notification
from backend.services.realtime import emit_to_chatroom, emit_to_user

messages_bp = Blueprint('wff_messages', __name__)

ACTIVE_REQUEST_STATUSES = ['pending', 'active']
TERMINAL_REQUEST_STATUSES = ['rejected', 'expired', 'blocked']


def user_summary(user):
    return {
        'id': user.id,
        'username': user.username,
    }


def key_bundle_to_dict(user):
    if not user or not user.identity_public_key:
        return None
    devices = []
    for device in sorted(user.device_keys or [], key=lambda item: item.last_seen_at or item.updated_at or item.created_at, reverse=True):
        try:
            device_identity_key = json.loads(device.identity_public_key)
            device_prekey = json.loads(device.signed_prekey_public_key)
        except (TypeError, ValueError):
            continue
        devices.append({
            'device_id': device.device_id,
            'identity_public_key': device_identity_key,
            'signed_prekey_public_key': device_prekey,
            'signed_prekey_signature': device.signed_prekey_signature,
            'updated_at': device.updated_at.isoformat() if device.updated_at else None,
            'last_seen_at': device.last_seen_at.isoformat() if device.last_seen_at else None,
        })
    try:
        identity_public_key = json.loads(user.identity_public_key)
    except (TypeError, ValueError):
        identity_public_key = None
    try:
        signed_prekey_public_key = json.loads(user.signed_prekey_public_key) if user.signed_prekey_public_key else None
    except (TypeError, ValueError):
        signed_prekey_public_key = None
    return {
        'user_id': user.id,
        'username': user.username,
        'identity_public_key': identity_public_key,
        'signed_prekey_public_key': signed_prekey_public_key,
        'signed_prekey_signature': user.signed_prekey_signature,
        'updated_at': user.key_bundle_updated_at.isoformat() if user.key_bundle_updated_at else None,
        'devices': devices,
    }


def get_current_user(data=None):
    data = data or {}
    username = (
        data.get('username')
        or request.args.get('username')
        or data.get('current_username')
        or request.args.get('current_username')
    )
    if not username:
        return None
    return User.query.filter_by(username=username).first()


def private_features_error():
    return jsonify({'error': 'Messaging requires a registered writing account'}), 403


def conversation_between(user_a_id, user_b_id):
    low_id, high_id = sorted([user_a_id, user_b_id])
    return Conversation.query.filter_by(user_one_id=low_id, user_two_id=high_id).first()


def requests_between(user_a_id, user_b_id):
    return (
        MessageRequest.query
        .filter(or_(
            and_(MessageRequest.sender_id == user_a_id, MessageRequest.receiver_id == user_b_id),
            and_(MessageRequest.sender_id == user_b_id, MessageRequest.receiver_id == user_a_id),
        ))
        .all()
    )


def other_user_for_conversation(conversation, current_user_id):
    return conversation.user_two if conversation.user_one_id == current_user_id else conversation.user_one


def get_read_state(conversation_id, user_id):
    state = ConversationRead.query.filter_by(conversation_id=conversation_id, user_id=user_id).first()
    if state:
        return state
    state = ConversationRead(conversation_id=conversation_id, user_id=user_id)
    db.session.add(state)
    db.session.flush()
    return state


def mark_conversation_read(conversation_id, user_id):
    state = get_read_state(conversation_id, user_id)
    state.last_read_at = datetime.utcnow()
    state.updated_at = datetime.utcnow()


def unread_count_for(conversation_id, user_id):
    state = ConversationRead.query.filter_by(conversation_id=conversation_id, user_id=user_id).first()
    query = Message.query.filter_by(conversation_id=conversation_id).filter(Message.sender_id != user_id)
    if state and state.last_read_at:
        query = query.filter(Message.created_at > state.last_read_at)
    return query.count()


def message_to_dict(message, current_user_id):
    return {
        'id': message.id,
        'sender_username': message.sender.username if message.sender else None,
        'body': message.body,
        'created_at': message.created_at.isoformat(),
        'is_mine': message.sender_id == current_user_id,
        'client_nonce': message.client_nonce,
        'astr': {
            'version': message.astr_version,
            'direction': message.astr_direction,
            'counter': message.astr_counter,
            'epoch': message.astr_epoch,
            'previous_chain_length': message.previous_chain_length,
            'ratchet_public_key': message.ratchet_public_key,
            'sender_state_commitment': message.ratchet_public_key if message.astr_version == ASTR_CLIENT_STATE_VERSION else None,
            'prev_transcript_hash': message.prev_transcript_hash,
            'transcript_hash': message.transcript_hash,
            'ciphertext': message.ciphertext,
            'auth_tag': message.auth_tag,
        } if message.astr_version else None,
    }


def chatroom_message_to_dict(message, current_user_id=None):
    return {
        'id': message.id,
        'sender_username': message.sender.username if message.sender else None,
        'body': message.body,
        'created_at': message.created_at.isoformat(),
        'is_mine': message.sender_id == current_user_id if current_user_id else False,
        'client_nonce': message.client_nonce,
    }


def request_to_dict(message_request, current_user_id):
    other = message_request.receiver if message_request.sender_id == current_user_id else message_request.sender
    direction = 'outgoing' if message_request.sender_id == current_user_id else 'incoming'
    ui_status = f'pending_{direction}' if message_request.status == 'pending' else message_request.status
    return {
        'id': message_request.id,
        'status': ui_status,
        'raw_status': message_request.status,
        'direction': direction,
        'note': message_request.note,
        'other_user': user_summary(other),
        'conversation_id': message_request.conversation_id,
        'created_at': message_request.created_at.isoformat(),
        'updated_at': message_request.updated_at.isoformat(),
    }


def conversation_to_dict(conversation, current_user_id, include_messages=False):
    channel_state = reconcile_channel_state(conversation)
    other = other_user_for_conversation(conversation, current_user_id)
    last_message = (
        Message.query
        .filter_by(conversation_id=conversation.id)
        .order_by(Message.created_at.desc())
        .first()
    )
    data = {
        'id': conversation.id,
        'status': 'active',
        'participants': {
            'one': user_summary(conversation.user_one),
            'two': user_summary(conversation.user_two),
        },
        'key_bundles': {
            str(conversation.user_one_id): key_bundle_to_dict(conversation.user_one),
            str(conversation.user_two_id): key_bundle_to_dict(conversation.user_two),
        },
        'channel': {
            'version': channel_state.get('version'),
            'epoch': channel_state.get('epoch', 1),
            'transcript_hash': channel_state.get('transcript_hash'),
            'counters': channel_state.get('counters') or {},
            'previous_chain_lengths': channel_state.get('previous_chain_lengths') or {},
        },
        'other_user': user_summary(other),
        'unread_count': unread_count_for(conversation.id, current_user_id),
        'last_message': {
            'body': last_message.body or 'New message',
            'created_at': last_message.created_at.isoformat(),
            'is_mine': last_message.sender_id == current_user_id,
        } if last_message else None,
        'created_at': conversation.created_at.isoformat(),
        'updated_at': conversation.updated_at.isoformat(),
    }
    if include_messages:
        data['messages'] = [
            message_to_dict(message, current_user_id)
            for message in sorted(conversation.messages, key=lambda m: m.created_at)
        ]
    return data


@messages_bp.route('/key-bundle', methods=['GET'])
def get_key_bundle():
    current_user = get_current_user()
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()
    return jsonify({'key_bundle': key_bundle_to_dict(current_user)})


@messages_bp.route('/key-bundle', methods=['POST'])
def save_key_bundle():
    data = request.get_json(silent=True) or {}
    current_user = get_current_user(data)
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()

    identity_public_key = data.get('identity_public_key')
    signed_prekey_public_key = data.get('signed_prekey_public_key') or identity_public_key
    signed_prekey_signature = (data.get('signed_prekey_signature') or '').strip()[:256] or None
    device_id = (data.get('device_id') or '').strip()[:64]
    if not isinstance(identity_public_key, dict) or identity_public_key.get('kty') != 'EC':
        return jsonify({'error': 'Valid identity public key required'}), 400
    if not isinstance(signed_prekey_public_key, dict) or signed_prekey_public_key.get('kty') != 'EC':
        return jsonify({'error': 'Valid signed prekey required'}), 400
    if not device_id:
        return jsonify({'error': 'Valid device id required'}), 400

    identity_json = json.dumps(identity_public_key, separators=(',', ':'), sort_keys=True)
    prekey_json = json.dumps(signed_prekey_public_key, separators=(',', ':'), sort_keys=True)
    current_user.identity_public_key = identity_json
    current_user.signed_prekey_public_key = prekey_json
    current_user.signed_prekey_signature = signed_prekey_signature
    current_user.key_bundle_updated_at = datetime.utcnow()
    device = UserDeviceKey.query.filter_by(user_id=current_user.id, device_id=device_id).first()
    if not device:
        device = UserDeviceKey(user_id=current_user.id, device_id=device_id)
        db.session.add(device)
    device.identity_public_key = identity_json
    device.signed_prekey_public_key = prekey_json
    device.signed_prekey_signature = signed_prekey_signature
    device.updated_at = datetime.utcnow()
    device.last_seen_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'key_bundle': key_bundle_to_dict(current_user)})


@messages_bp.route('/chatroom', methods=['GET'])
def get_chatroom():
    current_user = get_current_user()
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()

    limit = min(request.args.get('limit', 80, type=int) or 80, 150)
    messages = (
        ChatroomMessage.query
        .order_by(ChatroomMessage.created_at.desc(), ChatroomMessage.id.desc())
        .limit(limit)
        .all()
    )
    messages = list(reversed(messages))
    return jsonify({
        'messages': [chatroom_message_to_dict(message, current_user.id) for message in messages],
    })


@messages_bp.route('/chatroom/messages', methods=['POST'])
def create_chatroom_message():
    data = request.get_json(silent=True) or {}
    current_user = get_current_user(data)
    body = (data.get('body') or '').strip()
    client_nonce = (data.get('client_nonce') or '').strip()[:64] or None
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()
    if not body:
        return jsonify({'error': 'Message required'}), 400
    if len(body) > 1000:
        return jsonify({'error': 'Message is too long'}), 400

    message = ChatroomMessage(
        sender_id=current_user.id,
        body=body,
        client_nonce=client_nonce,
    )
    db.session.add(message)
    db.session.commit()
    payload = chatroom_message_to_dict(message)
    emit_to_chatroom('chatroom_message_created', {'message': payload})
    return jsonify({'message': chatroom_message_to_dict(message, current_user.id)}), 201


def close_conversation(conversation, current_user, status):
    if current_user.id not in [conversation.user_one_id, conversation.user_two_id]:
        return None
    other = other_user_for_conversation(conversation, current_user.id)
    now = datetime.utcnow()

    existing_requests = requests_between(current_user.id, other.id)
    if status == 'blocked':
        for message_request in existing_requests:
            message_request.status = 'blocked'
            message_request.updated_at = now
            message_request.conversation_id = None
        if not existing_requests:
            db.session.add(MessageRequest(
                sender_id=current_user.id,
                receiver_id=other.id,
                status='blocked',
                updated_at=now,
            ))
    else:
        for message_request in existing_requests:
            if message_request.status == 'active':
                message_request.status = status
            message_request.updated_at = now
            message_request.conversation_id = None

    conversation_id = conversation.id
    participants = [conversation.user_one_id, conversation.user_two_id]
    db.session.delete(conversation)
    db.session.commit()

    payload = {'conversation_id': conversation_id, 'status': status}
    for participant_id in participants:
        emit_to_user(participant_id, 'thread_removed', payload)
    return payload


@messages_bp.route('/users/search', methods=['GET'])
def search_users():
    current_user = get_current_user()
    query = (request.args.get('q') or '').strip()
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()
    if len(query) < 2:
        return jsonify({'users': []})

    like = f'%{query}%'
    users = (
        User.query
        .filter(User.id != current_user.id)
        .filter(User.is_guest.is_(False), User.is_bengali.is_(True), User.birthdate.isnot(None), User.password_hash.isnot(None))
        .filter(User.username.ilike(like))
        .order_by(User.username.asc())
        .limit(10)
        .all()
    )
    return jsonify({'users': [user_summary(user) for user in users]})


@messages_bp.route('', methods=['GET'])
def get_message_home():
    current_user = get_current_user()
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()

    pending_outgoing = (
        MessageRequest.query
        .filter_by(sender_id=current_user.id, status='pending')
        .order_by(MessageRequest.created_at.desc())
        .all()
    )
    pending_incoming = (
        MessageRequest.query
        .filter_by(receiver_id=current_user.id, status='pending')
        .order_by(MessageRequest.created_at.desc())
        .all()
    )
    conversations = (
        Conversation.query
        .filter(or_(Conversation.user_one_id == current_user.id, Conversation.user_two_id == current_user.id))
        .order_by(Conversation.updated_at.desc())
        .all()
    )

    return jsonify({
        'pending_outgoing': [request_to_dict(req, current_user.id) for req in pending_outgoing],
        'pending_incoming': [request_to_dict(req, current_user.id) for req in pending_incoming],
        'threads': [conversation_to_dict(conversation, current_user.id) for conversation in conversations],
    })


@messages_bp.route('/requests', methods=['POST'])
def create_message_request():
    data = request.get_json(silent=True) or {}
    current_user = get_current_user(data)
    receiver_username = (data.get('receiver_username') or '').strip()
    note = (data.get('note') or '').strip()
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()
    if not receiver_username:
        return jsonify({'error': 'Receiver required'}), 400

    receiver = User.query.filter_by(username=receiver_username).first()
    if not receiver:
        return jsonify({'error': 'User not found'}), 404
    if not can_use_private_features(receiver):
        return jsonify({'error': 'User cannot receive messages'}), 403
    if receiver.id == current_user.id:
        return jsonify({'error': 'Cannot message yourself'}), 400
    blocked_request = (
        MessageRequest.query
        .filter_by(status='blocked')
        .filter(or_(
            and_(MessageRequest.sender_id == current_user.id, MessageRequest.receiver_id == receiver.id),
            and_(MessageRequest.sender_id == receiver.id, MessageRequest.receiver_id == current_user.id),
        ))
        .first()
    )
    if blocked_request:
        return jsonify({'error': 'Messaging is blocked between these users'}), 403

    existing_conversation = conversation_between(current_user.id, receiver.id)
    if existing_conversation:
        return jsonify({'conversation': conversation_to_dict(existing_conversation, current_user.id)}), 200

    existing_request = (
        MessageRequest.query
        .filter(MessageRequest.status.in_(ACTIVE_REQUEST_STATUSES))
        .filter(or_(
            and_(MessageRequest.sender_id == current_user.id, MessageRequest.receiver_id == receiver.id),
            and_(MessageRequest.sender_id == receiver.id, MessageRequest.receiver_id == current_user.id),
        ))
        .first()
    )
    if existing_request:
        return jsonify({'request': request_to_dict(existing_request, current_user.id)}), 200

    message_request = MessageRequest(
        sender_id=current_user.id,
        receiver_id=receiver.id,
        status='pending',
        note=note[:128] if note else None,
    )
    db.session.add(message_request)
    db.session.commit()
    sender_payload = request_to_dict(message_request, current_user.id)
    receiver_payload = request_to_dict(message_request, receiver.id)
    emit_to_user(current_user.id, 'request_created', {'request': sender_payload})
    emit_to_user(receiver.id, 'request_created', {'request': receiver_payload})
    send_message_request_notification(receiver.id, current_user.username, message_request.note)
    return jsonify({'request': sender_payload}), 201


@messages_bp.route('/requests/<int:request_id>/accept', methods=['POST'])
def accept_message_request(request_id):
    data = request.get_json(silent=True) or {}
    current_user = get_current_user(data)
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()

    message_request = MessageRequest.query.get_or_404(request_id)
    if message_request.receiver_id != current_user.id:
        return jsonify({'error': 'Only the receiver can accept this request'}), 403
    if message_request.status != 'pending':
        return jsonify({'error': 'Request is not pending'}), 400

    low_id, high_id = sorted([message_request.sender_id, message_request.receiver_id])
    conversation = conversation_between(low_id, high_id)
    if not conversation:
        conversation = Conversation(
            user_one_id=low_id,
            user_two_id=high_id,
            channel_state=dump_channel_state(create_channel_state()),
        )
        db.session.add(conversation)
        db.session.flush()

    message_request.status = 'active'
    message_request.conversation_id = conversation.id
    message_request.updated_at = datetime.utcnow()
    conversation.updated_at = datetime.utcnow()
    db.session.commit()

    sender_conversation = conversation_to_dict(conversation, message_request.sender_id)
    receiver_conversation = conversation_to_dict(conversation, message_request.receiver_id)
    emit_to_user(message_request.sender_id, 'request_accepted', {'conversation': sender_conversation, 'request_id': message_request.id})
    emit_to_user(message_request.receiver_id, 'request_accepted', {'conversation': receiver_conversation, 'request_id': message_request.id})

    return jsonify({'conversation': receiver_conversation})


@messages_bp.route('/requests/<int:request_id>', methods=['DELETE'])
def delete_message_request(request_id):
    data = request.get_json(silent=True) or {}
    current_user = get_current_user(data)
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()

    message_request = MessageRequest.query.get_or_404(request_id)
    if current_user.id not in [message_request.sender_id, message_request.receiver_id]:
        return jsonify({'error': 'Request not found'}), 404
    if message_request.status != 'pending':
        return jsonify({'error': 'Request is not pending'}), 400

    message_request.status = 'rejected'
    message_request.updated_at = datetime.utcnow()
    db.session.commit()
    payload = {'request_id': message_request.id, 'status': 'rejected'}
    emit_to_user(message_request.sender_id, 'request_deleted', payload)
    emit_to_user(message_request.receiver_id, 'request_deleted', payload)
    return jsonify({'message': 'Request removed', 'status': 'rejected'})


@messages_bp.route('/threads/<int:conversation_id>', methods=['GET'])
def get_conversation(conversation_id):
    current_user = get_current_user()
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()

    conversation = Conversation.query.get_or_404(conversation_id)
    if current_user.id not in [conversation.user_one_id, conversation.user_two_id]:
        return jsonify({'error': 'Conversation not found'}), 404
    response = conversation_to_dict(conversation, current_user.id, include_messages=True)
    mark_conversation_read(conversation.id, current_user.id)
    db.session.commit()
    response['unread_count'] = 0
    return jsonify({'conversation': response})


@messages_bp.route('/threads/<int:conversation_id>/messages', methods=['POST'])
def create_message(conversation_id):
    data = request.get_json(silent=True) or {}
    current_user = get_current_user(data)
    body = (data.get('body') or '').strip()
    client_nonce = (data.get('client_nonce') or '').strip()[:64] or None
    astr_packet = data.get('astr_packet') or None
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()
    if not astr_packet:
        return jsonify({'error': 'ASTR packet required for private messages'}), 400
    if len(body) > 2000:
        return jsonify({'error': 'Message is too long'}), 400

    conversation = Conversation.query.get_or_404(conversation_id)
    if current_user.id not in [conversation.user_one_id, conversation.user_two_id]:
        return jsonify({'error': 'Conversation not found'}), 404
    reconcile_channel_state(conversation)

    if client_nonce:
        existing_message = (
            Message.query
            .filter_by(conversation_id=conversation.id, sender_id=current_user.id, client_nonce=client_nonce)
            .first()
        )
        if existing_message:
            return jsonify({'message': message_to_dict(existing_message, current_user.id)}), 200

    try:
        astr_meta = apply_client_packet_transition(conversation, current_user.id, astr_packet)
        stored_body = ''
        notification_body = 'New private message'
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 409

    message = Message(
        conversation_id=conversation.id,
        sender_id=current_user.id,
        body=stored_body,
        client_nonce=client_nonce,
        **astr_meta,
    )
    conversation.updated_at = datetime.utcnow()
    db.session.add(message)
    db.session.commit()

    recipient_id = conversation.user_two_id if conversation.user_one_id == current_user.id else conversation.user_one_id
    send_message_notification(
        recipient_id=recipient_id,
        sender_username=current_user.username,
        body=notification_body,
        conversation_id=conversation.id,
    )

    sender_payload = message_to_dict(message, current_user.id)
    recipient_payload = message_to_dict(message, recipient_id)
    emit_to_user(current_user.id, 'message_created', {
        'conversation_id': conversation.id,
        'message': sender_payload,
        'thread': conversation_to_dict(conversation, current_user.id),
    })
    emit_to_user(recipient_id, 'message_created', {
        'conversation_id': conversation.id,
        'message': recipient_payload,
        'thread': conversation_to_dict(conversation, recipient_id),
    })
    return jsonify({'message': sender_payload}), 201


@messages_bp.route('/threads/<int:conversation_id>', methods=['DELETE'])
def delete_conversation(conversation_id):
    data = request.get_json(silent=True) or {}
    current_user = get_current_user(data)
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()

    conversation = Conversation.query.get_or_404(conversation_id)
    payload = close_conversation(conversation, current_user, 'expired')
    if not payload:
        return jsonify({'error': 'Conversation not found'}), 404
    return jsonify({'deleted': True, **payload})


@messages_bp.route('/threads/<int:conversation_id>/unfriend', methods=['POST'])
def unfriend_conversation(conversation_id):
    data = request.get_json(silent=True) or {}
    current_user = get_current_user(data)
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()

    conversation = Conversation.query.get_or_404(conversation_id)
    payload = close_conversation(conversation, current_user, 'rejected')
    if not payload:
        return jsonify({'error': 'Conversation not found'}), 404
    return jsonify({'unfriended': True, **payload})


@messages_bp.route('/threads/<int:conversation_id>/block', methods=['POST'])
def block_conversation(conversation_id):
    data = request.get_json(silent=True) or {}
    current_user = get_current_user(data)
    if not current_user:
        return jsonify({'error': 'Valid user required'}), 400
    if not can_use_private_features(current_user):
        return private_features_error()

    conversation = Conversation.query.get_or_404(conversation_id)
    payload = close_conversation(conversation, current_user, 'blocked')
    if not payload:
        return jsonify({'error': 'Conversation not found'}), 404
    return jsonify({'blocked': True, **payload})

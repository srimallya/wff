from flask_socketio import SocketIO, join_room

from backend.models import User


socketio = SocketIO(cors_allowed_origins='*', async_mode='threading')
_bound_socketio_ids = set()


def user_room(user_id):
    return f'wff:user:{user_id}'


def conversation_room(conversation_id):
    return f'wff:conversation:{conversation_id}'


def chatroom_room():
    return 'wff:chatroom:global'


@socketio.on('wff_join')
def handle_join(data):
    username = (data or {}).get('username')
    user = User.query.filter_by(username=username).first() if username else None
    if not user:
        return {'ok': False}
    join_room(user_room(user.id))
    return {'ok': True, 'user_id': user.id}


@socketio.on('wff_join_conversation')
def handle_join_conversation(data):
    conversation_id = (data or {}).get('conversation_id')
    if not conversation_id:
        return {'ok': False}
    join_room(conversation_room(conversation_id))
    return {'ok': True}


@socketio.on('wff_join_chatroom')
def handle_join_chatroom(data):
    username = (data or {}).get('username')
    user = User.query.filter_by(username=username).first() if username else None
    if not user or user.is_guest or not user.is_bengali or not user.birthdate or not user.password_hash:
        return {'ok': False}
    join_room(chatroom_room())
    return {'ok': True}


def emit_to_user(user_id, event, payload):
    socketio.emit(event, payload, room=user_room(user_id))


def emit_to_conversation(conversation_id, event, payload):
    socketio.emit(event, payload, room=conversation_room(conversation_id))


def emit_to_chatroom(event, payload):
    socketio.emit(event, payload, room=chatroom_room())


def bind_socketio(target_socketio):
    global socketio
    target_id = id(target_socketio)
    if target_id not in _bound_socketio_ids:
        target_socketio.on_event('wff_join', handle_join)
        target_socketio.on_event('wff_join_conversation', handle_join_conversation)
        target_socketio.on_event('wff_join_chatroom', handle_join_chatroom)
        _bound_socketio_ids.add(target_id)
    socketio = target_socketio
    return socketio


_bound_socketio_ids.add(id(socketio))

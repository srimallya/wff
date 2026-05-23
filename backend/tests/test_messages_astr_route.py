import unittest
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch

from flask import Flask

from backend.models import Conversation, Message, User, db
from backend.routes.auth import auth_bp
from backend.routes.messages import messages_bp
from backend.services.astr import ASTR_CLIENT_STATE_VERSION, ZERO_TRANSCRIPT_HASH, create_channel_state, dump_channel_state, transcript_hash


def make_app():
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['SECRET_KEY'] = 'test-secret'
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['SQLALCHEMY_BINDS'] = {'wff': 'sqlite:///:memory:'}
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    app.register_blueprint(auth_bp, url_prefix='/auth')
    app.register_blueprint(messages_bp, url_prefix='/messages')
    with app.app_context():
        db.create_all()
    return app


def make_packet(conversation, direction='one_to_two', counter=0, prev_hash=ZERO_TRANSCRIPT_HASH):
    ciphertext = 'ciphertext'
    auth_tag = 'c' * 64
    sender_state_commitment = 'sender-state-commitment'
    return {
        'version': ASTR_CLIENT_STATE_VERSION,
        'channel_hint': f'conversation:{conversation.id}',
        'epoch': 1,
        'direction': direction,
        'counter': counter,
        'previous_chain_length': 0,
        'sender_state_commitment': sender_state_commitment,
        'prev_transcript_hash': prev_hash,
        'ciphertext': ciphertext,
        'auth_tag': auth_tag,
        'transcript_hash': transcript_hash(prev_hash, direction, counter, ciphertext, auth_tag, sender_state_commitment),
    }


class PrivateMessageAstrRouteTest(unittest.TestCase):
    def setUp(self):
        self.media_dir = TemporaryDirectory()
        self.app = make_app()
        self.app.config['WFF_MEDIA_UPLOAD_FOLDER'] = self.media_dir.name
        self.client = self.app.test_client()
        with self.app.app_context():
            alice = User(username='alice', real_username='alice', birthdate='1990-01-01', is_bengali=True, is_guest=False)
            bob = User(username='bob', real_username='bob', birthdate='1991-01-01', is_bengali=True, is_guest=False)
            charlie = User(username='charlie', real_username='charlie', birthdate='1992-01-01', is_bengali=True, is_guest=False)
            alice.set_password('password123')
            bob.set_password('password123')
            charlie.set_password('password123')
            db.session.add_all([alice, bob, charlie])
            db.session.flush()
            conversation = Conversation(
                user_one_id=alice.id,
                user_two_id=bob.id,
                channel_state=dump_channel_state(create_channel_state()),
            )
            other_conversation = Conversation(
                user_one_id=bob.id,
                user_two_id=charlie.id,
                channel_state=dump_channel_state(create_channel_state()),
            )
            db.session.add_all([conversation, other_conversation])
            db.session.commit()
            self.alice_id = alice.id
            self.bob_id = bob.id
            self.charlie_id = charlie.id
            self.conversation_id = conversation.id
            self.other_conversation_id = other_conversation.id

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.media_dir.cleanup()

    def login(self, real_username='alice'):
        response = self.client.post('/auth/login', json={
            'real_username': real_username,
            'password': 'password123',
        })
        self.assertEqual(response.status_code, 200)
        return response.get_json()['csrf_token']

    def auth_headers(self, csrf_token):
        return {'X-CSRF-Token': csrf_token}

    def test_unauthenticated_private_conversation_fetch_returns_401(self):
        response = self.client.get(f'/messages/threads/{self.conversation_id}')

        self.assertEqual(response.status_code, 401)

    def test_authenticated_user_cannot_fetch_another_users_conversation(self):
        csrf = self.login('alice')

        response = self.client.get(f'/messages/threads/{self.other_conversation_id}')

        self.assertEqual(response.status_code, 404)

    def test_private_message_without_astr_packet_is_rejected(self):
        csrf = self.login('alice')
        response = self.client.post(f'/messages/threads/{self.conversation_id}/messages', json={
            'body': 'plaintext fallback',
            'client_nonce': 'nonce-plaintext',
        }, headers=self.auth_headers(csrf))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'ASTR packet required for private messages')
        with self.app.app_context():
            self.assertEqual(Message.query.count(), 0)

    def test_private_message_with_astr_packet_stores_empty_body(self):
        csrf = self.login('alice')
        with self.app.app_context():
            conversation = db.session.get(Conversation, self.conversation_id)
            packet = make_packet(conversation)

        with patch('backend.routes.messages.send_message_notification'), patch('backend.routes.messages.emit_to_user'):
            response = self.client.post(f'/messages/threads/{self.conversation_id}/messages', json={
                'body': 'server must not store this',
                'client_nonce': 'nonce-astr',
                'astr_packet': packet,
            }, headers=self.auth_headers(csrf))

        self.assertEqual(response.status_code, 201)
        with self.app.app_context():
            message = Message.query.one()
            self.assertEqual(message.body, '')
            self.assertEqual(message.astr_version, ASTR_CLIENT_STATE_VERSION)
            self.assertEqual(message.ratchet_public_key, packet['sender_state_commitment'])

    def test_authenticated_user_cannot_send_as_another_username(self):
        csrf = self.login('alice')
        with self.app.app_context():
            conversation = db.session.get(Conversation, self.conversation_id)
            packet = make_packet(conversation)

        with patch('backend.routes.messages.send_message_notification'), patch('backend.routes.messages.emit_to_user'):
            response = self.client.post(f'/messages/threads/{self.conversation_id}/messages', json={
                'username': 'bob',
                'client_nonce': 'nonce-spoof',
                'astr_packet': packet,
            }, headers=self.auth_headers(csrf))

        self.assertEqual(response.status_code, 201)
        with self.app.app_context():
            message = Message.query.one()
            self.assertEqual(message.sender_id, self.alice_id)

    def test_key_bundle_registration_belongs_to_authenticated_user(self):
        csrf = self.login('alice')
        public_key = {
            'kty': 'EC',
            'crv': 'P-256',
            'x': 'f83OJ3D2xF4d2I9j8mG3aK8z3B1Ui8E1c9fKJ4fG4vU',
            'y': 'x_FEzRu9LQ2rYqY1xV8k3k8Q7pGf4c9l5pT1G3xR5aQ',
            'ext': True,
        }

        response = self.client.post('/messages/key-bundle', json={
            'username': 'bob',
            'device_id': 'alice-device',
            'identity_public_key': public_key,
            'signed_prekey_public_key': public_key,
            'signed_prekey_signature': 'real-signature-pending-v5',
        }, headers=self.auth_headers(csrf))

        self.assertEqual(response.status_code, 200)
        with self.app.app_context():
            alice = db.session.get(User, self.alice_id)
            bob = db.session.get(User, self.bob_id)
            self.assertIsNotNone(alice.identity_public_key)
            self.assertIsNone(bob.identity_public_key)

    def test_only_receiver_can_accept_message_request(self):
        csrf = self.login('alice')
        with self.app.app_context():
            from backend.models import MessageRequest

            message_request = MessageRequest(sender_id=self.alice_id, receiver_id=self.bob_id, status='pending')
            db.session.add(message_request)
            db.session.commit()
            request_id = message_request.id

        response = self.client.post(f'/messages/requests/{request_id}/accept', json={}, headers=self.auth_headers(csrf))

        self.assertEqual(response.status_code, 403)

    def test_unrelated_user_cannot_delete_message_request(self):
        csrf = self.login('charlie')
        with self.app.app_context():
            from backend.models import MessageRequest

            message_request = MessageRequest(sender_id=self.alice_id, receiver_id=self.bob_id, status='pending')
            db.session.add(message_request)
            db.session.commit()
            request_id = message_request.id

        response = self.client.delete(f'/messages/requests/{request_id}', json={}, headers=self.auth_headers(csrf))

        self.assertEqual(response.status_code, 404)

    def test_send_reconciles_stale_channel_state_from_empty_message_log(self):
        csrf = self.login('alice')
        with self.app.app_context():
            conversation = db.session.get(Conversation, self.conversation_id)
            stale_state = create_channel_state()
            stale_state['transcript_hash'] = 'f' * 64
            conversation.channel_state = dump_channel_state(stale_state)
            db.session.commit()
            packet = make_packet(conversation)

        with patch('backend.routes.messages.send_message_notification'), patch('backend.routes.messages.emit_to_user'):
            response = self.client.post(f'/messages/threads/{self.conversation_id}/messages', json={
                'client_nonce': 'nonce-after-stale-state',
                'astr_packet': packet,
            }, headers=self.auth_headers(csrf))

        self.assertEqual(response.status_code, 201)
        with self.app.app_context():
            message = Message.query.one()
            conversation = db.session.get(Conversation, self.conversation_id)
            self.assertEqual(message.prev_transcript_hash, ZERO_TRANSCRIPT_HASH)
            self.assertEqual(conversation.channel_state, dump_channel_state({
                **create_channel_state(),
                'transcript_hash': message.transcript_hash,
                'counters': {'one_to_two': 1, 'two_to_one': 0},
                'previous_chain_lengths': {'one_to_two': 1, 'two_to_one': 0},
            }))

    def test_media_upload_and_open_count_excludes_sender(self):
        csrf = self.login('alice')
        with patch('backend.routes.messages.send_message_notification'), patch('backend.routes.messages.emit_to_user'):
            response = self.client.post(
                f'/messages/threads/{self.conversation_id}/media',
                data={
                    'client_nonce': 'media-nonce',
                    'file': (BytesIO(b'image-bytes'), 'photo.png'),
                },
                content_type='multipart/form-data',
                headers=self.auth_headers(csrf),
            )

        self.assertEqual(response.status_code, 201)
        message_id = response.get_json()['message']['id']
        sender_open = self.client.get(f'/messages/media/{message_id}')
        csrf = self.login('bob')
        recipient_open = self.client.get(f'/messages/media/{message_id}')

        self.assertEqual(sender_open.status_code, 200)
        self.assertEqual(recipient_open.status_code, 200)
        sender_open.close()
        recipient_open.close()
        with self.app.app_context():
            message = db.session.get(Message, message_id)
            self.assertEqual(message.media_open_count, 1)


if __name__ == '__main__':
    unittest.main()

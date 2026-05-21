import unittest
from unittest.mock import patch

from flask import Flask

from backend.models import Conversation, Message, User, db
from backend.routes.messages import messages_bp
from backend.services.astr import ASTR_CLIENT_STATE_VERSION, ZERO_TRANSCRIPT_HASH, create_channel_state, dump_channel_state, transcript_hash


def make_app():
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['SQLALCHEMY_BINDS'] = {'wff': 'sqlite:///:memory:'}
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
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
        self.app = make_app()
        self.client = self.app.test_client()
        with self.app.app_context():
            alice = User(username='alice', real_username='alice', birthdate='1990-01-01', is_bengali=True, is_guest=False)
            bob = User(username='bob', real_username='bob', birthdate='1991-01-01', is_bengali=True, is_guest=False)
            alice.set_password('password123')
            bob.set_password('password123')
            db.session.add_all([alice, bob])
            db.session.flush()
            conversation = Conversation(
                user_one_id=alice.id,
                user_two_id=bob.id,
                channel_state=dump_channel_state(create_channel_state()),
            )
            db.session.add(conversation)
            db.session.commit()
            self.alice_id = alice.id
            self.conversation_id = conversation.id

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_private_message_without_astr_packet_is_rejected(self):
        response = self.client.post(f'/messages/threads/{self.conversation_id}/messages', json={
            'username': 'alice',
            'body': 'plaintext fallback',
            'client_nonce': 'nonce-plaintext',
        })

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'ASTR packet required for private messages')
        with self.app.app_context():
            self.assertEqual(Message.query.count(), 0)

    def test_private_message_with_astr_packet_stores_empty_body(self):
        with self.app.app_context():
            conversation = db.session.get(Conversation, self.conversation_id)
            packet = make_packet(conversation)

        with patch('backend.routes.messages.send_message_notification'), patch('backend.routes.messages.emit_to_user'):
            response = self.client.post(f'/messages/threads/{self.conversation_id}/messages', json={
                'username': 'alice',
                'body': 'server must not store this',
                'client_nonce': 'nonce-astr',
                'astr_packet': packet,
            })

        self.assertEqual(response.status_code, 201)
        with self.app.app_context():
            message = Message.query.one()
            self.assertEqual(message.body, '')
            self.assertEqual(message.astr_version, ASTR_CLIENT_STATE_VERSION)
            self.assertEqual(message.ratchet_public_key, packet['sender_state_commitment'])

    def test_send_reconciles_stale_channel_state_from_empty_message_log(self):
        with self.app.app_context():
            conversation = db.session.get(Conversation, self.conversation_id)
            stale_state = create_channel_state()
            stale_state['transcript_hash'] = 'f' * 64
            conversation.channel_state = dump_channel_state(stale_state)
            db.session.commit()
            packet = make_packet(conversation)

        with patch('backend.routes.messages.send_message_notification'), patch('backend.routes.messages.emit_to_user'):
            response = self.client.post(f'/messages/threads/{self.conversation_id}/messages', json={
                'username': 'alice',
                'client_nonce': 'nonce-after-stale-state',
                'astr_packet': packet,
            })

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


if __name__ == '__main__':
    unittest.main()

import unittest

from backend.services.astr import (
    ASTR_CLIENT_STATE_VERSION,
    ASTR_RATCHET_VERSION,
    ZERO_TRANSCRIPT_HASH,
    apply_client_packet_transition,
    create_channel_state,
    transcript_hash,
)


class DummyConversation:
    id = 7
    user_one_id = 1
    user_two_id = 2

    def __init__(self):
        self.channel_state = None


def packet_for(conversation, sender_id, counter=0, prev_hash=ZERO_TRANSCRIPT_HASH, direction='one_to_two'):
    ciphertext = 'ciphertext'
    auth_tag = 'a' * 64
    ratchet_public_key = 'ratchet-public'
    return {
        'version': ASTR_RATCHET_VERSION,
        'channel_hint': f'conversation:{conversation.id}',
        'epoch': 1,
        'direction': direction,
        'counter': counter,
        'previous_chain_length': 0,
        'ratchet_public_key': ratchet_public_key,
        'prev_transcript_hash': prev_hash,
        'ciphertext': ciphertext,
        'auth_tag': auth_tag,
        'transcript_hash': transcript_hash(prev_hash, direction, counter, ciphertext, auth_tag, ratchet_public_key),
    }


def v4_packet_for(conversation, counter=0, prev_hash=ZERO_TRANSCRIPT_HASH, direction='one_to_two'):
    ciphertext = 'ciphertext'
    auth_tag = 'b' * 64
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


class AstrV3TransitionTest(unittest.TestCase):
    def test_accepts_valid_v3_packet_and_advances_state(self):
        conversation = DummyConversation()
        conversation.channel_state = None
        packet = packet_for(conversation, 1)

        meta = apply_client_packet_transition(conversation, 1, packet)

        self.assertEqual(meta['astr_version'], ASTR_RATCHET_VERSION)
        self.assertEqual(meta['astr_direction'], 'one_to_two')
        self.assertEqual(meta['astr_counter'], 0)
        self.assertEqual(meta['transcript_hash'], packet['transcript_hash'])

    def test_rejects_replay_counter(self):
        conversation = DummyConversation()
        packet = packet_for(conversation, 1)
        apply_client_packet_transition(conversation, 1, packet)

        with self.assertRaisesRegex(ValueError, 'counter mismatch'):
            apply_client_packet_transition(conversation, 1, packet)

    def test_rejects_wrong_transcript(self):
        conversation = DummyConversation()
        packet = packet_for(conversation, 1, prev_hash='bad')

        with self.assertRaisesRegex(ValueError, 'transcript mismatch'):
            apply_client_packet_transition(conversation, 1, packet)

    def test_rejects_wrong_direction(self):
        conversation = DummyConversation()
        packet = packet_for(conversation, 1, direction='two_to_one')

        with self.assertRaisesRegex(ValueError, 'direction mismatch'):
            apply_client_packet_transition(conversation, 1, packet)

    def test_accepts_valid_v4_packet_with_sender_state_commitment(self):
        conversation = DummyConversation()
        packet = v4_packet_for(conversation)

        meta = apply_client_packet_transition(conversation, 1, packet)

        self.assertEqual(meta['astr_version'], ASTR_CLIENT_STATE_VERSION)
        self.assertEqual(meta['astr_counter'], 0)
        self.assertEqual(meta['ratchet_public_key'], packet['sender_state_commitment'])
        self.assertEqual(meta['transcript_hash'], packet['transcript_hash'])

    def test_rejects_v4_without_sender_state_commitment(self):
        conversation = DummyConversation()
        packet = v4_packet_for(conversation)
        packet.pop('sender_state_commitment')

        with self.assertRaisesRegex(ValueError, 'sender state commitment missing'):
            apply_client_packet_transition(conversation, 1, packet)


if __name__ == '__main__':
    unittest.main()

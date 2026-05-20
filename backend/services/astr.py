import base64
import hashlib
import hmac
import json
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


ASTR_VERSION = 'astr-v1-server-scaffold'
ASTR_CLIENT_VERSION = 'astr-v2-client-aead'
ASTR_RATCHET_VERSION = 'astr-v3-ratchet-aead'
ZERO_TRANSCRIPT_HASH = hashlib.sha256(b'wff:astr:t0').hexdigest()
MAX_SKIP_WINDOW = 50


def create_channel_state():
    return {
        'version': ASTR_RATCHET_VERSION,
        'epoch': 1,
        'transcript_hash': ZERO_TRANSCRIPT_HASH,
        'counters': {
            'one_to_two': 0,
            'two_to_one': 0,
        },
        'previous_chain_lengths': {
            'one_to_two': 0,
            'two_to_one': 0,
        },
    }


def load_channel_state(raw_state):
    if not raw_state or raw_state == 'placeholder_session':
        return create_channel_state()
    try:
        state = json.loads(raw_state)
    except (TypeError, ValueError):
        return create_channel_state()
    if state.get('version') not in [ASTR_VERSION, ASTR_CLIENT_VERSION, ASTR_RATCHET_VERSION]:
        return create_channel_state()
    state.setdefault('transcript_hash', ZERO_TRANSCRIPT_HASH)
    state.setdefault('counters', {'one_to_two': 0, 'two_to_one': 0})
    state.setdefault('epoch', 1)
    state.setdefault('previous_chain_lengths', {'one_to_two': 0, 'two_to_one': 0})
    if state.get('version') in [ASTR_VERSION, ASTR_CLIENT_VERSION]:
        state['version'] = ASTR_RATCHET_VERSION
        state.pop('root_secret', None)
    return state


def dump_channel_state(state):
    return json.dumps(state, separators=(',', ':'), sort_keys=True)


def direction_for(conversation, sender_id):
    if sender_id == conversation.user_one_id:
        return 'one_to_two'
    return 'two_to_one'


def derive_key(root_secret, label):
    return hmac.new(bytes.fromhex(root_secret), label.encode('utf-8'), hashlib.sha256).digest()


def associated_data(direction, counter, prev_transcript_hash):
    return json.dumps({
        'direction': direction,
        'counter': counter,
        'prev_transcript_hash': prev_transcript_hash,
    }, separators=(',', ':'), sort_keys=True).encode('utf-8')


def encrypt_message(root_secret, direction, counter, prev_transcript_hash, plaintext):
    message_key = derive_key(root_secret, f'{direction}:{counter}:message')
    nonce = derive_key(root_secret, f'{direction}:{counter}:nonce')[:12]
    ciphertext = AESGCM(message_key).encrypt(
        nonce,
        plaintext.encode('utf-8'),
        associated_data(direction, counter, prev_transcript_hash),
    )
    return base64.b64encode(nonce + ciphertext).decode('ascii')


def auth_tag(root_secret, packet):
    canonical = json.dumps(packet, separators=(',', ':'), sort_keys=True).encode('utf-8')
    return hmac.new(derive_key(root_secret, 'auth'), canonical, hashlib.sha256).hexdigest()


def transcript_hash(prev_transcript_hash, direction, counter, ciphertext, tag, ratchet_public_key=''):
    payload = f'{prev_transcript_hash}|{direction}|{counter}|{ratchet_public_key or ""}|{ciphertext}|{tag}'.encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def apply_send_transition(conversation, sender_id, plaintext):
    state = load_channel_state(conversation.channel_state)
    if not state.get('root_secret'):
        state['root_secret'] = secrets.token_hex(32)
    state['version'] = ASTR_VERSION
    direction = direction_for(conversation, sender_id)
    counter = int(state['counters'].get(direction, 0))
    prev_hash = state['transcript_hash']
    ciphertext = encrypt_message(state['root_secret'], direction, counter, prev_hash, plaintext)
    packet = {
        'version': ASTR_VERSION,
        'channel_hint': f'conversation:{conversation.id}',
        'direction': direction,
        'counter': counter,
        'prev_transcript_hash': prev_hash,
        'ciphertext': ciphertext,
    }
    tag = auth_tag(state['root_secret'], packet)
    next_hash = transcript_hash(prev_hash, direction, counter, ciphertext, tag)

    state['transcript_hash'] = next_hash
    state['counters'][direction] = counter + 1
    conversation.channel_state = dump_channel_state(state)

    return {
        'astr_version': ASTR_VERSION,
        'astr_direction': direction,
        'astr_counter': counter,
        'prev_transcript_hash': prev_hash,
        'transcript_hash': next_hash,
        'ciphertext': ciphertext,
        'auth_tag': tag,
    }


def client_packet_transcript_hash(prev_transcript_hash, direction, counter, ciphertext, tag):
    return transcript_hash(prev_transcript_hash, direction, counter, ciphertext, tag)


def apply_client_packet_transition(conversation, sender_id, packet):
    state = load_channel_state(conversation.channel_state)
    direction = direction_for(conversation, sender_id)
    counter = int(state['counters'].get(direction, 0))
    prev_hash = state['transcript_hash']

    packet_direction = packet.get('direction')
    packet_counter = packet.get('counter')
    packet_prev_hash = packet.get('prev_transcript_hash')
    ciphertext = packet.get('ciphertext')
    tag = packet.get('auth_tag')
    packet_hash = packet.get('transcript_hash')
    version = packet.get('version')

    if version not in [ASTR_CLIENT_VERSION, ASTR_RATCHET_VERSION]:
        raise ValueError('Unsupported ASTR packet version')
    if packet_direction != direction:
        raise ValueError('ASTR direction mismatch')
    try:
        packet_counter = int(packet_counter)
    except (TypeError, ValueError):
        raise ValueError('ASTR counter invalid')
    if packet_counter != counter:
        raise ValueError('ASTR counter mismatch')
    if packet_prev_hash != prev_hash:
        raise ValueError('ASTR transcript mismatch')
    if not ciphertext or not tag:
        raise ValueError('ASTR packet incomplete')

    if version == ASTR_RATCHET_VERSION:
        epoch = int(packet.get('epoch') or 0)
        previous_chain_length = int(packet.get('previous_chain_length') or 0)
        ratchet_public_key = packet.get('ratchet_public_key')
        expected_previous = int(state.get('previous_chain_lengths', {}).get(direction, 0))
        if epoch != int(state.get('epoch', 1)):
            raise ValueError('ASTR epoch mismatch')
        if previous_chain_length < expected_previous or previous_chain_length > counter + MAX_SKIP_WINDOW:
            raise ValueError('ASTR chain length invalid')
        if not ratchet_public_key:
            raise ValueError('ASTR ratchet key missing')
        next_hash = transcript_hash(prev_hash, direction, counter, ciphertext, tag, ratchet_public_key)
    else:
        ratchet_public_key = ''
        next_hash = client_packet_transcript_hash(prev_hash, direction, counter, ciphertext, tag)

    if packet_hash and packet_hash != next_hash:
        raise ValueError('ASTR transcript hash invalid')

    state['transcript_hash'] = next_hash
    state['counters'][direction] = counter + 1
    state['version'] = version
    if version == ASTR_RATCHET_VERSION:
        state.setdefault('previous_chain_lengths', {})[direction] = counter + 1
    state.pop('root_secret', None)
    conversation.channel_state = dump_channel_state(state)

    return {
        'astr_version': version,
        'astr_direction': direction,
        'astr_counter': counter,
        'astr_epoch': int(packet.get('epoch') or state.get('epoch', 1)),
        'previous_chain_length': int(packet.get('previous_chain_length') or 0),
        'ratchet_public_key': ratchet_public_key,
        'prev_transcript_hash': prev_hash,
        'transcript_hash': next_hash,
        'ciphertext': ciphertext,
        'auth_tag': tag,
    }

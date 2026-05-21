import hashlib
import json


ASTR_VERSION = 'astr-v1-server-scaffold'
ASTR_CLIENT_VERSION = 'astr-v2-client-aead'
ASTR_RATCHET_VERSION = 'astr-v3-ratchet-aead'
ASTR_CLIENT_STATE_VERSION = 'astr-v4-client-state-aead'
ZERO_TRANSCRIPT_HASH = hashlib.sha256(b'wff:astr:t0').hexdigest()
MAX_SKIP_WINDOW = 50
SUPPORTED_PACKET_VERSIONS = [
    ASTR_CLIENT_VERSION,
    ASTR_RATCHET_VERSION,
    ASTR_CLIENT_STATE_VERSION,
]


def create_channel_state():
    return {
        'version': ASTR_CLIENT_STATE_VERSION,
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
    if state.get('version') not in [ASTR_VERSION, ASTR_CLIENT_VERSION, ASTR_RATCHET_VERSION, ASTR_CLIENT_STATE_VERSION]:
        return create_channel_state()
    state.setdefault('transcript_hash', ZERO_TRANSCRIPT_HASH)
    state.setdefault('counters', {'one_to_two': 0, 'two_to_one': 0})
    state.setdefault('epoch', 1)
    state.setdefault('previous_chain_lengths', {'one_to_two': 0, 'two_to_one': 0})
    if state.get('version') in [ASTR_VERSION, ASTR_CLIENT_VERSION]:
        state['version'] = ASTR_CLIENT_STATE_VERSION
        state.pop('root_secret', None)
    return state


def dump_channel_state(state):
    return json.dumps(state, separators=(',', ':'), sort_keys=True)


def channel_state_from_messages(conversation):
    state = create_channel_state()
    messages = sorted(
        [message for message in getattr(conversation, 'messages', []) if getattr(message, 'astr_version', None)],
        key=lambda message: message.id or 0,
    )
    for message in messages:
        direction = message.astr_direction
        if direction not in ['one_to_two', 'two_to_one']:
            continue
        if message.astr_counter is None or not message.transcript_hash:
            continue
        state['version'] = message.astr_version or state['version']
        state['epoch'] = message.astr_epoch or state.get('epoch', 1)
        state['transcript_hash'] = message.transcript_hash
        state['counters'][direction] = max(
            int(state['counters'].get(direction, 0)),
            int(message.astr_counter) + 1,
        )
        state.setdefault('previous_chain_lengths', {})[direction] = max(
            int(state.get('previous_chain_lengths', {}).get(direction, 0)),
            int(message.astr_counter) + 1,
        )
    return state


def reconcile_channel_state(conversation):
    rebuilt = channel_state_from_messages(conversation)
    current = load_channel_state(conversation.channel_state)
    if current != rebuilt:
        conversation.channel_state = dump_channel_state(rebuilt)
    return rebuilt


def direction_for(conversation, sender_id):
    if sender_id == conversation.user_one_id:
        return 'one_to_two'
    return 'two_to_one'


def transcript_hash(prev_transcript_hash, direction, counter, ciphertext, tag, sender_state_commitment=''):
    payload = f'{prev_transcript_hash}|{direction}|{counter}|{sender_state_commitment or ""}|{ciphertext}|{tag}'.encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def client_packet_transcript_hash(prev_transcript_hash, direction, counter, ciphertext, tag):
    return transcript_hash(prev_transcript_hash, direction, counter, ciphertext, tag)


def packet_state_commitment(packet, version):
    if version == ASTR_CLIENT_STATE_VERSION:
        return packet.get('sender_state_commitment') or packet.get('header_key_commitment')
    return packet.get('ratchet_public_key')


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

    if version not in SUPPORTED_PACKET_VERSIONS:
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

    if version in [ASTR_RATCHET_VERSION, ASTR_CLIENT_STATE_VERSION]:
        epoch = int(packet.get('epoch') or 0)
        previous_chain_length = int(packet.get('previous_chain_length') or 0)
        sender_state_commitment = packet_state_commitment(packet, version)
        expected_previous = int(state.get('previous_chain_lengths', {}).get(direction, 0))
        if epoch != int(state.get('epoch', 1)):
            raise ValueError('ASTR epoch mismatch')
        if previous_chain_length < expected_previous or previous_chain_length > counter + MAX_SKIP_WINDOW:
            raise ValueError('ASTR chain length invalid')
        if not sender_state_commitment:
            raise ValueError('ASTR sender state commitment missing')
        next_hash = transcript_hash(prev_hash, direction, counter, ciphertext, tag, sender_state_commitment)
    else:
        sender_state_commitment = ''
        next_hash = client_packet_transcript_hash(prev_hash, direction, counter, ciphertext, tag)

    if packet_hash and packet_hash != next_hash:
        raise ValueError('ASTR transcript hash invalid')

    state['transcript_hash'] = next_hash
    state['counters'][direction] = counter + 1
    state['version'] = version
    if version in [ASTR_RATCHET_VERSION, ASTR_CLIENT_STATE_VERSION]:
        state.setdefault('previous_chain_lengths', {})[direction] = counter + 1
    state.pop('root_secret', None)
    conversation.channel_state = dump_channel_state(state)

    return {
        'astr_version': version,
        'astr_direction': direction,
        'astr_counter': counter,
        'astr_epoch': int(packet.get('epoch') or state.get('epoch', 1)),
        'previous_chain_length': int(packet.get('previous_chain_length') or 0),
        # Backward-compatible storage column. For v4 this contains the sender
        # state commitment, not a DH ratchet public key.
        'ratchet_public_key': sender_state_commitment,
        'prev_transcript_hash': prev_hash,
        'transcript_hash': next_hash,
        'ciphertext': ciphertext,
        'auth_tag': tag,
    }

# ASTR Protocol

ASTR means Authenticated State-Transition Ratchet.

WFF treats an accepted one-to-one private conversation as a replicated private state machine. Each private message is an encrypted state-transition command. The transcript hash commits to the accepted packet history so clients can verify that their local view of the channel is coherent.

ASTR is WFF's own protocol layer. It is not externally audited and is not a complete Double Ratchet implementation yet.

## Versions

### `astr-v2-client-aead`

Legacy client-side AEAD packets. These remain readable for existing stored messages only.

### `astr-v3-ratchet-aead`

Legacy/current compatibility packet format. It includes epoch, direction, counter, previous-chain length, a field named `ratchet_public_key`, previous transcript hash, ciphertext, and auth tag.

The `ratchet_public_key` value in v3 is not a true rotating DH ratchet public key. It is treated as legacy packet commitment material.

### `astr-v4-client-state-aead`

Current send format for new private messages. It replaces the misleading packet name with `sender_state_commitment`.

```text
ASTRPacketV4 {
  version,
  channel_hint,
  epoch,
  direction,
  counter,
  previous_chain_length,
  sender_state_commitment,
  prev_transcript_hash,
  ciphertext,
  auth_tag,
  transcript_hash
}
```

The database still has a backward-compatible column named `ratchet_public_key`. For v4 rows, that column stores the `sender_state_commitment`.

## Transcript Hash

Current v4 transcript commitment:

```text
T_n = SHA256(T_{n-1} || direction || counter || sender_state_commitment || ciphertext || auth_tag)
```

This commitment is structural and transcript-bound. It does not prove to the server that ciphertext is decryptable because the server does not have client secrets.

## Client Responsibilities

- Generate ASTR packets locally.
- Encrypt private message content before sending.
- Recompute transcript state from loaded accepted message history.
- Verify previous transcript hash, direction, counter, transcript hash, packet commitment fields, AEAD associated data, sender identity commitment where available, and decryptability before displaying plaintext as normal.
- Refuse silent plaintext downgrade.
- Preserve compatibility reads for older stored packets.

Client-owned transcript verification is partially implemented. The frontend now recomputes the ASTR transcript on conversation load, separates transcript failure codes, checks incoming v4 sender identity commitments against the registered key bundle, and refuses to send from a generic decrypt-failed state. A missing device envelope may advance structural transcript state only when the packet hash is otherwise valid, because that case means the current device was not an intended recipient of that envelope.

Durable local ASTR state is implemented for v4 transcript state. The client stores per-conversation state in IndexedDB under `wff-astr-v4` and detects server omission or rewrite of previously verified transcript history before normal display or sending.

## Identity Pinning And Safety Numbers

The v4 client implements trust-on-first-use identity pinning for the remote user's current identity public key. Pins are stored locally in IndexedDB in `astrIdentityPins`; the server-provided bundle is not accepted as the only trust anchor after a local pin exists.

On first valid remote identity observation, the client stores an unverified local pin. On later conversation loads, if the current remote identity key differs from the local pin, the conversation is marked `identity-key-changed`, normal sending is blocked, and the UI requires explicit review before sending can resume.

The Conversation security panel shows:

- security status: verified, unverified, or identity changed;
- the remote identity fingerprint;
- a safety number derived from both users' identity public keys using the domain separator `wff:astr:safety-number:v1`;
- controls to mark the identity as verified or explicitly accept a changed identity.

This is a safety-number foundation, not an external audit or compatibility claim.

## Server Responsibilities

- Authorize participants.
- Store and forward opaque private packets.
- Reject missing or unsupported ASTR versions.
- Reject wrong direction, wrong counter, wrong previous transcript hash, malformed state commitment, and malformed packet shape.
- Keep private message `body` empty for new accepted private messages.
- Treat server channel state as delivery/order metadata, not cryptographic truth.

## Non-Goals In Current Implementation

- No claim of complete Double Ratchet state.
- No real X3DH-style session setup yet.
- No real signed prekeys or one-time prekeys yet.
- No true durable per-device Double Ratchet session state yet.
- No skipped-message-key cache yet.
- No social graph hiding yet.
- No resistance to timing or IP correlation.
- No external cryptographic audit yet.

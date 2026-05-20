# Goal: v1.3.0 ASTR Hardening Toward Signal-Grade Key Evolution

## Thesis

v1.2.0 moved Kaal Probaho private messaging from a server-side ASTR scaffold to client-created encrypted ASTR packets. That is meaningful progress, but it is not Signal-equivalent and must not be presented as stronger than Signal.

v1.3.0 should harden the protocol by closing the known gaps:

**ASTR state-transition semantics + audited Signal-style key evolution + explicit identity/session safety.**

ASTR should continue to define what a valid conversation mutation is. Signal-style ratchets should define how keys evolve, recover, and expire.

## Current v1.2.0 State

v1.2.0 has:

- client-side ASTR packet creation;
- client-side private message decryption;
- server-side storage of ciphertext/auth metadata for new private messages;
- empty plaintext body storage for new ASTR v2 private messages;
- transcript hash and directional counter validation on the server;
- request acceptance as the product moment when a private channel begins;
- a registered-user chatroom that is intentionally separate from private ASTR messaging.

This is not enough for Signal-grade security.

## Remaining Security Gaps

v1.3.0 should mitigate these gaps before any stronger security claims are made:

- no audited X3DH-style initial key agreement;
- no durable user identity key verification;
- no signed prekey / one-time prekey model;
- no true Double Ratchet DH step;
- no robust root-chain and chain-key evolution;
- no post-compromise recovery when fresh ratchet material arrives;
- no bounded skipped-message-key handling for out-of-order delivery;
- no clear replay/reorder/fork test-vector suite;
- no multi-device model;
- no encrypted backup or account recovery model;
- weak local browser-state persistence guarantees;
- no external cryptographic review;
- chatroom is not private end-to-end group messaging.

## v1.3.0 Protocol Target

Each private conversation should have a versioned client-side session with:

```text
ASTRSession {
  version,
  local_identity_key,
  remote_identity_key,
  root_key,
  sending_chain_key,
  receiving_chain_key,
  local_ratchet_key_pair,
  remote_ratchet_public_key,
  send_counter,
  receive_counter,
  previous_sending_chain_length,
  skipped_message_keys,
  transcript_hash,
  channel_epoch
}
```

Each packet should carry:

```text
ASTRPacket {
  version,
  channel_hint,
  epoch,
  direction,
  counter,
  previous_chain_length,
  ratchet_public_key,
  prev_transcript_hash,
  ciphertext,
  auth_tag
}
```

AEAD associated data must include:

```text
associated_data = {
  version,
  channel_hint,
  epoch,
  direction,
  counter,
  previous_chain_length,
  ratchet_public_key,
  prev_transcript_hash
}
```

The transcript commitment should remain:

```text
T_n = Hash(T_{n-1} || direction || counter || ratchet_public_key || ciphertext || auth_tag)
```

## Key Agreement

v1.3.0 should introduce a real initial session setup:

- long-term identity key pair per registered user;
- signed prekey per user;
- one-time prekeys where practical;
- sender validates a signed prekey before opening a session;
- request acceptance creates or confirms the first cryptographic epoch;
- server stores public key bundles only, never private key material;
- clients reject sessions if identity keys unexpectedly change without user-visible safety handling.

If implementing full X3DH is too large for one release, v1.3.0 should at minimum isolate the key-agreement layer behind a clean interface and document which parts are still provisional.

## Double Ratchet Requirements

v1.3.0 should implement or integrate:

- root-key updates from DH outputs;
- send-chain and receive-chain key derivation;
- unique message key per message;
- immediate deletion of used message keys;
- bounded skipped-message-key storage;
- replay rejection;
- out-of-order delivery within a bounded window;
- clear failure behavior for excessive gaps;
- post-compromise recovery after receiving fresh ratchet material.

Do not invent new primitives when a well-reviewed library or standard construction is available.

## Identity And Safety UX

The normal messaging UI should stay simple, but v1.3.0 needs a safety layer:

- stable safety number or fingerprint per private conversation;
- visible warning when a remote identity key changes;
- a way to reset a broken or suspicious session;
- debug-only protocol inspection that does not expose jargon in ordinary messaging.

## Local State Protection

Browser/client state should be treated as sensitive:

- private keys and session state should not live casually in plain localStorage;
- prefer IndexedDB plus WebCrypto non-extractable keys where practical;
- document what is protected from the server and what is still exposed to a compromised device/browser;
- avoid logging plaintext, private keys, message keys, or packet secrets.

## Chatroom Boundary

The registered-user chatroom is not private one-to-one ASTR.

For v1.3.0:

- keep chatroom clearly separate from private ASTR conversations;
- do not describe chatroom messages as end-to-end encrypted unless a group protocol is actually implemented;
- if group privacy is explored, model it as a separate group-state-transition protocol with membership epochs.

## Testing Requirements

v1.3.0 should add protocol-focused tests for:

- initial session creation;
- Alice sends / Bob receives;
- Bob sends / Alice receives;
- simultaneous sends;
- out-of-order delivery;
- skipped message keys;
- replayed packet rejection;
- wrong transcript hash rejection;
- wrong direction rejection;
- wrong counter rejection;
- identity key change handling;
- channel reset / new epoch behavior;
- server database not containing plaintext for new private messages.

Test vectors should use deterministic keys and packet fixtures where possible.

## Non-Goals For v1.3.0

- Do not claim Signal-equivalent security without external review.
- Do not claim ASTR is more secure than Signal.
- Do not hide identity-key changes from users.
- Do not implement group chat privacy by pretending one-to-one ratchets solve group membership.
- Do not add multi-device sync until one-device session correctness is stable.

## Definition Of Done

v1.3.0 is done when:

- request acceptance can create a real client-held cryptographic session;
- server never receives private key material;
- server stores only opaque private message packets for new v1.3 messages;
- message keys are unique and deleted after use;
- out-of-order private messages work within a bounded skip window;
- replay, reorder, wrong-counter, and wrong-transcript packets are rejected or quarantined;
- receiving a new ratchet public key advances root and chain keys;
- compromise recovery behavior is documented and test-covered;
- identity-key changes produce explicit safety handling;
- protocol test vectors exist and run in CI/local checks;
- README and changelog clearly state that v1.3 is hardening toward Signal-grade design, not a claim of superiority.

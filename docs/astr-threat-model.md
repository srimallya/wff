# ASTR Threat Model

ASTR currently targets client-side encrypted private messages for accepted one-to-one WFF conversations.

## Protects

- Private message content is encrypted in the browser before storage.
- New private messages are stored with empty plaintext body fields.
- Transcript-bound packet validation detects basic replay, reorder, wrong-direction, wrong-counter, and wrong-previous-transcript cases where the current structural checks apply.
- Local v4 transcript state detects server omission or rewrite of previously verified message history.
- Trust-on-first-use identity pinning detects remote identity-key changes after the first local observation.
- The Conversation security panel exposes a safety-number foundation and local verified/unverified state.
- Browser-held private key material is not intentionally uploaded to the server.

## Server Visibility

The current server still observes:

- user accounts;
- accepted conversation relationships;
- message request state;
- packet timing and sizes;
- Socket.IO routing and room activity;
- push-notification delivery metadata;
- read-state metadata.

ASTR does not currently hide the conversation graph from the server.

## Does Not Protect

- A compromised browser or device.
- XSS that can access the app runtime or IndexedDB.
- Malicious browser extensions.
- Timing/IP correlation.
- Full metadata privacy.
- Recovery from lost local keys without a future recovery design.

## Current Cryptographic Limitations

- Current signed prekey data is placeholder material.
- One-time prekeys are not implemented.
- Current v4 packet state commitment is not a real DH ratchet public key.
- Identity pinning is local TOFU. It detects later key substitution but cannot prove that the first observed key was authentic without out-of-band verification.
- Server channel state is still advisory ordering metadata and must not be treated as cryptographic authority.
- A true per-device Double Ratchet state remains future work.
- The implementation has not had an external cryptographic audit.

## Hardening Needs

- Strict CSP and XSS hardening.
- Real signed prekeys and one-time prekeys.
- Per-device sessions.
- Broader identity and device management for real multi-device use.
- Bounded skipped-message-key cache.
- More adversarial tests for tampering, replay, reorder, and device changes.

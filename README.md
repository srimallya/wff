# World Foresight Forum

A global public foresight and policy forum for possible futures.

People write time-capsule posts about the futures they think are coming, attach a target year and country, then read, search, vote, and discuss the public forecasts other people are willing to name.

Current product version: `v1.3`

Production path: `https://thetrustcommons.com/wff/`

## Core Features

- Future-dated posts with a time slider.
- Country tagging, including a `Global` option.
- Generated public names with private login names.
- Guest reader mode.
- Semantic search, voting, and year filtering.
- Dedicated post pages with Reddit-style comment threads.
- Upvotes and downvotes for both posts and comments.
- Message requests, accepted private conversations, registered-user chatroom, and PWA notifications.
- Policy proposal extraction for education, economy, environment, health, and governance.
- ASTR encrypted private-message packets for accepted one-to-one conversations.

## ASTR Private Messaging

ASTR means Authenticated State-Transition Ratchet. In WFF, a private conversation is modeled as a replicated private state machine, and each private message is treated as an authenticated state-transition command. The transcript hash is the commitment clients use to verify the accepted channel history.

ASTR is WFF's own client-side encrypted private-message layer. It is not externally audited and is not yet a complete Double Ratchet implementation. The current implementation provides encrypted packet storage and transcript-ordered state commitment while the protocol moves toward Signal-like security properties.

ASTR is used only for accepted one-to-one private conversations. It is separate from the public forum, public comments, message requests, and the registered-user chatroom.

### What Exists Now

The current private-message send path uses `astr-v4-client-state-aead` for new packets. Older stored `astr-v3-ratchet-aead` and `astr-v2-client-aead` packets remain readable for compatibility.

Registered users create browser-held ECDH identity keys using WebCrypto. The private key material stays in browser storage through IndexedDB; the server receives public key bundle data and encrypted packet metadata.

When a registered user opens or uses private messaging, the client registers a key bundle through:

```text
POST /api/messages/key-bundle
```

The bundle includes:

- user public identity key;
- signed-prekey public key field, currently a placeholder for the future signed prekey design;
- signature placeholder;
- device id;
- key update timestamps.

Conversation payloads include participant key bundles so the client can encrypt for the other side. New private messages must be sent as ASTR packets. The server rejects new plaintext sends for accepted private one-to-one conversations and stores an empty plaintext body for new private messages.

### Packet Shape

New ASTR v4 messages carry metadata equivalent to:

```text
ASTRPacket {
  version,
  epoch,
  direction,
  counter,
  previous_chain_length,
  sender_state_commitment,
  prev_transcript_hash,
  ciphertext,
  auth_tag
}
```

The older database column remains named `ratchet_public_key` for backward compatibility. For v4 packets, that column stores the `sender_state_commitment`; it is not a real DH ratchet public key.

The server validates packet shape and ordering. It checks that the packet belongs to the expected direction, uses the next expected counter, matches the previous transcript hash, includes state-commitment metadata, and produces the expected next transcript hash. These are structural delivery checks. The server is not the cryptographic authority because it does not have client secrets.

### Transcript Commitment

Each accepted private packet advances a transcript hash:

```text
T_n = Hash(T_{n-1} || direction || counter || sender_state_commitment || ciphertext || auth_tag)
```

This gives the server a way to reject obviously replayed, reordered, wrong-direction, wrong-counter, or wrong-transcript packets without storing plaintext. Clients must still recompute and verify cryptographic state locally before treating plaintext as accepted.

### Client Encryption

The browser derives message keys from ECDH material and conversation context. Current messages use per-message key derivation rather than storing message plaintext in the database. The server stores packet metadata and ciphertext fields, while the client decrypts messages locally.

The local client code keeps compatibility decrypt paths for older ASTR v2 and v3 messages.

Current limitation: server conversation state is still used as ordering metadata. Client-owned transcript verification and durable local v4 transcript state are implemented on conversation load, including local detection of omitted or rewritten server history.

The v4 client also stores local trust-on-first-use identity pins and shows a safety-number foundation in Conversation security settings. If the remote identity changes after first observation, normal sending is blocked until the user reviews and explicitly accepts the changed identity.

### ASTR Roadmap

Important remaining protocol work includes:

- externally reviewed X3DH-style initial key agreement;
- real signed-prekey verification;
- one-time prekeys;
- true rotating DH ratchet key pairs per ratchet step;
- bounded skipped-message-key storage for out-of-order messages;
- robust multi-device session synchronization;
- session reset and recovery flows;
- packet-level replay/reorder tests;
- external cryptographic review.

Until those are implemented and reviewed, describe ASTR precisely as WFF's encrypted packet and conversation-state system.

### Privacy Boundary

ASTR protects private message contents from normal server-side storage and binds packets to a transcript. Current WFF still exposes conversation metadata to the server, including the fact that two accounts have an accepted conversation. It does not yet hide timing, IP, push-notification, read-state, or Socket.IO routing metadata. Private-message content must not be used for public ranking or recommendation.

### Chatroom Boundary

The registered-user chatroom is not ASTR private messaging. It is a shared room for registered users and is not end-to-end encrypted group messaging.

## Recommendations Roadmap

WFF v1.3 targets the full first-generation recommendation and ranking system. The goal is to help readers discover useful foresight by country, year, topic, semantic relevance, relational graph context, votes, and discussion activity without creating an engagement-maximizing feed.

Planned ranking modes:

- `Recent`: newest posts first.
- `Important`: posts with stronger vote/comment and policy signals.
- `Relevant`: posts matching selected search, country, year, graph, or topic context.

The relational graph is internal infrastructure for recommendation and ranking, not a user-facing Profile page.

See [goal.md](goal.md) for the v1.3 recommendation and ASTR completion plan.

## Local Development

Backend:

```bash
cd backend
python app.py
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Production build:

```bash
cd frontend
npm install
npm run build
```

SQLite database: `backend/wff.db`.

## License

World Foresight Forum is licensed under the GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).

# World Foresight Forum

A global public foresight and policy forum for possible futures.

People write time-capsule posts about the futures they think are coming, attach a target year and country, then read, search, vote, and discuss the public forecasts other people are willing to name.

Current product version: `v1.1`

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
- ASTR v3 encrypted private-message packets for accepted one-to-one conversations.

## ASTR Ratchet Messaging

WFF includes an application-specific private messaging protocol called ASTR. In this app, ASTR is used for accepted one-to-one private conversations. It is separate from the public forum, public comments, message requests, and the registered-user chatroom.

ASTR should be understood as a state-transition and packet-validation layer for WFF private messages. It is not a claim of Signal-equivalent security, and it should not be marketed as stronger than Signal. The current implementation is meaningful hardening over plaintext private-message storage, but the remaining cryptographic work is documented below.

### What Exists Now

The current private-message path uses `astr-v3-ratchet-aead` packet metadata. Registered users create browser-held ECDH identity keys using WebCrypto. The private key material stays in browser storage through IndexedDB; the server receives only public key bundle data and encrypted packet metadata.

When a registered user opens or uses private messaging, the client registers a key bundle through:

```text
POST /api/messages/key-bundle
```

The bundle includes:

- user public identity key;
- signed-prekey public key field;
- signature placeholder;
- device id;
- key update timestamps.

Conversation payloads include participant key bundles so the client can encrypt for the other side. New private messages are sent as ASTR packets with an empty plaintext body on the server.

### Packet Shape

New ASTR v3 messages carry metadata equivalent to:

```text
ASTRPacket {
  version,
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

The server validates the packet as a conversation state transition. It checks that the packet belongs to the expected direction, uses the next expected counter, matches the previous transcript hash, includes ratchet metadata, and produces the expected next transcript hash.

### Transcript Commitment

Each accepted private packet advances a transcript hash:

```text
T_n = Hash(T_{n-1} || direction || counter || ratchet_public_key || ciphertext || auth_tag)
```

This gives the server a way to reject replayed, reordered, wrong-direction, wrong-counter, or wrong-transcript packets without seeing plaintext.

### Client Encryption

The browser derives message keys from ECDH material and conversation context. ASTR v3 messages use per-message key derivation rather than storing message plaintext in the database. The server stores packet metadata and ciphertext fields, while the client decrypts messages locally.

The local client code also keeps a compatibility decrypt path for older ASTR v2 messages.

### What ASTR Is Not Yet

ASTR v3 is not yet a full audited Signal Double Ratchet implementation. Important remaining gaps include:

- externally reviewed X3DH-style initial key agreement;
- real signed-prekey verification;
- one-time prekeys;
- true rotating DH ratchet key pairs per ratchet step;
- bounded skipped-message-key storage for out-of-order messages;
- explicit identity-change warnings and safety-number UX;
- robust multi-device session synchronization;
- external cryptographic review.

Until those are implemented and reviewed, describe ASTR as WFF's encrypted packet and conversation-state system, not as Signal-grade security.

### Chatroom Boundary

The registered-user chatroom is not ASTR private messaging. It is a shared room for registered users and should not be described as end-to-end encrypted group messaging.

## Recommendations Roadmap

WFF v1.1 work now targets an explainable recommendation system. The goal is to help readers discover useful foresight by country, year, topic, semantic relevance, votes, and discussion activity without creating an engagement-maximizing feed.

Planned ranking modes:

- `Recent`: newest posts first.
- `Important`: posts with stronger vote/comment and policy signals.
- `Relevant`: posts matching the selected search, country, year, or topic context.

See [goal.md](goal.md) for the v1.1 recommendation plan.

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

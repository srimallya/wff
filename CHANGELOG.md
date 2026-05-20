# Changelog

## v1.3.0

### ASTR Hardening
- Added browser-held ECDH identity keys for registered users.
- Added public key bundle registration under the messaging API.
- Conversation payloads now include participant key bundles and richer channel state.
- Added `astr-v3-ratchet-aead` packet support with epoch, previous-chain length, ratchet public key, transcript hash, ciphertext, and auth tag metadata.
- New v1.3 private messages use ECDH-derived shared secrets and per-message keys instead of the v1.2 deterministic conversation key.
- Server validation now checks v3 epoch, direction, counter, previous transcript hash, previous-chain length, ratchet public key presence, and transcript hash.
- New v1.3 messages are stored as opaque packets with empty plaintext body.
- Existing v1.2 messages remain readable through the v2 decrypt path.

### Identity And Session Safety
- Added server-side storage for public identity key, signed prekey public key, signature placeholder, and key bundle update timestamp.
- Added local browser key persistence through IndexedDB so private keys are not stored in ordinary app localStorage.
- Added key bundle status to user responses.

### Tests
- Added ASTR v3 transition tests for valid packet acceptance, replay counter rejection, wrong transcript rejection, and wrong direction rejection.

### Security Status
- v1.3 is still not Signal-equivalent and should not be marketed as stronger than Signal.
- This release reduces the most serious v1.2 weakness by replacing the deterministic client key with browser-held ECDH identity key material.
- Remaining work includes externally reviewed X3DH, signed prekey verification, true DH ratchet public-key rotation, robust skipped-message-key queues, identity-change UX, and multi-device support.

## v1.2.0

### Messaging Navigation
- Reorganized Profile messaging into the top-level views `বার্তা`, `চ্যাটরুম`, and `আমার কল্পনাসমূহ`.
- Moved private conversation navigation under `বার্তা` with a smaller nested toggle for `কথোপকথন` and `অনুরোধ`.
- Reduced the visual weight of the segmented controls so the active tab does not dominate the page.
- Fixed the chatroom panel height on mobile so the composer fits inside the visible display.

### Chatroom
- Added a shared `চ্যাটরুম` for registered non-guest users.
- Added backend chatroom persistence with the `chatroom_message` table.
- Added chatroom REST endpoints for loading and sending messages.
- Added Socket.IO broadcast for live chatroom messages.
- Added optimistic chatroom sending so new messages appear immediately.
- Kept chatroom separate from private request/thread flows.
- Guest accounts remain blocked from chatroom, private messages, invites, notifications, and personal essay management.

### ASTR v2 Private Messaging
- Added client-side ASTR packet creation in the browser.
- Added client-side decryption for ASTR private messages.
- New private messages now send ciphertext/authenticated packet metadata to the server.
- Server-side private message storage now accepts ASTR v2 packets and stores an empty plaintext body for new encrypted messages.
- Added server validation for ASTR packet direction, counter, previous transcript hash, transcript hash, ciphertext, and auth tag presence.
- Conversation payloads now expose participant and channel state needed by the client ASTR packet flow.
- Existing v1.1 messages remain readable during migration.

### Realtime
- Added chatroom Socket.IO room join and broadcast helpers.
- Preserved existing realtime behavior for private messages, requests, accepted requests, removed threads, and essays.

### Production Deployment
- Deployed v1.2 through the canonical `/Users/srimallyamaitra/codes/kaal-probaho` production repo mounted by `ttc_webapp`.
- Rebuilt `/kaal-probaho` frontend assets for production.
- Restarted the TrustCommons Gunicorn/Eventlet webapp service.
- Verified public health, Socket.IO handshake, push-notification configuration, updated assets, and chatroom schema.

### Security Status
- v1.2 is a major improvement over the v1.1 server-side ASTR scaffold because new private messages are no longer stored as plaintext.
- v1.2 is not Signal-equivalent and should not be described as more secure than Signal.
- Remaining gaps include audited key agreement, full Double Ratchet key evolution, identity verification, post-compromise recovery, skipped-message-key handling, multi-device support, stronger local state protection, and external review.

## v1.1.0

### Messaging
- Added the `বার্তা` experience under Profile instead of adding a fourth top-level navigation tab.
- Added a three-way Profile view toggle for `বার্তা`, `অনুরোধ`, and `আমার কল্পনাসমূহ`.
- Added message requests as a separate product state from active conversations.
- Added request context notes with a 128-character limit.
- Added outgoing request cancellation and incoming request accept/delete actions.
- Ensured rejected, deleted, expired, and blocked requests do not appear as normal threads.
- Added active conversation threads with unread counts and highlighted unread state.
- Added full-screen conversation view with pinned composer for mobile/PWA use.
- Added message timestamps, read ticks, and date buckets for today, yesterday, this week, this month, and older groups.
- Fixed message timestamp rendering to use Asia/Kolkata time.
- Added conversation actions from the conversation header username:
  - delete chat
  - remove connection
  - block user
- Blocking now prevents future message requests between the same two users.

### Realtime and Optimistic UI
- Added Socket.IO/WebSocket realtime events for message requests, accepted requests, removed threads, new messages, and new essays.
- Added optimistic message sending so message bubbles appear immediately before server confirmation.
- Added optimistic essay creation so new posts appear immediately before server confirmation.
- Added a red circular startup loading screen to mask initial app latency.

### PWA Notifications
- Added PWA push subscription endpoints for Kaal Probaho.
- Added push notifications for new messages.
- Added push notifications for incoming message requests.
- Fixed notification click URLs so they stay under `/kaal-probaho`.
- Added VAPID fallback support for production when Kaal is mounted inside `ttc_webapp`.
- Local and mounted deployments can now report push configuration from the production host VAPID key.

### ASTR Scaffold
- Added server-side ASTR metadata scaffolding for accepted conversations.
- Conversation accept now creates placeholder channel state.
- New messages advance directional counters and transcript hashes.
- Message records now store ASTR direction, counter, previous transcript hash, next transcript hash, ciphertext, and authentication tag.
- Current limitation: this is not full client-held end-to-end ASTR yet. The server still stores plaintext for current UI and notification flows.

### Account and Permissions
- Guests and non-writing accounts are restricted from private messaging, requests, notification controls, and personal essay views.
- Guest and inactive-account cleanup rules were added:
  - guest/non-writing accounts unused for one month
  - writing accounts unused for one year
- Account deletion removes private conversations while preserving public posts.

### Production Deployment
- Documented that production is hosted from `/Users/srimallyamaitra/codes/ttc_webapp/app.py`, not the standalone Kaal backend.
- Added `/kaal-probaho` base-path support for API, static assets, and Socket.IO.
- Bound Kaal realtime handlers into the `ttc_webapp` Gunicorn/Eventlet Socket.IO host.
- Added schema-upgrade reuse so the production host applies Kaal message and ASTR columns.
- Verified public health and Socket.IO endpoints through `https://thetrustcommons.com/kaal-probaho`.

### Documentation
- Expanded README with app philosophy and ASTR protocol direction.
- Added command notes for local dev, production host launchd commands, public health checks, Socket.IO checks, and social preview checks.

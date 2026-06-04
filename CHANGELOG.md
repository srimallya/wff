# Changelog

## v1.4.3

### Now

- Reworked Now search as additive archive navigation: semantic query, optional region, and optional time depth work independently and hierarchically together.
- Removed instructional search breadcrumb text from the Now search controls.
- Made the Now histogram and slider archive-aware so the right edge represents Now and the left edge expands as stored stories age.
- Stopped applying a hidden default 7-day Now filter.

### Essays

- Added required essay titles with a 50-character limit on the Write page.
- Added title display to Forum cards with stronger typography.
- Added title validation and title-aware search/embedding inputs on the backend.
- Added a Cerebras-backed one-time title backfill job for legacy titleless essays.

## v1.4.2

### Messaging

- Added paged private-message loading so long threads open on the latest messages and fetch older messages on scroll.
- Added a message-page API with transcript state for encrypted ASTR page verification.
- Stopped realtime private-message updates from refetching the entire thread.
- Preserved scroll position when older messages are loaded above the current view.

## v1.4.1

### Now

- Added the production Now RSS refresh scheduler so new stories are fetched automatically.
- Kept web-push notifications enabled for newly inserted Now stories during scheduled refreshes.
- Normalized Now story card typography so the first story no longer renders larger than later stories.

## v1.4.0

### Now

- Added the server-backed Now page for RSS-derived current stories.
- Added WFF-owned RSS source seeding for BBC World, The Verge, NYT Technology, HT India, and Al Jazeera.
- Added a standalone Now ingestion pipeline that fetches RSS records, retrieves article text, summarizes and cleans stories with Cerebras `gpt-oss-120b`, infers story region in the same model call, stores original content, caches semantic embeddings, and deduplicates by canonical URL.
- Added `GET /api/now`, `POST /api/now/search`, `POST /api/now/refresh`, and story vote endpoints.
- Added Now search facets in semantic > region > time-slider order, including a rolling story histogram.
- Added upvotes/downvotes and Socket.IO events for new Now stories and story vote updates.
- Added web-push notification delivery for newly ingested Now stories using the existing private-message notification infrastructure.
- Added a gitignored WFF Cerebras secret path and runtime `.env` loader.

## v1.3.1

### Notifications

- Added a red notification bell to the Profile header for registered writing accounts.
- Added a notifications inbox showing the latest 20 comment notifications.
- Added stored notifications for comments on a user's post and replies to a user's comment.
- Notification items link directly to the relevant post and comment anchor.

### Writing Limits

- Increased public post content limit from 2,000 to 5,000 characters.
- Increased post comment and reply limit from 1,000 to 5,000 characters.

## v1.3.0

### Search And Discovery

- Added hierarchical search facets for the Forum feed: query first, country/global second, timeline third.
- Refactored search into `backend/services/search_service.py` with lexical matches first and semantic matches second.
- Extended `POST /api/essays/search` to accept `country_code`, `year`, `current_user_id`, and `limit` while preserving the existing `essays` and `total` response fields.
- Added contextual search facets for country counts and year counts.
- Kept year facets scoped to query + country before applying the selected year, so the timeline distribution remains visible while narrowing the result set.
- Updated normal feed year counts to respect the selected country.
- Reused the existing Feed page, search panel, country selector, and timeline slider for active search.
- Kept the Forum navigation reset path centralized through `resetFeedView`, clearing search state, filters, and contextual facets.
- Added backend and Zustand store tests for hierarchical search, contextual histograms, semantic fallback, and reset behavior.

### Future-Development Ranking

- Added backend-only recommendation infrastructure behind `GET /api/recommendations/feed`.
- Made ranked Forum ordering the default feed fetch path, with a remembered Profile toggle for switching back to chronological order.
- Split ranking code into candidate generation, feature hydration, scoring, and serving modules.
- Added candidate sources for recent posts, hierarchical search context, semantic neighbors, public vote affinity, comment development, policy posts, temporal gravity, and exploration.
- Added transparent future-development features for semantic relevance, country/year context, temporal gravity, policy specificity, vote affinity, smoothed vote quality, discussion development, constructive disagreement, freshness, exploration, and penalties.
- Added serving rules for author caps, country/year diversity, exploration reserve, downvote suppression, and debug-only reasons.
- Updated the internal recommendation graph to use public content-development edges only.
- Excluded private message contents, ASTR packet fields, `Message`, `MessageRequest`, and `Conversation` data from ranking.
- Documented WFF ranking as future-development ranking, not social ranking or an engagement feed.

## v1.2.0

World Foresight Forum is currently treated as v1.2. This release establishes the global English WFF product, hardens private messaging, moves the interface toward the Swiss design direction, fixes production posting, adds internal graph infrastructure for ranking, and improves PWA/social identity.

### Product And UI

- Rebranded the application as World Foresight Forum.
- Deployed under `https://thetrustcommons.com/wff/`.
- Changed the PWA app name to `wff`.
- Replaced app icons with the black `W` wordmark.
- Added PNG PWA icons and a refreshed social preview image.
- Added country tagging for posts, including a `Global` option.
- Added dedicated post pages with Reddit-style comment threads.
- Added upvotes and downvotes for both posts and comments.
- Moved the main navigation into a bottom text-only tab bar.
- Reworked the interface around Avenir Next, smaller font hierarchy, hairline separators, grey/black structure, and Swiss red for the primary action.
- Removed visible SVG button icons from the main UI.
- Added a searchable country input in the post composer.
- Added typable, auto-formatted birthdate entry in account creation.
- Replaced authenticated landing actions with a single `Enter` action.
- Fixed account drawer layering and scrolling so Support remains reachable.

### Messaging And Realtime

- Added message requests as a separate state before private conversations.
- Added active private conversation threads.
- Added request notes, request cancellation, request acceptance, and request deletion.
- Added full-screen conversation view with a pinned composer for mobile/PWA use.
- Added Socket.IO realtime events for message requests, accepted requests, removed threads, new private messages, chatroom messages, and new posts.
- Added a registered-user chatroom that is intentionally separate from private ASTR conversations.
- Guests and non-writing accounts remain blocked from private messages, chatroom, request flows, notifications, and personal post management.

### ASTR Private Messaging

- Added browser-held ECDH identity keys for registered users.
- Added IndexedDB persistence for local cryptographic identity material.
- Added public key bundle registration under the messaging API.
- Added per-device key bundle records so a user can publish the current device identity/prekey material.
- Conversation payloads include participant key bundles and channel state.
- Added `astr-v3-ratchet-aead` packet support with epoch, direction, counter, previous-chain length, ratchet public key payload, previous transcript hash, ciphertext, and auth tag metadata.
- New private messages use ECDH-derived shared secrets and per-message keys.
- Server validation checks epoch, direction, counter, previous transcript hash, previous-chain length, ratchet public key presence, and transcript hash.
- New private messages are stored as opaque encrypted packets with empty plaintext body.
- Older ASTR v2 messages remain readable through the v2 decrypt path.
- Blocked new plaintext fallback sends for accepted private one-to-one conversations.
- Introduced `astr-v4-client-state-aead` as the current send boundary with `sender_state_commitment` naming.
- Kept the legacy `ratchet_public_key` database column only for backward-compatible storage.
- Documented that current server validation is structural delivery/order validation, while client-owned cryptographic transcript verification remains v1.3 work.
- Added ASTR protocol, threat model, and privacy roadmap documents.

### ASTR Roadmap Status

- ASTR v3 is WFF's encrypted packet and conversation-state system for private one-to-one messages.
- ASTR v4 is the current honest packet naming boundary for new sends.
- The server stores public key bundles and encrypted packet metadata, not private key material.
- Remaining protocol work includes externally reviewed X3DH-style key agreement, signed prekey verification, one-time prekeys, true rotating DH ratchet keys, bounded skipped-message-key queues, identity-change UX, multi-device session sync, and external cryptographic review.

### Recommendations Roadmap

- Cloned and reviewed `twitter/the-algorithm` for ranking architecture lessons.
- Removed the user-facing graph map from Profile.
- Added an internal recommendation graph builder for future ranking features.
- Defined v1.3 full recommendation and ranking goals in `goal.md`.
- Planned ranking inputs from relational graph edges, country, target year, text embedding, votes, comments, policy category, search context, and future user-action events.
- Recommendation ranking must remain public-interest oriented, inspectable, and non-addictive.

### Production

- Production host is mounted by `/Users/srimallyamaitra/codes/ttc_webapp/app.py`.
- WFF routes, API, static assets, and Socket.IO use the `/wff` prefix.
- Production SQLite database is `backend/wff.db`.
- Production frontend assets are generated by `npm run build` in `frontend/`.
- Public checks:
  - `https://thetrustcommons.com/wff/`
  - `https://thetrustcommons.com/wff/api/health`
  - `https://thetrustcommons.com/wff/socket.io/?EIO=4&transport=polling`

## v1.0.0

### Initial WFF App

- Created WFF as a new English, global application derived from the existing foresight forum codebase.
- Separated WFF database storage from the source application.
- Added WFF branding, logo, app metadata, social preview metadata, and PWA manifest.
- Added AGPL-3.0-or-later licensing.
- Added local development and production deployment notes.

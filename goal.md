# Goal: World Foresight Forum v1.3 Ranking, Recommendations, And ASTR Completion

## Product Thesis

World Foresight Forum v1.3 should move from a chronological public archive into a public-interest discovery system. The purpose is not to maximize scrolling or reactions. The purpose is to help readers find useful imagined futures by country, year, topic, author credibility, discussion quality, and civic consequence.

The recommendation system must serve the forum's public-interest purpose:

- surface useful foresight across countries and time horizons;
- prevent early posts or popular users from permanently dominating attention;
- preserve a calm, Swiss-style reading interface;
- make discovery legible rather than mysterious;
- avoid addictive ranking loops;
- keep the relational graph internal as ranking infrastructure, not user-facing decoration.

## v1.3 Recommendation Scope

v1.3 should implement the full first-generation ranking and recommendation system. It should use a transparent ranking model first, then prepare the data foundation for later learned ranking.

### Architecture

The ranking architecture should follow the useful shape learned from `twitter/the-algorithm`, scaled down for WFF:

1. Candidate generation from multiple sources.
2. Feature hydration from graph, user-action, content, country, year, vote, comment, and embedding signals.
3. Light ranking to produce a small high-quality set.
4. Final scoring with diversity and safety rules.
5. Serving with reason metadata for debugging.

### Candidate Sources

Generate candidates from:

- fresh global posts;
- posts from countries the reader has written about, searched, commented on, or upvoted;
- posts near years or future horizons the reader has interacted with;
- posts from users with nearby public graph behavior;
- posts engaged by users with similar country/year/topic patterns;
- semantic matches to posts the reader wrote, searched, upvoted, or commented on;
- exploration candidates from underrepresented countries, years, and policy areas.

### Internal Relational Graph

Use `backend/services/recommendation_graph.py` as the internal graph source. The graph should include:

- `user -> post`: wrote;
- `user -> comment`: commented;
- `comment -> post`: on_post;
- `comment -> comment`: replied_to;
- `post -> country`: country;
- `post -> year`: target_year;
- `user -> user`: public interaction similarity only, unless accepted conversation graph use is explicitly privacy-reviewed later;
- `user -> post`: upvoted or downvoted;
- `user -> comment`: upvoted or downvoted.

This graph should not appear as a Profile tab. It is a feature source for ranking, candidate generation, and future explainability tools.

## Ranking Inputs

Use signals already present in the app:

- target calendar year;
- country and `Global` scope;
- post text;
- policy proposal category extraction;
- semantic search embedding;
- score from post votes;
- comment count and reply depth;
- author account status;
- recency and recent discussion activity;
- public interaction graph context;
- whether the reader is browsing a specific year, country, or search query.

Add new user-action events:

- post impression;
- post open;
- dwell time bucket;
- search query;
- country filter use;
- year slider use;
- hide, downvote, or report;
- recommendation source and rank position served.

These should feed a `wff_user_action` table and daily aggregate jobs.

## Ranking Modes

Add three clear modes:

- `Recent`: newest posts first.
- `Important`: high-quality posts with strong vote/comment and policy signals.
- `Relevant`: semantic, country, year, graph, and search-context relevance.

The default can remain `Recent` until enough logged signals exist to make `Relevant` dependable.

## Scoring Sketch

For the first transparent v1.3 ranker:

```text
score =
  0.22 * semantic_similarity
+ 0.18 * country_affinity
+ 0.14 * year_affinity
+ 0.14 * social_or_graph_affinity
+ 0.12 * post_quality
+ 0.10 * freshness
+ 0.06 * discussion_quality
+ 0.04 * exploration
- 0.20 * downvote_or_report_penalty
- 0.15 * repetition_penalty
```

For `important`:

```text
score = vote_quality
      + log(1 + comment_count)
      + policy_proposal_bonus
      + discussion_quality
      + freshness_floor
      - downvote_or_report_penalty
```

Keep weights in one backend module so they can be tuned without hunting through route code.

## Serving Rules

Apply serving rules after ranking:

- no more than two consecutive posts from the same author;
- no more than three consecutive posts from the same country;
- avoid repeating the same target-year bucket too often;
- keep at least 20 percent exploration when enough candidates exist;
- remove posts the reader already opened, commented on, or downvoted unless explicitly searching;
- prefer public-policy relevance over generic social chatter.

## Backend Plan

Add a recommendation endpoint:

```text
GET /api/recommendations/feed
```

Parameters:

```text
country_code
year
query
mode = recent | important | relevant
limit
offset
current_user_id
```

Response shape:

```json
{
  "essays": [],
  "mode": "relevant",
  "reasons": {
    "123": ["country_match", "semantic_match", "connected_user_discussed"]
  }
}
```

Implementation should reuse existing essay serialization, semantic embedding helpers, and the internal recommendation graph.

## Frontend Plan

The UI should stay minimal:

- add a small centered mode switch on the forum page;
- keep country and timeline controls visually quiet;
- show recommended posts in the same post card layout;
- avoid graph visualizations in the normal product UI;
- keep the primary action `Write` in Swiss red.

Recommended labels:

- Recent
- Important
- Relevant

No icons.

## Recommendation Guardrails

The recommendation system must not:

- rank purely by engagement;
- hide the chronological feed;
- create infinite-scroll addiction mechanics;
- make unexplained political or country-based boosts;
- use opaque ranking that cannot be inspected;
- use private messaging plaintext or ciphertext for ranking;
- use accepted private conversation relationships for ranking unless that use is explicitly documented, privacy-reviewed, and optional;
- expose the internal graph as a public profile feature.

## ASTR v1.3 Protocol Work

ASTR means Authenticated State-Transition Ratchet. ASTR should continue as WFF's application-specific encrypted packet and conversation-state system. The v1.3 goal is to close the known protocol gaps enough to make the contribution coherent, reviewable, and accurately documented.

The current v1.2 boundary is honest but incomplete: new private messages must be ASTR packets, plaintext fallback is blocked, and v4 names the packet commitment as `sender_state_commitment` rather than pretending it is a DH ratchet public key. The server still performs structural delivery checks and still advances advisory channel state. v1.3 should move cryptographic authority to the clients.

Pending ASTR work:

- client-side transcript recomputation from message history;
- local IndexedDB ASTR state per conversation and device;
- visible secure-state mismatch handling when local and server transcript views disagree;
- externally reviewed X3DH-style initial key agreement;
- signed-prekey verification instead of placeholder signature fields;
- one-time prekeys for stronger asynchronous session setup;
- true rotating DH ratchet key pairs per ratchet step;
- bounded skipped-message-key storage for out-of-order delivery;
- identity-change warnings;
- safety-number or key-verification UX;
- robust multi-device session synchronization;
- session reset and recovery flows;
- packet-level replay/reorder tests;
- privacy hardening for routing and graph metadata;
- external cryptographic review of the protocol and implementation.

Implementation milestones:

1. Move transcript authority to clients and display only locally verified/decrypted private messages.
2. Add real signed prekeys and one-time prekeys.
3. Implement true per-device Double Ratchet state with skipped-message-key cache.
4. Add multi-device correctness.
5. Add identity verification UX and identity-change warnings.
6. Minimize server cryptographic authority to structural delivery checks.
7. Continue privacy hardening without claiming graph hiding.

Documentation should focus on ASTR's contribution:

- browser-held identity material;
- server-visible state transitions without plaintext visibility;
- transcript commitment;
- per-message packet validation;
- encrypted packet storage;
- clear separation between private conversations and public/chatroom surfaces.

## Tests

Add backend tests for:

- country match ranking;
- year-distance ranking;
- graph-affinity ranking;
- semantic query ranking;
- vote/comment ranking;
- diversity constraints;
- pagination;
- empty database behavior;
- malformed parameter handling;
- ASTR packet replay rejection;
- ASTR wrong-counter rejection;
- ASTR identity/prekey validation.

Add frontend checks for:

- mode switch rendering;
- empty states;
- selected country plus recommendation mode;
- mobile layout with the bottom tab bar;
- no visible graph tab in Profile.

## Definition Of Done

v1.3 recommendation and ASTR work is done when:

- `/api/recommendations/feed` returns ranked posts with reason metadata;
- the forum page can switch between Recent, Important, and Relevant;
- country/year/search/graph context influences `Relevant`;
- user-action events are logged for future learned ranking;
- the internal graph contributes to candidate generation or ranking without being public UI;
- ASTR pending protocol work is implemented or explicitly versioned into a later milestone;
- ranking and ASTR behavior are covered by focused tests;
- README and changelog document the recommendation model and ASTR contribution clearly;
- production `/wff` serves the new build without breaking signup, login, posting, comments, or messages.

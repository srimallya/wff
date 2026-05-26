# WFF Future-Development Ranking

WFF ranking is a backend system for surfacing imagined futures that are useful for policy development. It uses public actions such as votes, comments, search context, country/year filters, policy categories, semantic similarity, and discussion structure. It does not use private messaging data or author popularity as primary ranking signals.

Search excavates a domain. Ranking orders the excavation. Recommendation suggests adjacent future-development nodes.

## Architecture

WFF borrows the useful service shape from X/Twitter without borrowing the engagement objective:

1. Candidate generation.
2. Feature hydration.
3. Scoring and ranking.
4. Filtering, deduplication, diversity, and exploration serving rules.
5. Optional debug metadata for backend/API testing.

The public Forum feed remains chronological in v1.3. The recommendation engine is available through a backend endpoint for controlled testing.

## Privacy Boundary

Ranking must not use:

- private message plaintext;
- private message ciphertext;
- ASTR packet fields;
- private conversation contents;
- accepted private-message relationships;
- `MessageRequest` rows;
- `Conversation` rows;
- `Message` rows.

Only public posts, public comments, public post votes, public comment votes, policy proposal metadata, country/year context, and semantic embeddings are valid ranking inputs.

## Candidate Sources

The v1.3 backend candidate generators are:

- `recent_posts`: recent public essays for freshness and cold start.
- `search_context_posts`: hierarchical search result sets when query/country/year context exists.
- `semantic_neighbor_posts`: posts embedding-similar to public posts the reader wrote, upvoted, or commented on, plus recent query context.
- `vote_affinity_posts`: bounded public-vote collaborative candidates.
- `comment_development_posts`: posts with substantive public comments, replies, and positively received comments.
- `policy_posts`: posts marked as policy proposals or linked to a `PolicyProposal` category.
- `temporal_gravity_posts`: posts whose target year is approaching the current year.
- `exploration_posts`: underrepresented countries, year buckets, and policy categories with enough substance.

There are no follow candidates and no social-neighborhood candidates.

## Features

Each candidate is hydrated into a `RecommendationFeatures` object:

- `semantic_relevance`
- `country_context_relevance`
- `target_year_relevance`
- `temporal_gravity`
- `policy_specificity`
- `user_upvote_affinity`
- `user_downvote_penalty`
- `aggregate_vote_quality`
- `downvote_ratio_penalty`
- `discussion_development_quality`
- `constructive_disagreement`
- `freshness`
- `recent_activity`
- `exploration_bonus`
- `repetition_penalty`
- `author_concentration_penalty`
- `spam_or_badfaith_penalty`
- `already_seen_penalty`

Author identity and generated public names are weak signals only. The ranker does not create author popularity ranking.

## Score

Weights live in `backend/services/recommendation_ranker.py`:

```text
score =
  0.18 * semantic_relevance
+ 0.13 * user_upvote_affinity
+ 0.11 * country_context_relevance
+ 0.10 * target_year_relevance
+ 0.10 * discussion_development_quality
+ 0.10 * policy_specificity
+ 0.08 * aggregate_vote_quality
+ 0.07 * constructive_disagreement
+ 0.07 * freshness
+ 0.06 * temporal_gravity
+ 0.05 * exploration_bonus
- 0.14 * user_downvote_penalty
- 0.12 * downvote_ratio_penalty
- 0.10 * repetition_penalty
- 0.10 * author_concentration_penalty
- 0.20 * spam_or_badfaith_penalty
- 0.08 * already_seen_penalty
```

Search mode uses a search-weighted variant that gives `semantic_relevance`, country context, and target-year context more control. Search filters remain hard constraints.

## Vote Quality

Aggregate votes are smoothed so a single early vote does not dominate:

```text
smoothed_vote_quality =
  (upvotes + 2) / (upvotes + downvotes + 5)
```

Downvote ratio remains a separate penalty.

## Discussion Development

Discussion quality is separate from raw engagement. It uses:

- comment count;
- reply count;
- average comment length;
- public comment score sum;
- distinct public commenters;
- public comment downvote ratio.

The feature is capped so a large argument cannot dominate ranking.

## Constructive Disagreement

Constructive disagreement receives a small boost only when mixed public votes are paired with substantive discussion:

- at least one upvote and one downvote;
- downvote ratio between `0.15` and `0.55`;
- at least two comments;
- average comment length at least `80`;
- comment scores are not heavily negative.

Extreme downvote ratios and negative comment paths are penalties, not rewards.

## Temporal Gravity

A WFF post is a public future commitment. Posts regain relevance as their target year approaches:

```text
temporal_gravity = min(0.12, 1 / (1 + abs(target_year - current_year)))
```

The implementation also adds small capped boosts for near-horizon target years. Far-future posts remain eligible.

## Serving Rules

Serving applies after scoring:

- no more than two posts from the same author in the top 20;
- avoid repeated same-country runs;
- avoid repeated target-year bucket runs;
- reserve exploration slots when enough candidates exist;
- strongly suppress user-downvoted posts outside explicit search;
- hide debug reasons unless `debug=true`.

Year buckets:

- `current-3`
- `4-10`
- `11-25`
- `26-50`
- `51-100`

## API

Backend-only test endpoint:

```text
GET /api/recommendations/feed
```

Params:

- `current_user_id`
- `query`
- `country_code`
- `year`
- `limit`
- `offset`
- `debug`

Response:

```json
{
  "essays": [],
  "total": 0,
  "debug": {
    "candidate_counts": {},
    "reasons": {
      "42": [
        "semantic_relevance=0.81",
        "policy_specificity=0.70",
        "score=0.423"
      ]
    }
  }
}
```

The `debug` object is omitted unless `debug=true`.

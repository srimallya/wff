# WFF Recommendation And Ranking Plan

This plan adapts the useful parts of `twitter/the-algorithm` to WFF without copying its scale or social-media assumptions.

## What We Keep From Twitter's Architecture

Twitter's feed stack is organized as:

1. Candidate generation from multiple sources.
2. Feature hydration from graph, user action, embedding, and safety systems.
3. Light ranking to shrink the candidate set.
4. Heavy ranking for final relevance.
5. Filtering, deduplication, diversity, and serving.

For WFF, the same shape is correct, but the implementation should be smaller and transparent. We do not need a visible graph page. The graph is an internal feature source for ranking.

## WFF Graph

WFF should maintain a typed relationship graph:

- `user -> post`: wrote
- `user -> comment`: commented
- `comment -> post`: on_post
- `comment -> comment`: replied_to
- `post -> country`: country
- `post -> year`: target_year
- `user -> user`: connected by accepted message request or conversation
- `user -> post`: upvoted or downvoted
- `user -> comment`: upvoted or downvoted

The first internal builder is `backend/services/recommendation_graph.py`. It returns nodes and weighted edges for ranking code, not for public UI.

## Candidate Sources

WFF should generate candidates from several sources and then merge them.

1. Fresh global posts:
   Recent posts, lightly boosted if they have early comments or upvotes.

2. Country-aware posts:
   Posts from countries the reader has written about, commented on, upvoted, or searched.

3. Year-aware posts:
   Posts near future years the reader tends to read or write about.

4. Social-neighborhood posts:
   Posts written or discussed by people connected to the reader through accepted message requests or conversations.

5. Collaborative graph posts:
   Posts engaged by users who behave similarly to the reader, using shared countries, years, authors, upvotes, and comments.

6. Semantic posts:
   Posts whose embeddings are close to posts the reader wrote, upvoted, commented on, or searched for.

## Features

Hydrate each candidate post with:

- Post quality: length, author account status, score, comment count, downvote ratio.
- Recency: post age and activity recency.
- Country match: reader-country affinity score.
- Year match: distance between target year and reader's preferred future horizon.
- Author affinity: reader-author interaction strength.
- Social proof: connected users who wrote, upvoted, or commented.
- Semantic similarity: embedding similarity between reader profile and post.
- Diversity metadata: author, country, year bucket, and semantic cluster.
- Safety/trust: hidden/deleted users, abusive content flags when available, self-spam signals.

## Ranking Formula For V1.3

Use a transparent weighted score before training any ML model:

```text
score =
  0.22 * semantic_similarity
+ 0.18 * country_affinity
+ 0.14 * year_affinity
+ 0.14 * social_affinity
+ 0.12 * post_quality
+ 0.10 * freshness
+ 0.06 * discussion_quality
+ 0.04 * exploration
- 0.20 * downvote_or_report_penalty
- 0.15 * repetition_penalty
```

Then apply serving rules:

- No more than two consecutive posts from the same author.
- No more than three consecutive posts from the same country.
- Keep at least 20 percent exploration when enough candidates exist.
- Remove posts the reader already opened, commented on, or downvoted unless explicitly searching.
- Prefer public-policy relevance over generic social chatter.

## Learned Ranking After V1.3

After enough events exist, train a small model to predict:

- comment probability
- upvote probability
- long-read probability
- constructive-reply probability
- downvote/report probability

The final score should be multi-objective:

```text
final_score =
  p_constructive_comment * 2.0
+ p_upvote * 1.0
+ p_long_read * 0.8
- p_downvote * 1.5
- p_report * 3.0
+ diversity_bonus
```

## Event Logging Needed

WFF currently has posts, comments, votes, message relationships, countries, and years. Ranking will improve once we add explicit read events:

- post impression
- post open
- dwell time bucket
- search query
- country filter use
- year slider use
- hide/downvote/report

These events should feed a `wff_user_action` table and daily aggregates.

## Implementation Steps

1. Keep the graph internal.
2. Add `wff_user_action` for impressions, opens, searches, and filter use.
3. Add a `/api/recommendations/feed` endpoint that returns ranked posts.
4. Replace the default feed query with ranked recommendations when a registered user is logged in.
5. Keep the search endpoint separate and deterministic.
6. Add debug-only ranking explanations for development, not visible in normal UI.

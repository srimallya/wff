# Goal: World Foresight Forum v1.1 Recommendation System

## Product Thesis

World Foresight Forum v1.1 should become more than a chronological archive of future-facing posts. It should help readers discover the most relevant imagined futures by year, country, topic, and civic consequence without turning the product into an engagement-maximizing social feed.

The recommendation system must serve the forum's public-interest purpose:

- surface useful foresight across countries and time horizons;
- prevent early posts or popular users from permanently dominating attention;
- preserve a calm, Swiss-style reading interface;
- make discovery legible rather than mysterious;
- avoid addictive ranking loops.

## v1.1 Recommendation Scope

The first recommendation release should focus on explainable ranking and filters, not opaque personalization.

### Inputs

Use signals already present in the app:

- target calendar year;
- country and `Global` scope;
- post text;
- policy proposal category extraction;
- semantic search embedding;
- score from post votes;
- comment count;
- recency;
- whether the reader is browsing a specific year, country, or search query.

### Ranking Modes

Add three clear modes:

- `Recent`: newest posts first.
- `Important`: high-quality posts with strong vote/comment signals.
- `Relevant`: semantic similarity to the current search, selected country, year, or topic context.

The default should remain calm and understandable. `Recent` is the safest first default until the ranking quality is proven.

### Explainability

Each recommended post should be able to expose a short reason internally, such as:

- "Matches your selected country."
- "Close to the selected year."
- "Similar to your search."
- "Active discussion."
- "Policy proposal in health."

The UI does not need to show all of these by default, but the backend should return enough metadata to debug ranking decisions.

## Backend Plan

Add a recommendation endpoint:

```text
GET /api/essays/recommendations
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
    "123": ["country_match", "semantic_match"]
  }
}
```

Implementation should reuse the existing essay serialization and semantic embedding helpers. Avoid adding a separate data store until there is real scale pressure.

## Scoring Sketch

For `important`:

```text
score = vote_score
      + log(1 + comment_count)
      + policy_proposal_bonus
      + freshness_floor
```

For `relevant`:

```text
score = semantic_similarity
      + country_match_bonus
      + year_distance_bonus
      + vote_quality_bonus
      + discussion_bonus
```

Keep weights simple and inspectable. Store constants in one backend module so they can be tuned without hunting through route code.

## Frontend Plan

The UI should stay minimal:

- add a small centered mode switch on the forum page;
- keep country and timeline controls visually quiet;
- show recommended posts in the same post card layout;
- avoid cards inside cards or heavy badges;
- keep the primary action `Write` in Swiss red.

Recommended labels:

- Recent
- Important
- Relevant

No icons.

## Guardrails

The recommendation system must not:

- rank purely by engagement;
- hide the chronological feed;
- require private user profiling;
- create infinite-scroll addiction mechanics;
- make unexplained political or country-based boosts;
- use opaque ranking that cannot be inspected.

## Tests

Add backend tests for:

- country match ranking;
- year-distance ranking;
- semantic query ranking;
- vote/comment ranking;
- pagination;
- empty database behavior;
- malformed parameter handling.

Add frontend checks for:

- mode switch rendering;
- empty states;
- selected country plus recommendation mode;
- mobile layout with the bottom tab bar.

## Definition Of Done

v1.1 recommendation work is done when:

- `/api/essays/recommendations` returns ranked posts with reason metadata;
- the forum page can switch between Recent, Important, and Relevant;
- country/year/search context influences `Relevant`;
- ranking is covered by focused tests;
- README and changelog document the recommendation model clearly;
- production `/wff` serves the new build without breaking signup, login, posting, comments, or messages.

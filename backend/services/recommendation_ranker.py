from dataclasses import dataclass


RANKING_WEIGHTS = {
    'semantic_relevance': 0.18,
    'user_upvote_affinity': 0.13,
    'country_context_relevance': 0.11,
    'target_year_relevance': 0.10,
    'discussion_development_quality': 0.10,
    'policy_specificity': 0.10,
    'aggregate_vote_quality': 0.08,
    'constructive_disagreement': 0.07,
    'freshness': 0.07,
    'temporal_gravity': 0.06,
    'exploration_bonus': 0.05,
    'user_downvote_penalty': -0.14,
    'downvote_ratio_penalty': -0.12,
    'repetition_penalty': -0.10,
    'author_concentration_penalty': -0.10,
    'spam_or_badfaith_penalty': -0.20,
    'already_seen_penalty': -0.08,
}

SEARCH_RANKING_WEIGHTS = {
    **RANKING_WEIGHTS,
    'semantic_relevance': 0.36,
    'country_context_relevance': 0.14,
    'target_year_relevance': 0.12,
    'exploration_bonus': 0.02,
    'freshness': 0.04,
}


@dataclass
class ScoredEssay:
    essay: object
    features: object
    score: float
    sources: set


def score_features(features, search_mode=False):
    weights = SEARCH_RANKING_WEIGHTS if search_mode else RANKING_WEIGHTS
    score = 0.0
    for name, weight in weights.items():
        score += weight * getattr(features, name)
    return score


def rank_candidates(candidates, features_by_id, search_mode=False):
    scored = []
    for essay_id, payload in candidates.items():
        essay = payload['essay']
        features = features_by_id[essay_id]
        scored.append(ScoredEssay(
            essay=essay,
            features=features,
            score=score_features(features, search_mode=search_mode),
            sources=set(payload.get('sources', set())),
        ))
    scored.sort(key=lambda item: (item.score, item.essay.created_at), reverse=True)
    return scored

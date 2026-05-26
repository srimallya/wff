from collections import Counter
import math

from backend.services.recommendation_features import hydrate_features, year_bucket
from backend.services.recommendation_ranker import rank_candidates


def _is_exploration(scored):
    return 'exploration_posts' in scored.sources or scored.features.exploration_bonus >= 0.55


def _passes_diversity(scored, selected, author_counts, top_author_limit):
    if len(selected) < 20 and author_counts[scored.essay.user_id] >= top_author_limit:
        return False
    if len(selected) >= 2:
        last_two = selected[-2:]
        if all((item.essay.country_code or 'GLOBAL') == (scored.essay.country_code or 'GLOBAL') for item in last_two):
            if (scored.essay.country_code or 'GLOBAL') == (last_two[-1].essay.country_code or 'GLOBAL'):
                return False
        if all(year_bucket(item.essay.target_calendar_year) == year_bucket(scored.essay.target_calendar_year) for item in last_two):
            return False
    return True


def apply_serving_rules(scored_items, limit=20, offset=0, search_mode=False):
    if search_mode:
        filtered = [
            item for item in scored_items
            if item.features.spam_or_badfaith_penalty < 0.75
        ]
        return filtered[offset:offset + limit]

    top_author_limit = 2
    selected = []
    author_counts = Counter()
    deferred = []

    for item in scored_items:
        if item.features.spam_or_badfaith_penalty >= 0.75:
            continue
        if item.features.user_downvote_penalty >= 0.95:
            deferred.append(item)
            continue
        if _passes_diversity(item, selected, author_counts, top_author_limit):
            selected.append(item)
            author_counts[item.essay.user_id] += 1
        else:
            deferred.append(item)

    for item in deferred:
        if len(selected) >= max(limit + offset, 20):
            break
        if item.features.spam_or_badfaith_penalty < 0.75 and item.features.user_downvote_penalty < 0.95:
            if len(selected) < 20 and author_counts[item.essay.user_id] >= top_author_limit:
                continue
            selected.append(item)
            author_counts[item.essay.user_id] += 1

    target_exploration = max(1, math.ceil(min(limit, len(selected)) * 0.20))
    exploration_count = sum(1 for item in selected[:limit + offset] if _is_exploration(item))
    if exploration_count < target_exploration:
        exploration_pool = [
            item for item in scored_items
            if _is_exploration(item)
            and item.features.spam_or_badfaith_penalty < 0.50
            and item.features.user_downvote_penalty < 0.80
            and item not in selected
        ]
        for item in exploration_pool[:target_exploration - exploration_count]:
            insert_at = min(len(selected), max(3, len(selected) // 2))
            selected.insert(insert_at, item)

    deduped = []
    seen = set()
    for item in selected:
        if item.essay.id in seen:
            continue
        seen.add(item.essay.id)
        deduped.append(item)
    return deduped[offset:offset + limit]


def build_recommendation_feed(candidates, source_counts, context, limit=20, offset=0):
    essays = [payload['essay'] for payload in candidates.values()]
    features_by_id = hydrate_features(essays, context)

    author_seen = Counter()
    for payload in candidates.values():
        essay = payload['essay']
        feature = features_by_id[essay.id]
        feature.author_concentration_penalty = min(1.0, author_seen[essay.user_id] / 4.0)
        author_seen[essay.user_id] += 1

    scored = rank_candidates(candidates, features_by_id, search_mode=context.search_mode)
    served = apply_serving_rules(scored, limit=limit, offset=offset, search_mode=context.search_mode)
    debug = {
        'candidate_counts': source_counts,
        'reasons': {
            str(item.essay.id): item.features.debug_reasons + [
                f'score={item.score:.3f}',
                f'sources={",".join(sorted(item.sources))}',
            ]
            for item in served
        },
    }
    return served, debug

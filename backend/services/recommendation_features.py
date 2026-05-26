from dataclasses import dataclass, field
from datetime import datetime
import math

from backend.models import Comment, CommentVote, Essay, Vote


MECHANISM_WORDS = {
    'policy', 'budget', 'law', 'institution', 'school', 'health', 'governance',
    'infrastructure', 'tax', 'land', 'energy', 'water', 'education',
}


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def safe_log_norm(value, scale=5.0):
    return clamp(math.log1p(max(0, value)) / scale)


def year_bucket(year, current_year=None):
    current_year = current_year or datetime.utcnow().year
    distance = max(0, int(year or current_year) - current_year)
    if distance <= 3:
        return 'current-3'
    if distance <= 10:
        return '4-10'
    if distance <= 25:
        return '11-25'
    if distance <= 50:
        return '26-50'
    return '51-100'


def cosine_for_essays(left, right):
    if not left or not right or not left.embedding_json or not right.embedding_json:
        return 0.0
    try:
        from backend.services.embedding import cosine_similarity, embedding_from_json

        left_embedding = embedding_from_json(left.embedding_json)
        right_embedding = embedding_from_json(right.embedding_json)
        if left_embedding is None or right_embedding is None:
            return 0.0
        return clamp((cosine_similarity(left_embedding, right_embedding) + 1.0) / 2.0)
    except Exception:
        return 0.0


@dataclass
class RecommendationContext:
    current_user_id: int | None = None
    query: str = ''
    country_code: str | None = None
    year: int | None = None
    search_mode: bool = False
    query_embedding: object | None = None
    source_map: dict = field(default_factory=dict)


@dataclass
class RecommendationFeatures:
    essay_id: int
    semantic_relevance: float = 0.0
    country_context_relevance: float = 0.0
    target_year_relevance: float = 0.0
    temporal_gravity: float = 0.0
    policy_specificity: float = 0.0
    user_upvote_affinity: float = 0.0
    user_downvote_penalty: float = 0.0
    aggregate_vote_quality: float = 0.0
    downvote_ratio_penalty: float = 0.0
    discussion_development_quality: float = 0.0
    constructive_disagreement: float = 0.0
    freshness: float = 0.0
    recent_activity: float = 0.0
    exploration_bonus: float = 0.0
    repetition_penalty: float = 0.0
    author_concentration_penalty: float = 0.0
    spam_or_badfaith_penalty: float = 0.0
    already_seen_penalty: float = 0.0
    debug_reasons: list = field(default_factory=list)


def smoothed_vote_quality(upvotes, downvotes, prior_positive=2, prior_total=5):
    return clamp((upvotes + prior_positive) / max(upvotes + downvotes + prior_total, 1))


def downvote_ratio(upvotes, downvotes):
    return clamp(downvotes / max(upvotes + downvotes, 1))


def policy_specificity(essay):
    content = (essay.content or '').lower()
    score = 0.0
    if essay.is_policy_proposal:
        score += 0.45
    if essay.policy_proposal:
        score += 0.25
    if len(content) > 500:
        score += 0.15
    if any(word in content for word in MECHANISM_WORDS):
        score += 0.15
    return clamp(score)


def discussion_stats(essay):
    comments = list(essay.comments)
    comment_count = len(comments)
    reply_count = sum(1 for comment in comments if comment.parent_id)
    total_length = sum(len(comment.content or '') for comment in comments)
    average_length = total_length / comment_count if comment_count else 0
    comment_upvotes = sum(comment.upvotes for comment in comments)
    comment_downvotes = sum(comment.downvotes for comment in comments)
    comment_score_sum = sum(comment.score for comment in comments)
    distinct_commenters = len({comment.user_id for comment in comments})
    total_comment_votes = comment_upvotes + comment_downvotes
    comment_downvote_ratio = comment_downvotes / max(total_comment_votes, 1)
    return {
        'comment_count': comment_count,
        'reply_count': reply_count,
        'average_length': average_length,
        'comment_upvotes': comment_upvotes,
        'comment_downvotes': comment_downvotes,
        'comment_score_sum': comment_score_sum,
        'distinct_commenters': distinct_commenters,
        'comment_downvote_ratio': comment_downvote_ratio,
    }


def discussion_development_quality(essay):
    stats = discussion_stats(essay)
    score = (
        0.30 * safe_log_norm(stats['comment_count'], 4.0)
        + 0.20 * safe_log_norm(stats['reply_count'], 3.0)
        + 0.20 * clamp(stats['average_length'] / 300.0)
        + 0.20 * clamp((stats['comment_score_sum'] + 3.0) / 8.0)
        + 0.10 * safe_log_norm(stats['distinct_commenters'], 3.0)
        - 0.25 * clamp(stats['comment_downvote_ratio'])
    )
    return clamp(score, 0.0, 0.85)


def constructive_disagreement(essay):
    upvotes = essay.upvotes
    downvotes = essay.downvotes
    ratio = downvote_ratio(upvotes, downvotes)
    stats = discussion_stats(essay)
    if (
        upvotes >= 1
        and downvotes >= 1
        and 0.15 <= ratio <= 0.55
        and stats['comment_count'] >= 2
        and stats['average_length'] >= 80
        and stats['comment_score_sum'] >= 0
    ):
        return 0.35
    return 0.0


def temporal_gravity(essay, current_year=None):
    current_year = current_year or datetime.utcnow().year
    distance = abs((essay.target_calendar_year or current_year) - current_year)
    score = min(0.12, 1.0 / (1.0 + distance))
    if 0 <= (essay.target_calendar_year or current_year) - current_year <= 3:
        score += 0.08
    elif 0 <= (essay.target_calendar_year or current_year) - current_year <= 5:
        score += 0.05
    elif 0 <= (essay.target_calendar_year or current_year) - current_year <= 10:
        score += 0.03
    return clamp(score)


def freshness(essay):
    if not essay.created_at:
        return 0.0
    age_days = max(0.0, (datetime.utcnow() - essay.created_at).total_seconds() / 86400.0)
    return clamp(math.exp(-age_days / 30.0))


def recent_activity(essay):
    timestamps = [essay.created_at] if essay.created_at else []
    timestamps.extend(comment.created_at for comment in essay.comments if comment.created_at)
    if not timestamps:
        return 0.0
    age_days = max(0.0, (datetime.utcnow() - max(timestamps)).total_seconds() / 86400.0)
    return clamp(math.exp(-age_days / 14.0))


def target_year_relevance(essay, selected_year=None, current_year=None):
    if selected_year is not None:
        return clamp(math.exp(-abs((essay.target_calendar_year or selected_year) - selected_year) / 5.0))
    return clamp(temporal_gravity(essay, current_year) / 0.20)


def country_context_relevance(essay, country_code=None):
    if not country_code:
        return 0.35 if (essay.country_code or '').upper() == 'GLOBAL' else 0.25
    essay_code = (essay.country_code or 'GLOBAL').upper()
    country_code = country_code.upper()
    if essay_code == country_code:
        return 1.0
    if essay_code == 'GLOBAL':
        return 0.45
    return 0.0


def semantic_relevance(essay, context):
    if context.query_embedding is not None and essay.embedding_json:
        try:
            from backend.services.embedding import cosine_similarity, embedding_from_json

            essay_embedding = embedding_from_json(essay.embedding_json)
            if essay_embedding is not None:
                return clamp((cosine_similarity(context.query_embedding, essay_embedding) + 1.0) / 2.0)
        except Exception:
            pass
    sources = context.source_map.get(essay.id, set())
    if 'search_context_posts' in sources:
        return 0.85
    if 'semantic_neighbor_posts' in sources:
        return 0.65
    return 0.20 if not context.query else 0.0


def user_vote_affinity(essay, context):
    if not context.current_user_id:
        return 0.0, 0.0

    user_votes = Vote.query.filter(Vote.user_id == context.current_user_id).all()
    upvote_similarity = 0.0
    downvote_similarity = 0.0
    candidate_category = essay.policy_proposal.category if essay.policy_proposal else None
    candidate_bucket = year_bucket(essay.target_calendar_year)

    for vote in user_votes:
        if vote.essay_id == essay.id:
            if vote.value > 0:
                upvote_similarity = max(upvote_similarity, 0.65)
            elif vote.value < 0:
                downvote_similarity = max(downvote_similarity, 1.0)
            continue
        other = Essay.query.get(vote.essay_id)
        if not other:
            continue
        similarity = cosine_for_essays(essay, other)
        if (other.country_code or '').upper() == (essay.country_code or '').upper():
            similarity = max(similarity, 0.45)
        if year_bucket(other.target_calendar_year) == candidate_bucket:
            similarity = max(similarity, 0.35)
        other_category = other.policy_proposal.category if other.policy_proposal else None
        if candidate_category and candidate_category == other_category:
            similarity = max(similarity, 0.50)
        if vote.value > 0:
            upvote_similarity = max(upvote_similarity, similarity)
        elif vote.value < 0:
            downvote_similarity = max(downvote_similarity, similarity)

    comment_votes = (
        CommentVote.query
        .join(Comment, Comment.id == CommentVote.comment_id)
        .filter(CommentVote.user_id == context.current_user_id)
        .all()
    )
    candidate_discussion_quality = discussion_development_quality(essay)
    for comment_vote in comment_votes:
        comment = Comment.query.get(comment_vote.comment_id)
        if not comment:
            continue
        other = Essay.query.get(comment.essay_id)
        if not other:
            continue
        similarity = max(cosine_for_essays(essay, other), candidate_discussion_quality * 0.6)
        if comment_vote.value > 0 and essay.comments:
            upvote_similarity = max(upvote_similarity, similarity * 0.75)
        elif comment_vote.value < 0:
            downvote_similarity = max(downvote_similarity, similarity * 0.85)

    return clamp(upvote_similarity), clamp(downvote_similarity)


def spam_or_badfaith_penalty(essay):
    content = (essay.content or '').strip()
    if len(content) < 80:
        return 0.45
    repeated_punctuation = content.count('!!!') + content.count('???')
    if repeated_punctuation >= 2:
        return 0.20
    if essay.downvotes >= 3 and downvote_ratio(essay.upvotes, essay.downvotes) > 0.75:
        return 0.55
    return 0.0


def exploration_bonus(essay, corpus):
    if not corpus:
        return 0.0
    country_counts = {}
    bucket_counts = {}
    category_counts = {}
    for item in corpus:
        country_counts[item.country_code or 'GLOBAL'] = country_counts.get(item.country_code or 'GLOBAL', 0) + 1
        bucket = year_bucket(item.target_calendar_year)
        bucket_counts[bucket] = bucket_counts.get(bucket, 0) + 1
        category = item.policy_proposal.category if item.policy_proposal else 'none'
        category_counts[category] = category_counts.get(category, 0) + 1

    country_share = country_counts.get(essay.country_code or 'GLOBAL', 0) / max(len(corpus), 1)
    bucket_share = bucket_counts.get(year_bucket(essay.target_calendar_year), 0) / max(len(corpus), 1)
    category = essay.policy_proposal.category if essay.policy_proposal else 'none'
    category_share = category_counts.get(category, 0) / max(len(corpus), 1)
    return clamp((1.0 - country_share + 1.0 - bucket_share + 1.0 - category_share) / 3.0)


def hydrate_features(essays, context):
    corpus = Essay.query.order_by(Essay.created_at.desc()).limit(1000).all()
    features = {}
    for essay in essays:
        upvotes = essay.upvotes
        downvotes = essay.downvotes
        upvote_affinity, downvote_penalty = user_vote_affinity(essay, context)
        feature = RecommendationFeatures(
            essay_id=essay.id,
            semantic_relevance=semantic_relevance(essay, context),
            country_context_relevance=country_context_relevance(essay, context.country_code),
            target_year_relevance=target_year_relevance(essay, context.year),
            temporal_gravity=temporal_gravity(essay),
            policy_specificity=policy_specificity(essay),
            user_upvote_affinity=upvote_affinity,
            user_downvote_penalty=downvote_penalty,
            aggregate_vote_quality=smoothed_vote_quality(upvotes, downvotes),
            downvote_ratio_penalty=downvote_ratio(upvotes, downvotes),
            discussion_development_quality=discussion_development_quality(essay),
            constructive_disagreement=constructive_disagreement(essay),
            freshness=freshness(essay),
            recent_activity=recent_activity(essay),
            exploration_bonus=exploration_bonus(essay, corpus),
            spam_or_badfaith_penalty=spam_or_badfaith_penalty(essay),
        )
        feature.debug_reasons = debug_reasons_for_feature(feature)
        features[essay.id] = feature
    return features


def debug_reasons_for_feature(feature):
    names = [
        'semantic_relevance', 'user_upvote_affinity', 'country_context_relevance',
        'target_year_relevance', 'discussion_development_quality', 'policy_specificity',
        'aggregate_vote_quality', 'constructive_disagreement', 'freshness',
        'temporal_gravity', 'exploration_bonus', 'user_downvote_penalty',
        'downvote_ratio_penalty', 'spam_or_badfaith_penalty',
    ]
    reasons = []
    for name in names:
        value = getattr(feature, name)
        if value >= 0.10:
            reasons.append(f'{name}={value:.2f}')
    return reasons

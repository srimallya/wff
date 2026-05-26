import json
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace

from flask import Flask

from backend.models import (
    Comment,
    CommentVote,
    Conversation,
    Essay,
    Message,
    MessageRequest,
    PolicyProposal,
    User,
    Vote,
    db,
)
from backend.routes.essays import essays_bp
from backend.routes.recommendations import recommendations_bp
from backend.services.recommendation_candidates import generate_recommendation_candidates
from backend.services.recommendation_features import (
    RecommendationContext,
    constructive_disagreement,
    discussion_development_quality,
    hydrate_features,
    smoothed_vote_quality,
    temporal_gravity,
)
from backend.services.recommendation_ranker import ScoredEssay
from backend.services.recommendation_serving import apply_serving_rules


def make_app():
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['SECRET_KEY'] = 'test-secret'
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['SQLALCHEMY_BINDS'] = {'wff': 'sqlite:///:memory:'}
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    app.register_blueprint(essays_bp, url_prefix='/essays')
    app.register_blueprint(recommendations_bp, url_prefix='/recommendations')
    with app.app_context():
        db.create_all()
    return app


def emb(x, y):
    return json.dumps([x, y])


class RecommendationInfrastructureTest(unittest.TestCase):
    def setUp(self):
        self.app = make_app()
        self.client = self.app.test_client()
        self.current_year = datetime.utcnow().year
        with self.app.app_context():
            users = [
                User(username='reader', real_username='reader', birthdate='1990-01-01', is_bengali=True, is_guest=False),
                User(username='author', real_username='author', birthdate='1991-01-01', is_bengali=True, is_guest=False),
                User(username='other', real_username='other', birthdate='1992-01-01', is_bengali=True, is_guest=False),
                User(username='peer', real_username='peer', birthdate='1993-01-01', is_bengali=True, is_guest=False),
            ]
            for user in users:
                user.set_password('password123')
            db.session.add_all(users)
            db.session.flush()
            self.reader_id = users[0].id
            self.author_id = users[1].id
            self.other_id = users[2].id
            self.peer_id = users[3].id

            anchor = self.add_essay(
                users[1].id,
                'Climate adaptation policy for city water budgets and school heat shelters.',
                'India',
                'IN',
                self.current_year + 5,
                emb(1, 0),
            )
            similar = self.add_essay(
                users[2].id,
                'Water infrastructure and climate governance plans for coastal districts.',
                'India',
                'IN',
                self.current_year + 6,
                emb(1, 0),
                is_policy=True,
            )
            downvote_like = self.add_essay(
                users[2].id,
                'Speculative entertainment prediction with weak public-development value.',
                'Global',
                'GLOBAL',
                self.current_year + 40,
                emb(0, 1),
            )
            discussion = self.add_essay(
                users[1].id,
                'Public health governance will need institutional budgets for heat response and clinics.',
                'Bangladesh',
                'BD',
                self.current_year + 2,
                emb(0.8, 0.1),
            )
            near_future = self.add_essay(
                users[2].id,
                'Near target year energy transition accountability and local implementation.',
                'Kenya',
                'KE',
                self.current_year,
                emb(0.2, 0.8),
            )
            far_future = self.add_essay(
                users[2].id,
                'Centennial future imagination for ocean governance and intergenerational institutions.',
                'Chile',
                'CL',
                self.current_year + 80,
                emb(0.3, 0.7),
            )

            self.anchor_id = anchor.id
            self.similar_id = similar.id
            self.downvote_like_id = downvote_like.id
            self.discussion_id = discussion.id
            self.near_future_id = near_future.id
            self.far_future_id = far_future.id

            db.session.add(PolicyProposal(essay_id=similar.id, extracted_summary='Water policy', category='environment'))
            db.session.add_all([
                Vote(user_id=self.reader_id, essay_id=anchor.id, value=1),
                Vote(user_id=self.reader_id, essay_id=downvote_like.id, value=-1),
                Vote(user_id=self.peer_id, essay_id=anchor.id, value=1),
                Vote(user_id=self.peer_id, essay_id=similar.id, value=1),
                Vote(user_id=self.other_id, essay_id=discussion.id, value=1),
                Vote(user_id=self.peer_id, essay_id=discussion.id, value=-1),
            ])
            c1 = Comment(essay_id=discussion.id, user_id=self.other_id, content='This is a substantive disagreement about institutional budget sequencing and health capacity.')
            c2 = Comment(essay_id=discussion.id, user_id=self.peer_id, content='The timeline may be too optimistic, but the governance mechanism is testable.')
            db.session.add_all([c1, c2])
            db.session.flush()
            c3 = Comment(essay_id=discussion.id, user_id=self.reader_id, parent_id=c1.id, content='The local clinic constraint is the decisive implementation bottleneck.')
            db.session.add(c3)
            db.session.add_all([
                CommentVote(user_id=self.reader_id, comment_id=c1.id, value=1),
                CommentVote(user_id=self.reader_id, comment_id=c2.id, value=-1),
                CommentVote(user_id=self.peer_id, comment_id=c1.id, value=1),
            ])
            db.session.commit()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def add_essay(self, user_id, content, country, country_code, target_year, embedding_json, is_policy=False):
        essay = Essay(
            user_id=user_id,
            content=(content + ' ') * 5,
            country=country,
            country_code=country_code,
            look_ahead_months=max(0, (target_year - self.current_year) * 12),
            target_calendar_year=target_year,
            embedding_json=embedding_json,
            is_policy_proposal=is_policy,
            created_at=datetime.utcnow() - timedelta(days=max(0, target_year - self.current_year)),
        )
        db.session.add(essay)
        db.session.flush()
        return essay

    def essay(self, essay_id):
        return db.session.get(Essay, essay_id)

    def test_candidate_generation_sources_include_required_sets(self):
        with self.app.app_context():
            candidates, counts = generate_recommendation_candidates(current_user_id=self.reader_id, limit=20)
            self.assertIn(self.anchor_id, candidates)
            self.assertGreater(counts['recent_posts'], 0)
            self.assertGreater(counts['policy_posts'], 0)
            self.assertGreater(counts['comment_development_posts'], 0)
            self.assertGreater(counts['temporal_gravity_posts'], 0)
            self.assertGreater(counts['exploration_posts'], 0)

            search_candidates, search_counts = generate_recommendation_candidates(query='climate', country_code='IN', limit=20)
            self.assertGreater(search_counts['search_context_posts'], 0)
            self.assertTrue(all(payload['essay'].country_code == 'IN' for payload in search_candidates.values()))

    def test_user_vote_affinity_uses_post_and_comment_votes(self):
        with self.app.app_context():
            context = RecommendationContext(current_user_id=self.reader_id)
            similar = self.essay(self.similar_id)
            downvote_like = self.essay(self.downvote_like_id)
            discussion = self.essay(self.discussion_id)
            features = hydrate_features([similar, downvote_like, discussion], context)

            self.assertGreater(features[self.similar_id].user_upvote_affinity, 0.5)
            self.assertGreater(features[self.downvote_like_id].user_downvote_penalty, 0.8)
            self.assertGreater(features[self.discussion_id].user_upvote_affinity, 0.1)
            self.assertGreater(features[self.discussion_id].user_downvote_penalty, 0.1)

    def test_smoothed_vote_quality_prevents_one_vote_monarchy(self):
        low_vote = smoothed_vote_quality(1, 0)
        mature = smoothed_vote_quality(8, 2)
        self.assertGreater(mature, low_vote)
        self.assertLess(low_vote, 1.0)

        with self.app.app_context():
            context = RecommendationContext()
            features = hydrate_features([self.essay(self.discussion_id)], context)
            self.assertGreater(features[self.discussion_id].downvote_ratio_penalty, 0.0)

    def test_discussion_development_rewards_substance_not_short_noise(self):
        with self.app.app_context():
            quiet = self.add_essay(self.author_id, 'Quiet future water policy detail.', 'India', 'IN', self.current_year + 4, emb(1, 0))
            noisy = self.add_essay(self.author_id, 'Noisy but shallow climate comment path.', 'India', 'IN', self.current_year + 4, emb(1, 0))
            db.session.add(Comment(essay_id=noisy.id, user_id=self.other_id, content='bad'))
            db.session.commit()

            discussion = self.essay(self.discussion_id)
            self.assertGreater(discussion_development_quality(discussion), discussion_development_quality(quiet))
            self.assertLess(discussion_development_quality(noisy), discussion_development_quality(discussion))

    def test_constructive_disagreement_and_extreme_downvotes(self):
        with self.app.app_context():
            self.assertGreater(constructive_disagreement(self.essay(self.discussion_id)), 0.0)
            extreme = self.add_essay(self.author_id, 'Bad-faith low-trust institutional claim.', 'India', 'IN', self.current_year + 1, emb(0, 1))
            db.session.add_all([
                Vote(user_id=self.reader_id, essay_id=extreme.id, value=-1),
                Vote(user_id=self.peer_id, essay_id=extreme.id, value=-1),
                Vote(user_id=self.other_id, essay_id=extreme.id, value=-1),
            ])
            db.session.commit()
            context = RecommendationContext(current_user_id=self.reader_id)
            features = hydrate_features([extreme], context)
            self.assertEqual(constructive_disagreement(extreme), 0.0)
            self.assertGreater(features[extreme.id].downvote_ratio_penalty, 0.9)

    def test_temporal_gravity_is_capped_without_erasing_far_future(self):
        with self.app.app_context():
            near = temporal_gravity(self.essay(self.near_future_id))
            far = temporal_gravity(self.essay(self.far_future_id))
            self.assertGreater(near, far)
            self.assertLessEqual(near, 1.0)
            self.assertGreater(far, 0.0)

    def test_serving_rules_limit_author_country_year_and_reserve_exploration(self):
        items = []
        for index in range(8):
            essay = SimpleNamespace(
                id=index + 1,
                user_id=1 if index < 5 else index,
                country_code='IN' if index < 4 else f'C{index}',
                target_calendar_year=self.current_year + 5,
                created_at=datetime.utcnow(),
            )
            features = SimpleNamespace(
                spam_or_badfaith_penalty=0.0,
                user_downvote_penalty=0.0,
                exploration_bonus=0.8 if index >= 6 else 0.0,
            )
            items.append(ScoredEssay(essay=essay, features=features, score=1.0 - index * 0.01, sources={'exploration_posts'} if index >= 6 else {'recent_posts'}))

        served = apply_serving_rules(items, limit=6)
        self.assertLessEqual(sum(1 for item in served[:6] if item.essay.user_id == 1), 2)
        self.assertTrue(any('exploration_posts' in item.sources for item in served))

    def test_private_rows_do_not_affect_candidate_generation(self):
        with self.app.app_context():
            before, before_counts = generate_recommendation_candidates(current_user_id=self.reader_id, limit=30)
            conversation = Conversation(user_one_id=self.reader_id, user_two_id=self.other_id, channel_state='private')
            db.session.add(conversation)
            db.session.flush()
            db.session.add(MessageRequest(sender_id=self.reader_id, receiver_id=self.other_id, status='active', conversation_id=conversation.id))
            db.session.add(Message(
                conversation_id=conversation.id,
                sender_id=self.reader_id,
                body='',
                astr_version='astr-v4-client-state-aead',
                ciphertext='private-ciphertext',
                auth_tag='a' * 64,
                transcript_hash='b' * 64,
                ratchet_public_key='sender-state-commitment',
            ))
            db.session.commit()

            after, after_counts = generate_recommendation_candidates(current_user_id=self.reader_id, limit=30)
            self.assertEqual(set(before.keys()), set(after.keys()))
            self.assertEqual(before_counts, after_counts)

    def test_recommendations_api_debug_boundary(self):
        plain = self.client.get('/recommendations/feed?current_user_id=1&limit=5')
        self.assertEqual(plain.status_code, 200)
        plain_data = plain.get_json()
        self.assertIn('essays', plain_data)
        self.assertIn('total', plain_data)
        self.assertNotIn('debug', plain_data)

        debug = self.client.get('/recommendations/feed?current_user_id=1&limit=5&debug=true')
        self.assertEqual(debug.status_code, 200)
        debug_data = debug.get_json()
        self.assertIn('debug', debug_data)
        self.assertIn('candidate_counts', debug_data['debug'])
        self.assertIn('reasons', debug_data['debug'])


if __name__ == '__main__':
    unittest.main()

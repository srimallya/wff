import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from flask import Flask

from backend.models import NowSource, NowStory, NowStoryVote, User, db
from backend.routes.now import now_bp
from backend.services.now_pipeline import FeedRecord, ensure_default_sources


def make_app():
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['SECRET_KEY'] = 'test-secret'
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['SQLALCHEMY_BINDS'] = {'wff': 'sqlite:///:memory:'}
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    app.register_blueprint(now_bp, url_prefix='/now')
    with app.app_context():
        db.create_all()
        ensure_default_sources()
    return app


class NowPipelineTest(unittest.TestCase):
    def setUp(self):
        self.app = make_app()
        self.client = self.app.test_client()
        with self.app.app_context():
            user = User(username='reader', real_username='reader', birthdate='1990-01-01', is_bengali=True, is_guest=False)
            user.set_password('password123')
            db.session.add(user)
            source = NowSource.query.filter_by(name='BBC World').first()
            story = NowStory(
                source_id=source.id,
                source_name=source.name,
                source_url=source.url,
                title='India launches new climate resilience plan',
                url='https://example.com/story',
                canonical_url='https://example.com/story',
                summary='India announced a climate resilience plan for major cities.',
                excerpt='India announced a resilience plan.',
                original_content='India climate resilience cities public health.',
                region='India',
                region_code='IND',
                published_at=datetime.utcnow() - timedelta(hours=2),
                fetched_at=datetime.utcnow(),
            )
            db.session.add(story)
            db.session.commit()
            self.story_id = story.id
            self.user_id = user.id

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_now_list_returns_regions_and_histogram(self):
        response = self.client.get('/now?q=climate&region_code=IND&hours_back=24')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()

        self.assertEqual(data['total'], 1)
        self.assertEqual(data['stories'][0]['region_code'], 'IND')
        self.assertEqual(data['facets']['regions'][0]['region_code'], 'IND')
        self.assertEqual(len(data['facets']['histogram']), 28)
        self.assertGreaterEqual(data['facets']['archive']['max_hours'], 1)
        self.assertEqual(data['facets']['archive']['selected_hours'], 24)

    def test_now_time_slice_filters_independently_and_ranks_by_votes(self):
        with self.app.app_context():
            source = NowSource.query.filter_by(name='BBC World').first()
            older_high = NowStory(
                source_id=source.id,
                source_name=source.name,
                source_url=source.url,
                title='Archive peak story with public signal',
                url='https://example.com/archive-peak-high',
                canonical_url='https://example.com/archive-peak-high',
                summary='A high signal archive story.',
                excerpt='A high signal archive story.',
                original_content='Archive story public signal.',
                region='Global',
                region_code='GLOBAL',
                published_at=datetime.utcnow() - timedelta(hours=9),
                fetched_at=datetime.utcnow(),
            )
            older_low = NowStory(
                source_id=source.id,
                source_name=source.name,
                source_url=source.url,
                title='Archive peak story without votes',
                url='https://example.com/archive-peak-low',
                canonical_url='https://example.com/archive-peak-low',
                summary='A lower signal archive story.',
                excerpt='A lower signal archive story.',
                original_content='Archive story lower signal.',
                region='Global',
                region_code='GLOBAL',
                published_at=datetime.utcnow() - timedelta(hours=8),
                fetched_at=datetime.utcnow(),
            )
            db.session.add_all([older_high, older_low])
            db.session.flush()
            db.session.add(NowStoryVote(user_id=self.user_id, story_id=older_high.id, value=1))
            db.session.commit()
            start = (datetime.utcnow() - timedelta(hours=10)).isoformat()
            end = (datetime.utcnow() - timedelta(hours=7)).isoformat()

        response = self.client.get(f'/now?time_start={start}&time_end={end}')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()

        self.assertEqual(data['total'], 2)
        self.assertEqual(data['stories'][0]['title'], 'Archive peak story with public signal')
        self.assertEqual(data['applied_filters']['time_start'], start)
        self.assertEqual(data['applied_filters']['time_end'], end)

    def test_now_story_vote_uses_existing_user_votes_shape(self):
        response = self.client.post(f'/now/{self.story_id}/vote', json={
            'username': 'reader',
            'value': 1,
        })
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['score'], 1)
        self.assertEqual(data['upvotes'], 1)
        self.assertEqual(data['user_vote'], 1)

    def test_now_story_comments_require_registered_writer_and_list_in_order(self):
        guest = User(username='guest', is_bengali=False, is_guest=True)
        with self.app.app_context():
            db.session.add(guest)
            db.session.commit()

        rejected = self.client.post(f'/now/{self.story_id}/comments', json={
            'username': 'guest',
            'content': 'Guest comment',
        })
        self.assertEqual(rejected.status_code, 403)

        created = self.client.post(f'/now/{self.story_id}/comments', json={
            'username': 'reader',
            'content': 'This story connects to regional resilience planning.',
        })
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.get_json()['username'], 'reader')

        response = self.client.get(f'/now/{self.story_id}/comments')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['total'], 1)
        self.assertEqual(data['comments'][0]['content'], 'This story connects to regional resilience planning.')

        story = self.client.get(f'/now/{self.story_id}').get_json()
        self.assertEqual(story['comment_count'], 1)

    def test_now_search_prioritizes_primary_fields_over_scraped_boilerplate(self):
        with self.app.app_context():
            source = NowSource.query.filter_by(name='BBC World').first()
            exact = NowStory(
                source_id=source.id,
                source_name=source.name,
                source_url=source.url,
                title='Anthropic releases new AI safety report',
                url='https://example.com/anthropic-primary',
                canonical_url='https://example.com/anthropic-primary',
                summary='Anthropic published an AI safety report about model evaluations.',
                excerpt='Anthropic AI safety report.',
                original_content='Primary article body about model evaluations.',
                region='United States',
                region_code='US',
                published_at=datetime.utcnow() - timedelta(days=5),
                fetched_at=datetime.utcnow(),
            )
            polluted = NowStory(
                source_id=source.id,
                source_name='HT India',
                source_url=source.url,
                title='TMC crisis deepens as rebel MLAs meet',
                url='https://example.com/polluted-politics',
                canonical_url='https://example.com/polluted-politics',
                summary='A regional party crisis deepened after rebel lawmakers met.',
                excerpt='A regional political dispute.',
                original_content='Article sidebar: Anthropic OpenAI Google technology market links.',
                region='India',
                region_code='IND',
                published_at=datetime.utcnow() - timedelta(days=1),
                fetched_at=datetime.utcnow(),
            )
            db.session.add_all([exact, polluted])
            db.session.commit()

        response = self.client.get('/now?q=Anthropic')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()

        self.assertGreaterEqual(data['total'], 1)
        self.assertEqual(data['stories'][0]['title'], 'Anthropic releases new AI safety report')
        self.assertNotIn('TMC crisis deepens as rebel MLAs meet', [story['title'] for story in data['stories']])

    def test_now_search_keeps_semantic_relevance_after_filtering(self):
        with self.app.app_context():
            source = NowSource.query.filter_by(name='BBC World').first()
            close = NowStory(
                source_id=source.id,
                source_name=source.name,
                source_url=source.url,
                title='Heavy rain adaptation plan for city hospitals',
                url='https://example.com/rain-adaptation',
                canonical_url='https://example.com/rain-adaptation',
                summary='Hospitals prepare flood resilience measures.',
                excerpt='Flood resilience planning.',
                original_content='City adaptation and hospital resilience.',
                region='India',
                region_code='IND',
                published_at=datetime.utcnow() - timedelta(hours=3),
                fetched_at=datetime.utcnow(),
            )
            noisy = NowStory(
                source_id=source.id,
                source_name=source.name,
                source_url=source.url,
                title='Cinema festival opens downtown',
                url='https://example.com/cinema',
                canonical_url='https://example.com/cinema',
                summary='A cultural festival opens with public screenings.',
                excerpt='Cinema festival.',
                original_content='Entertainment listings.',
                region='India',
                region_code='IND',
                published_at=datetime.utcnow() - timedelta(hours=1),
                fetched_at=datetime.utcnow(),
            )
            db.session.add_all([close, noisy])
            db.session.commit()

        def fake_embedding(text):
            lowered = text.lower()
            if 'monsoon readiness' in lowered:
                return [1.0, 0.0]
            if 'flood resilience' in lowered or 'rain adaptation' in lowered:
                return [0.95, 0.05]
            return [0.0, 1.0]

        with patch('backend.services.embedding.get_embedding', side_effect=fake_embedding):
            response = self.client.get('/now?q=monsoon%20readiness&region_code=IND')

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertGreaterEqual(data['total'], 1)
        self.assertEqual(data['stories'][0]['title'], 'Heavy rain adaptation plan for city hospitals')

    def test_refresh_dedupes_url_and_stores_summary_region_and_raw_content(self):
        def fake_records(source):
            return [
                FeedRecord(
                    source=source,
                    title='Beirut ceasefire story',
                    summary='Israel bombed Beirut suburbs after a ceasefire.',
                    url='https://example.com/beirut?utm_source=rss',
                    published_at=datetime.utcnow(),
                )
            ]

        with patch('backend.services.now_pipeline.fetch_feed_records', side_effect=fake_records), \
             patch('backend.services.now_pipeline.fetch_article_text', return_value='Full article text about Beirut and Lebanon.'), \
             patch('backend.services.now_pipeline.summarize_with_cerebras', return_value={
                 'summary': 'Israel bombed Beirut suburbs after a ceasefire.',
                 'excerpt': 'Israel bombed Beirut suburbs.',
                 'region': 'Lebanon',
                 'region_code': 'LBN',
                 'summary_status': 'generated',
                 'summary_model': 'gpt-oss-120b',
                 'failure_reason': '',
             }), \
             patch('backend.services.now_pipeline.send_now_story_notifications', return_value=[]):
            first = self.client.post('/now/refresh', json={'limit_per_source': 1, 'notify': False}).get_json()
            second = self.client.post('/now/refresh', json={'limit_per_source': 1, 'notify': False}).get_json()

        self.assertGreaterEqual(first['created'], 1)
        self.assertEqual(second['created'], 0)
        with self.app.app_context():
            story = NowStory.query.filter_by(region_code='LBN').first()
            self.assertIsNotNone(story)
            self.assertEqual(story.summary_status, 'generated')
            self.assertIn('Full article text', story.original_content)
            self.assertEqual(story.url, 'https://example.com/beirut')


if __name__ == '__main__':
    unittest.main()

import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from flask import Flask

from backend.models import NowSource, NowStory, User, db
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

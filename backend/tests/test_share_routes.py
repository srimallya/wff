import unittest
from datetime import datetime

from flask import Flask

from backend.models import Essay, NowSource, NowStory, User, db
from backend.routes.share import share_bp


def make_app(share_prefix=''):
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['SQLALCHEMY_BINDS'] = {'wff': 'sqlite:///:memory:'}
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    app.register_blueprint(share_bp, url_prefix=share_prefix)
    with app.app_context():
        db.create_all()
    return app


class ShareRoutesTest(unittest.TestCase):
    def setUp(self):
        self.app = make_app()
        self.client = self.app.test_client()
        with self.app.app_context():
            user = User(username='author', real_username='author', birthdate='1990-01-01', is_bengali=True, is_guest=False)
            db.session.add(user)
            db.session.flush()
            essay = Essay(
                user_id=user.id,
                title='Civic Futures',
                content='This public foresight post explains institutions and future resilience in enough detail.',
                country='Global',
                country_code='GLOBAL',
                look_ahead_months=120,
                target_calendar_year=2036,
            )
            source = NowSource(name='WFF Source', url='https://example.com/rss')
            db.session.add(source)
            db.session.flush()
            story = NowStory(
                source_id=source.id,
                source_name=source.name,
                source_url=source.url,
                title='Global foresight summit opens',
                url='https://example.com/story',
                canonical_url='https://example.com/story',
                summary='A global summit opened with public-interest foresight work.',
                region='Global',
                region_code='GLOBAL',
                published_at=datetime.utcnow(),
                fetched_at=datetime.utcnow(),
            )
            db.session.add_all([essay, story])
            db.session.commit()
            self.essay_id = essay.id
            self.story_id = story.id

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_public_post_share_page_renders_metadata_and_app_link(self):
        response = self.client.get(f'/share/posts/{self.essay_id}')

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('Civic Futures', body)
        self.assertIn('property="og:title"', body)
        self.assertIn(f'/posts/{self.essay_id}', body)

    def test_public_now_share_page_renders_story(self):
        response = self.client.get(f'/share/now/{self.story_id}')

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('Global foresight summit opens', body)
        self.assertIn(f'/now?story={self.story_id}', body)

    def test_share_resolver_returns_title_for_same_app_url(self):
        response = self.client.get(f'/api/share/resolve?url=http://localhost/share/posts/{self.essay_id}')

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['kind'], 'post')
        self.assertEqual(data['title'], 'Civic Futures')
        self.assertEqual(data['app_path'], f'/posts/{self.essay_id}')

    def test_mounted_share_page_keeps_wff_prefix_in_links(self):
        app = make_app('/wff')
        client = app.test_client()
        with app.app_context():
            user = User(username='mounted', real_username='mounted', birthdate='1990-01-01', is_bengali=True, is_guest=False)
            db.session.add(user)
            db.session.flush()
            essay = Essay(
                user_id=user.id,
                title='Mounted Futures',
                content='This mounted public foresight post is long enough to render public metadata.',
                country='Global',
                country_code='GLOBAL',
                look_ahead_months=120,
                target_calendar_year=2036,
            )
            db.session.add(essay)
            db.session.commit()
            essay_id = essay.id

        response = client.get(f'/wff/share/posts/{essay_id}', base_url='https://thetrustcommons.com')

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn(f'https://thetrustcommons.com/wff/share/posts/{essay_id}', body)
        self.assertIn(f'https://thetrustcommons.com/wff/posts/{essay_id}', body)


if __name__ == '__main__':
    unittest.main()

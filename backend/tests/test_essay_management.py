import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from flask import Flask

from backend.models import Essay, User, db
from backend.routes.auth import auth_bp
from backend.routes.essays import essays_bp
from backend.services.essay_titles import backfill_essay_titles


def make_app():
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['SECRET_KEY'] = 'test-secret'
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['SQLALCHEMY_BINDS'] = {'wff': 'sqlite:///:memory:'}
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    app.register_blueprint(auth_bp, url_prefix='/auth')
    app.register_blueprint(essays_bp, url_prefix='/essays')
    with app.app_context():
        db.create_all()
    return app


class EssayManagementTest(unittest.TestCase):
    def setUp(self):
        self.emit_patcher = patch('backend.routes.essays.emit_global')
        self.emit_patcher.start()
        self.app = make_app()
        self.client = self.app.test_client()
        with self.app.app_context():
            author = User(username='author', real_username='author', birthdate='1990-01-01', is_bengali=True, is_guest=False)
            author.set_password('password123')
            other = User(username='other', real_username='other', birthdate='1992-01-01', is_bengali=True, is_guest=False)
            other.set_password('password123')
            db.session.add_all([author, other])
            db.session.flush()
            essay = Essay(
                user_id=author.id,
                title='Original Futures',
                content='This is a long enough original post about public futures and institutions.',
                country='Global',
                country_code='GLOBAL',
                look_ahead_months=120,
                target_calendar_year=2036,
            )
            old_essay = Essay(
                user_id=author.id,
                title='Old Futures',
                content='This is an old post that should no longer be manageable by the author.',
                country='Global',
                country_code='GLOBAL',
                look_ahead_months=120,
                target_calendar_year=2036,
                created_at=datetime.utcnow() - timedelta(days=31),
            )
            db.session.add_all([essay, old_essay])
            db.session.commit()
            self.essay_id = essay.id
            self.old_essay_id = old_essay.id

    def tearDown(self):
        self.emit_patcher.stop()

    def auth_headers(self, username='author'):
        response = self.client.post('/auth/login', json={
            'real_username': username,
            'password': 'password123',
        })
        csrf = response.get_json()['csrf_token']
        return {'X-CSRF-Token': csrf}

    def test_author_can_edit_once(self):
        headers = self.auth_headers()
        content = 'This edited post is long enough and clearly updates the original futures argument.'
        first = self.client.patch(f'/essays/{self.essay_id}', json={'content': content}, headers=headers)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.get_json()['title'], 'Original Futures')
        self.assertEqual(first.get_json()['content'], content)
        self.assertEqual(first.get_json()['edit_count'], 1)
        self.assertFalse(first.get_json()['can_edit'])

        second = self.client.patch(f'/essays/{self.essay_id}', json={'content': content + ' Again.'}, headers=headers)
        self.assertEqual(second.status_code, 403)

    def test_non_owner_cannot_edit(self):
        headers = self.auth_headers('other')
        response = self.client.patch(
            f'/essays/{self.essay_id}',
            json={'content': 'This is long enough but it belongs to a different account entirely.'},
            headers=headers,
        )
        self.assertEqual(response.status_code, 403)

    def test_create_requires_title_and_accepts_valid_title(self):
        headers = self.auth_headers()
        payload = {
            'username': 'author',
            'content': 'This new post is long enough to describe future institutions and civic trust clearly.',
            'look_ahead_months': 120,
            'country': 'Global',
            'country_code': 'GLOBAL',
        }
        missing = self.client.post('/essays', json=payload, headers=headers)
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.get_json()['error'], 'Title is required')

        created = self.client.post('/essays', json={**payload, 'title': 'Civic Trust Futures'}, headers=headers)
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.get_json()['title'], 'Civic Trust Futures')

    def test_old_post_cannot_be_deleted(self):
        headers = self.auth_headers()
        response = self.client.delete(f'/essays/{self.old_essay_id}', json={}, headers=headers)
        self.assertEqual(response.status_code, 403)

    def test_backfill_essay_titles_updates_titleless_posts(self):
        with self.app.app_context():
            essay = db.session.get(Essay, self.essay_id)
            essay.title = None
            db.session.commit()

            with patch('backend.services.essay_titles.generate_title_with_cerebras', return_value=('Generated Future', 'gpt-oss-120b', '')):
                result = backfill_essay_titles()

            self.assertEqual(result['updated'], 1)
            self.assertEqual(db.session.get(Essay, self.essay_id).title, 'Generated Future')


if __name__ == '__main__':
    unittest.main()

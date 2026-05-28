import unittest

from flask import Flask

from backend.models import Comment, Essay, User, db
from backend.routes.auth import auth_bp
from backend.routes.essays import essays_bp
from backend.routes.notifications import notifications_bp


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
    app.register_blueprint(notifications_bp, url_prefix='/notifications')
    with app.app_context():
        db.create_all()
    return app


class CommentNotificationTest(unittest.TestCase):
    def setUp(self):
        self.app = make_app()
        self.client = self.app.test_client()
        with self.app.app_context():
            author = User(username='author', real_username='author', birthdate='1990-01-01', is_bengali=True, is_guest=False)
            commenter = User(username='commenter', real_username='commenter', birthdate='1991-01-01', is_bengali=True, is_guest=False)
            replier = User(username='replier', real_username='replier', birthdate='1992-01-01', is_bengali=True, is_guest=False)
            for user in [author, commenter, replier]:
                user.set_password('password123')
            db.session.add_all([author, commenter, replier])
            db.session.flush()
            essay = Essay(
                user_id=author.id,
                content='This is a long enough post for testing stored comment notifications.',
                country='Global',
                country_code='GLOBAL',
                look_ahead_months=120,
                target_calendar_year=2036,
            )
            db.session.add(essay)
            db.session.commit()
            self.essay_id = essay.id

    def auth_headers(self, username):
        response = self.client.post('/auth/login', json={
            'real_username': username,
            'password': 'password123',
        })
        csrf = response.get_json()['csrf_token']
        return {'X-CSRF-Token': csrf}

    def test_comment_on_post_appears_in_author_notifications(self):
        self.client.post('/essays/{}/comments'.format(self.essay_id), json={
            'username': 'commenter',
            'content': 'This is a comment on the original post.',
        })

        response = self.client.get('/notifications', headers=self.auth_headers('author'))
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['total'], 1)
        self.assertEqual(data['notifications'][0]['kind'], 'post_comment')
        self.assertEqual(data['notifications'][0]['actor_username'], 'commenter')
        self.assertEqual(data['notifications'][0]['url'], f'/posts/{self.essay_id}#comment-{data["notifications"][0]["comment_id"]}')

    def test_reply_to_comment_appears_in_comment_author_notifications(self):
        first = self.client.post('/essays/{}/comments'.format(self.essay_id), json={
            'username': 'commenter',
            'content': 'This is a first comment that can receive a reply.',
        }).get_json()
        self.client.post('/essays/{}/comments'.format(self.essay_id), json={
            'username': 'replier',
            'content': 'This is a reply to the first comment.',
            'parent_id': first['id'],
        })

        response = self.client.get('/notifications', headers=self.auth_headers('commenter'))
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['total'], 1)
        self.assertEqual(data['notifications'][0]['kind'], 'comment_reply')
        self.assertEqual(data['notifications'][0]['parent_comment_id'], first['id'])
        self.assertEqual(data['notifications'][0]['actor_username'], 'replier')


if __name__ == '__main__':
    unittest.main()

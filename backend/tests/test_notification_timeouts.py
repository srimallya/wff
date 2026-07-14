import unittest
from unittest.mock import patch

from flask import Flask

from backend.models import PushSubscription, User, db
from backend.services.notifications import send_push_notification


class NotificationTimeoutTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config['TESTING'] = True
        self.app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        self.app.config['SQLALCHEMY_BINDS'] = {'wff': 'sqlite:///:memory:'}
        self.app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
        db.init_app(self.app)
        with self.app.app_context():
            db.create_all()
            user = User(username='push-reader')
            db.session.add(user)
            db.session.flush()
            db.session.add(PushSubscription(
                user_id=user.id,
                endpoint='https://push.example.test/subscription',
                p256dh='test-p256dh',
                auth='test-auth',
            ))
            db.session.commit()
            self.user_id = user.id

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_webpush_has_a_bounded_timeout(self):
        with self.app.app_context(), patch.dict('os.environ', {
            'VAPID_PUBLIC_KEY': 'public-key',
            'VAPID_PRIVATE_KEY': 'private-key',
            'WFF_PUSH_TIMEOUT_SECONDS': '4',
        }), patch('pywebpush.webpush') as webpush:
            result = send_push_notification(
                self.user_id, 'Now', 'A new story', '/wff/now?story=1',
            )

        self.assertEqual(result['sent'], 1)
        self.assertEqual(webpush.call_args.kwargs['timeout'], 4.0)


if __name__ == '__main__':
    unittest.main()

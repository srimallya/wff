import unittest
from unittest.mock import patch

from flask import Flask

from backend.models import Essay, User, db
from backend.routes.essays import essays_bp


def make_app():
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['SECRET_KEY'] = 'test-secret'
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['SQLALCHEMY_BINDS'] = {'wff': 'sqlite:///:memory:'}
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    app.register_blueprint(essays_bp, url_prefix='/essays')
    with app.app_context():
        db.create_all()
    return app


class SearchHierarchyTest(unittest.TestCase):
    def setUp(self):
        self.app = make_app()
        self.client = self.app.test_client()
        with self.app.app_context():
            author = User(username='author', real_username='author', birthdate='1990-01-01', is_bengali=True, is_guest=False)
            author.set_password('password123')
            db.session.add(author)
            db.session.flush()
            essays = [
                Essay(
                    user_id=author.id,
                    content='Climate resilience will shape Indian cities and public health systems.',
                    country='India',
                    country_code='IND',
                    look_ahead_months=48,
                    target_calendar_year=2030,
                ),
                Essay(
                    user_id=author.id,
                    content='Climate migration will require new Indian labor and housing policy.',
                    country='India',
                    country_code='IND',
                    look_ahead_months=168,
                    target_calendar_year=2040,
                ),
                Essay(
                    user_id=author.id,
                    content='Climate finance institutions will become global public infrastructure.',
                    country='Global',
                    country_code='GLOBAL',
                    look_ahead_months=108,
                    target_calendar_year=2035,
                ),
                Essay(
                    user_id=author.id,
                    content='Automation will reshape manufacturing wages and regional tax bases.',
                    country='United States',
                    country_code='USA',
                    look_ahead_months=48,
                    target_calendar_year=2030,
                ),
            ]
            db.session.add_all(essays)
            db.session.commit()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def post_search(self, payload):
        response = self.client.post('/essays/search', json=payload)
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def year_counts(self, data):
        return {item['year']: item['count'] for item in data['facets']['years']}

    def test_query_only_search_returns_query_year_facets(self):
        data = self.post_search({'query': 'climate'})

        self.assertEqual(data['total'], 3)
        self.assertIn('essays', data)
        self.assertIn('total', data)
        self.assertEqual(self.year_counts(data), {2030: 1, 2035: 1, 2040: 1})
        self.assertEqual(
            {item['country_code']: item['count'] for item in data['facets']['countries']},
            {'IND': 2, 'GLOBAL': 1},
        )

    def test_query_and_country_returns_year_facets_for_query_country_domain(self):
        data = self.post_search({'query': 'climate', 'country_code': 'IND'})

        self.assertEqual(data['total'], 2)
        self.assertEqual([essay['country_code'] for essay in data['essays']], ['IND', 'IND'])
        self.assertEqual(self.year_counts(data), {2030: 1, 2040: 1})

    def test_query_country_year_filters_essays_but_preserves_year_facets(self):
        data = self.post_search({'query': 'climate', 'country_code': 'IND', 'year': 2030})

        self.assertEqual(data['total'], 1)
        self.assertEqual(data['essays'][0]['target_calendar_year'], 2030)
        self.assertEqual(self.year_counts(data), {2030: 1, 2040: 1})
        self.assertEqual(data['applied_filters']['year'], 2030)

    def test_empty_query_returns_compatible_response_shape(self):
        data = self.post_search({'query': ''})

        self.assertEqual(data['total'], 4)
        self.assertIn('essays', data)
        self.assertIn('total', data)
        self.assertIn('facets', data)

    def test_semantic_fallback_works_when_lexical_match_fails(self):
        def fake_embedding(text):
            return [1.0, 0.0] if 'rain' in text.lower() or 'resilience' in text.lower() else [0.0, 1.0]

        with patch('backend.services.embedding.get_embedding', side_effect=fake_embedding):
            data = self.post_search({'query': 'rain'})

        self.assertGreaterEqual(data['total'], 1)
        self.assertEqual(data['essays'][0]['country_code'], 'IND')

    def test_missing_or_invalid_embeddings_do_not_crash_search(self):
        with self.app.app_context():
            essay = Essay.query.first()
            essay.embedding_json = '{bad-json'
            db.session.commit()

        with patch('backend.services.embedding.get_embedding', side_effect=RuntimeError('embedding offline')):
            data = self.post_search({'query': 'nonlexical'})

        self.assertEqual(data['total'], 0)
        self.assertEqual(data['essays'], [])

    def test_invalid_year_and_country_fail_gracefully(self):
        data = self.post_search({'query': 'climate', 'country_code': 'bad', 'year': 'not-a-year'})

        self.assertEqual(data['total'], 0)
        self.assertEqual(data['essays'], [])
        self.assertEqual(data['facets']['years'], [])
        self.assertEqual(data['applied_filters']['country_code'], 'BAD')
        self.assertIsNone(data['applied_filters']['year'])


if __name__ == '__main__':
    unittest.main()

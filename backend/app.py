import os
import sys
from datetime import timedelta
from flask import Flask, send_from_directory, jsonify
from flask_cors import CORS

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.models import db
from backend.routes.auth import auth_bp
from backend.routes.essays import essays_bp
from backend.routes.messages import cleanup_expired_media, messages_bp
from backend.routes.notifications import notifications_bp
from backend.routes.proposals import proposals_bp
from backend.services.account_cleanup import cleanup_inactive_accounts
from backend.services.realtime import socketio
from backend.services.schema import ensure_schema

APP_BASE_PATH = '/wff'


class BasePathMiddleware:
    def __init__(self, app, prefix):
        self.app = app
        self.prefix = prefix.rstrip('/')

    def __call__(self, environ, start_response):
        path = environ.get('PATH_INFO', '')
        if path == self.prefix:
            environ['SCRIPT_NAME'] = environ.get('SCRIPT_NAME', '') + self.prefix
            environ['PATH_INFO'] = '/'
        elif path.startswith(f'{self.prefix}/'):
            environ['SCRIPT_NAME'] = environ.get('SCRIPT_NAME', '') + self.prefix
            environ['PATH_INFO'] = path[len(self.prefix):] or '/'
        return self.app(environ, start_response)


def create_app():
    app = Flask(__name__)
    base_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(base_dir, 'wff.db')
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
    app.config['SQLALCHEMY_BINDS'] = {'wff': f'sqlite:///{db_path}'}
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = os.environ.get('WFF_SECRET_KEY', 'wff-dev-session-secret-change-me')
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    app.config['SESSION_COOKIE_SECURE'] = os.environ.get('WFF_SESSION_COOKIE_SECURE', 'false').lower() == 'true'
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    app.config['STATIC_FOLDER'] = os.path.join(base_dir, '..', 'frontend', 'dist')

    CORS(app, supports_credentials=True)
    db.init_app(app)
    socketio.init_app(app)
    app.wsgi_app = BasePathMiddleware(app.wsgi_app, APP_BASE_PATH)

    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(essays_bp, url_prefix='/api/essays')
    app.register_blueprint(messages_bp, url_prefix='/api/messages')
    app.register_blueprint(notifications_bp, url_prefix='/api/notifications')
    app.register_blueprint(proposals_bp, url_prefix='/api/proposals')

    with app.app_context():
        db.create_all()
        ensure_schema()
        cleanup_expired_media()
        cleanup_inactive_accounts()

    @app.route('/api/health')
    def health():
        return jsonify({'status': 'ok'})

    @app.route('/api/info')
    def info():
        return jsonify({'message': 'World Foresight Forum API running'})

    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve(path):
        static_folder = app.config['STATIC_FOLDER']

        if path != "" and os.path.exists(os.path.join(static_folder, path)):
            return send_from_directory(static_folder, path)

        index_path = os.path.join(static_folder, 'index.html')
        if os.path.exists(index_path):
            return send_from_directory(static_folder, 'index.html')

        return jsonify({'message': 'World Foresight Forum API running', 'endpoints': [
            'POST /api/auth/init',
            'POST /api/auth/claim-identity',
            'POST /api/auth/set-birthdate',
            'GET /api/essays',
            'POST /api/essays',
            'POST /api/essays/search',
            'GET /api/proposals',
        ]})

    return app

app = create_app()

if __name__ == '__main__':
    import subprocess
    import os
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
        try:
            subprocess.run(['tailscale', 'funnel', '--bg', '7080'], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print('TailScale Funnel: https://macbook-pro-m5.tail15098b.ts.net/')
        except Exception as e:
            print(f'Warning: TailScale funnel failed: {e}')
    else:
        print('TailScale Funnel: https://macbook-pro-m5.tail15098b.ts.net/')
    print('Local: http://localhost:7080')
    socketio.run(app, host='0.0.0.0', port=7080, debug=True, allow_unsafe_werkzeug=True)

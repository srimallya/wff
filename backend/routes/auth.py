import hmac
import secrets

from flask import Blueprint, jsonify, request, session
from werkzeug.exceptions import HTTPException

from backend.models import User, db
from backend.services.account_cleanup import delete_transient_account, scrub_registered_account, touch_user
from datetime import datetime
import random
import os

auth_bp = Blueprint('wff_auth', __name__)

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SESSION_USER_ID_KEY = 'wff_user_id'
SESSION_CSRF_KEY = 'wff_csrf_token'
UNSAFE_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}

def load_words(filename):
    path = os.path.join(CURRENT_DIR, '..', 'data', filename)
    if not os.path.exists(path):
        return []
    with open(path, 'r', encoding='utf-8') as f:
        return [line.strip() for line in f if line.strip()]

ADJECTIVES = load_words('adjectives.txt')
NOUNS = load_words('nouns.txt')

def generate_username():
    adj = random.choice(ADJECTIVES)
    noun = random.choice(NOUNS)
    number = random.randint(0, 9999)
    return f"{adj}{noun}{number}"

def calculate_age(birthdate_str):
    try:
        birth_date = datetime.strptime(birthdate_str, '%Y-%m-%d')
        today = datetime.now()
        age = today.year - birth_date.year
        if (today.month, today.day) < (birth_date.month, birth_date.day):
            age -= 1
        return age
    except:
        return None

SECURITY_QUESTIONS = [
    "What was the name of your first school?",
    "What is the name of your favorite book?",
    "In which city did your parents meet or marry?",
    "What was the name of your first pet?",
    "What was the name of your favorite teacher?",
]


class JsonAuthError(HTTPException):
    code = 401
    description = 'Authentication required'

    def __init__(self, description=None, code=None):
        super().__init__(description=description or self.description)
        if code is not None:
            self.code = code


def session_payload(user):
    token = session.get(SESSION_CSRF_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        session[SESSION_CSRF_KEY] = token
    return {**user.to_dict(), 'csrf_token': token}


def start_user_session(user):
    session.clear()
    session.permanent = True
    session[SESSION_USER_ID_KEY] = user.id
    session[SESSION_CSRF_KEY] = secrets.token_urlsafe(32)
    return session_payload(user)


def clear_user_session():
    session.clear()


def current_session_user():
    user_id = session.get(SESSION_USER_ID_KEY)
    if not user_id:
        return None
    return db.session.get(User, user_id)


def require_current_user():
    user = current_session_user()
    if not user:
        raise JsonAuthError()

    if request.method in UNSAFE_METHODS:
        expected = session.get(SESSION_CSRF_KEY)
        provided = request.headers.get('X-CSRF-Token', '')
        if not expected or not provided or not hmac.compare_digest(expected, provided):
            raise JsonAuthError('CSRF token missing or invalid', code=403)

    touch_user(user)
    return user


@auth_bp.app_errorhandler(JsonAuthError)
def handle_json_auth_error(exc):
    return jsonify({'error': exc.description}), exc.code

@auth_bp.route('/security-questions', methods=['GET'])
def get_security_questions():
    return jsonify({
        'questions': SECURITY_QUESTIONS
    })

@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json() or {}

    real_username = data.get('real_username', '').strip()
    password = data.get('password', '')
    birthdate = data.get('birthdate')
    is_bengali = data.get('is_bengali', False)
    security_q1 = data.get('security_q1')
    security_a1 = data.get('security_a1', '').strip()
    security_q2 = data.get('security_q2')
    security_a2 = data.get('security_a2', '').strip()

    if not real_username or not password:
        return jsonify({'error': 'real_username and password required'}), 400

    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    if User.query.filter_by(real_username=real_username).first():
        return jsonify({'error': 'Username already taken'}), 409

    # Generate unique public username
    username = generate_username()
    while User.query.filter_by(username=username).first():
        username = generate_username()

    is_guest = not is_bengali
    user = User(
        username=username,
        real_username=real_username,
        birthdate=birthdate,
        is_bengali=is_bengali,
        is_guest=is_guest,
        security_q1=security_q1 if not is_guest else None,
        security_q2=security_q2 if not is_guest else None,
    )
    user.set_password(password)
    if not is_guest:
        user.set_security_answer(1, security_a1)
        user.set_security_answer(2, security_a2)

    db.session.add(user)
    db.session.commit()

    return jsonify(start_user_session(user)), 201

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    real_username = data.get('real_username', '').strip()
    password = data.get('password', '')

    user = User.query.filter_by(real_username=real_username).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404

    if not user.check_password(password):
        return jsonify({'error': 'Invalid password'}), 401

    touch_user(user)
    db.session.commit()
    return jsonify(start_user_session(user))


@auth_bp.route('/logout', methods=['POST'])
def logout():
    clear_user_session()
    return jsonify({'message': 'Logged out'})

@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json() or {}
    real_username = data.get('real_username', '').strip()

    user = User.query.filter_by(real_username=real_username).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404

    return jsonify({
        'user_id': user.id,
        'security_q1': user.security_q1,
        'security_q2': user.security_q2,
    })

@auth_bp.route('/verify-security', methods=['POST'])
def verify_security():
    data = request.get_json() or {}
    user_id = data.get('user_id')
    answer1 = data.get('answer1', '').strip()
    answer2 = data.get('answer2', '').strip()

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    if not user.check_security_answer(1, answer1) or not user.check_security_answer(2, answer2):
        return jsonify({'error': 'Security answers incorrect'}), 401

    return jsonify({'verified': True, 'user_id': user.id})

@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json() or {}
    user_id = data.get('user_id')
    new_password = data.get('new_password', '')

    if len(new_password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    user.set_password(new_password)
    db.session.commit()

    return jsonify({'message': 'Password reset successful'})

@auth_bp.route('/delete-account', methods=['DELETE'])
def delete_account():
    data = request.get_json() or {}
    real_username = data.get('real_username', '').strip()
    password = data.get('password', '')
    username = data.get('username', '').strip()

    if username and not real_username and not password:
        user = User.query.filter_by(username=username).first()
        if not user:
            return jsonify({'error': 'User not found'}), 404
        if user.is_bengali and not user.is_guest:
            return jsonify({'error': 'Password required'}), 401
        delete_transient_account(user)
        db.session.commit()
        return jsonify({'message': 'Account deleted successfully'})

    user = User.query.filter_by(real_username=real_username).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404

    if not user.check_password(password):
        return jsonify({'error': 'Invalid password'}), 401

    if user.is_bengali and not user.is_guest:
        scrub_registered_account(user)
    else:
        delete_transient_account(user)
    db.session.commit()

    return jsonify({'message': 'Account deleted successfully'})

@auth_bp.route('/me/<username>', methods=['GET'])
def get_user(username):
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    touch_user(user)
    db.session.commit()
    return jsonify(user.to_dict())


@auth_bp.route('/me', methods=['GET'])
def get_current_session_user():
    user = require_current_user()
    db.session.commit()
    return jsonify(session_payload(user))

@auth_bp.route('/init-guest', methods=['POST'])
def init_guest():
    username = f"Guest{random.randint(1000, 9999)}"
    while User.query.filter_by(username=username).first():
        username = f"Guest{random.randint(1000, 9999)}"

    user = User(username=username, is_guest=True, is_bengali=False)
    db.session.add(user)
    db.session.commit()

    return jsonify(start_user_session(user))

@auth_bp.route('/generate-username', methods=['GET'])
def generate_username_endpoint():
    username = generate_username()
    while User.query.filter_by(username=username).first():
        username = generate_username()
    return jsonify({'username': username})

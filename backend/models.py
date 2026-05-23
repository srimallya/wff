from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from importlib.util import find_spec
import os
from werkzeug.security import generate_password_hash, check_password_hash

try:
    host_models_spec = find_spec('models')
    same_file = (
        host_models_spec
        and host_models_spec.origin
        and os.path.abspath(host_models_spec.origin) == os.path.abspath(__file__)
    )
    if same_file:
        host_db = None
    else:
        from models import db as host_db
except Exception:
    host_db = None

db = host_db or SQLAlchemy()
WFF_BIND_KEY = 'wff'

class User(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_user'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    real_username = db.Column(db.String(50), unique=True, nullable=True)
    password_hash = db.Column(db.String(200), nullable=True)
    birthdate = db.Column(db.String(10), nullable=True)
    is_bengali = db.Column(db.Boolean, default=False)
    is_guest = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_seen_at = db.Column(db.DateTime, default=datetime.utcnow)
    identity_public_key = db.Column(db.Text, nullable=True)
    signed_prekey_public_key = db.Column(db.Text, nullable=True)
    signed_prekey_signature = db.Column(db.Text, nullable=True)
    key_bundle_updated_at = db.Column(db.DateTime, nullable=True)

    security_q1 = db.Column(db.String(200), nullable=True)
    security_a1_hash = db.Column(db.String(200), nullable=True)
    security_q2 = db.Column(db.String(200), nullable=True)
    security_a2_hash = db.Column(db.String(200), nullable=True)

    essays = db.relationship('backend.models.Essay', backref='author', lazy=True, cascade='all, delete-orphan')
    votes = db.relationship('backend.models.Vote', backref='user', lazy=True, cascade='all, delete-orphan')
    sent_message_requests = db.relationship(
        'backend.models.MessageRequest',
        foreign_keys='backend.models.MessageRequest.sender_id',
        backref='sender',
        lazy=True,
        cascade='all, delete-orphan',
    )
    received_message_requests = db.relationship(
        'backend.models.MessageRequest',
        foreign_keys='backend.models.MessageRequest.receiver_id',
        backref='receiver',
        lazy=True,
        cascade='all, delete-orphan',
    )
    device_keys = db.relationship('backend.models.UserDeviceKey', backref='user', lazy=True, cascade='all, delete-orphan')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        if not self.password_hash:
            return False
        return check_password_hash(self.password_hash, password)

    def set_security_answer(self, q_num, answer):
        if q_num == 1:
            self.security_a1_hash = generate_password_hash(answer.lower().strip())
        elif q_num == 2:
            self.security_a2_hash = generate_password_hash(answer.lower().strip())

    def check_security_answer(self, q_num, answer):
        hash_to_check = self.security_a1_hash if q_num == 1 else self.security_a2_hash
        if not hash_to_check:
            return False
        return check_password_hash(hash_to_check, answer.lower().strip())

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'real_username': self.real_username,
            'birthdate': self.birthdate,
            'is_bengali': self.is_bengali,
            'is_guest': self.is_guest,
            'can_post': self.is_bengali and self.birthdate is not None and self.password_hash is not None,
            'security_q1': self.security_q1,
            'security_q2': self.security_q2,
            'last_seen_at': self.last_seen_at.isoformat() if self.last_seen_at else None,
            'has_key_bundle': bool(self.identity_public_key),
        }

class UserDeviceKey(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_user_device_key'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    device_id = db.Column(db.String(64), nullable=False)
    identity_public_key = db.Column(db.Text, nullable=False)
    signed_prekey_public_key = db.Column(db.Text, nullable=False)
    signed_prekey_signature = db.Column(db.String(256), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_seen_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'device_id', name='unique_user_device_key'),
    )

class Essay(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_essay'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    country = db.Column(db.String(80), nullable=False, default='Global')
    country_code = db.Column(db.String(8), nullable=False, default='GLOBAL')
    embedding_json = db.Column(db.Text, nullable=True)
    look_ahead_months = db.Column(db.Integer, nullable=False)
    target_calendar_year = db.Column(db.Integer, nullable=False)
    author_age_at_writing = db.Column(db.Integer, nullable=True)
    target_age = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_policy_proposal = db.Column(db.Boolean, default=False)

    policy_proposal = db.relationship('backend.models.PolicyProposal', backref='essay', uselist=False, cascade='all, delete-orphan')
    votes = db.relationship('backend.models.Vote', backref='essay', lazy=True, cascade='all, delete-orphan')
    comments = db.relationship('backend.models.Comment', backref='essay', lazy=True, cascade='all, delete-orphan')

    @property
    def upvotes(self):
        return sum(1 for v in self.votes if v.value == 1)

    @property
    def downvotes(self):
        return sum(1 for v in self.votes if v.value == -1)

    @property
    def score(self):
        return sum(v.value for v in self.votes)

class Vote(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_vote'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    essay_id = db.Column(db.Integer, db.ForeignKey('wff_essay.id'), nullable=False)
    value = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (db.UniqueConstraint('user_id', 'essay_id', name='unique_user_essay_vote'),)

class Comment(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_comment'

    id = db.Column(db.Integer, primary_key=True)
    essay_id = db.Column(db.Integer, db.ForeignKey('wff_essay.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey('wff_comment.id'), nullable=True)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('backend.models.User', foreign_keys=[user_id])
    votes = db.relationship('backend.models.CommentVote', backref='comment', lazy=True, cascade='all, delete-orphan')
    replies = db.relationship('backend.models.Comment', backref=db.backref('parent', remote_side=[id]), lazy=True, cascade='all, delete-orphan')

    @property
    def upvotes(self):
        return sum(1 for v in self.votes if v.value == 1)

    @property
    def downvotes(self):
        return sum(1 for v in self.votes if v.value == -1)

    @property
    def score(self):
        return sum(v.value for v in self.votes)

class CommentVote(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_comment_vote'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    comment_id = db.Column(db.Integer, db.ForeignKey('wff_comment.id'), nullable=False)
    value = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('backend.models.User', foreign_keys=[user_id])

    __table_args__ = (db.UniqueConstraint('user_id', 'comment_id', name='unique_user_comment_vote'),)

class PolicyProposal(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_policy_proposal'

    id = db.Column(db.Integer, primary_key=True)
    essay_id = db.Column(db.Integer, db.ForeignKey('wff_essay.id'), nullable=False)
    extracted_summary = db.Column(db.Text)
    category = db.Column(db.String(50))

class MessageRequest(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_message_request'

    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    status = db.Column(db.String(32), nullable=False, default='pending')
    note = db.Column(db.Text, nullable=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey('wff_conversation.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Conversation(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_conversation'

    id = db.Column(db.Integer, primary_key=True)
    user_one_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    user_two_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    channel_state = db.Column(db.Text, nullable=True)
    user_one_cleared_at = db.Column(db.DateTime, nullable=True)
    user_two_cleared_at = db.Column(db.DateTime, nullable=True)
    messages_purged_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user_one = db.relationship('backend.models.User', foreign_keys=[user_one_id])
    user_two = db.relationship('backend.models.User', foreign_keys=[user_two_id])
    messages = db.relationship('backend.models.Message', backref='conversation', lazy=True, cascade='all, delete-orphan')
    reads = db.relationship('backend.models.ConversationRead', backref='conversation', lazy=True, cascade='all, delete-orphan')

class Message(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_message'

    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey('wff_conversation.id'), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    body = db.Column(db.Text, nullable=False)
    client_nonce = db.Column(db.String(64), nullable=True)
    astr_version = db.Column(db.String(32), nullable=True)
    astr_direction = db.Column(db.String(32), nullable=True)
    astr_counter = db.Column(db.Integer, nullable=True)
    astr_epoch = db.Column(db.Integer, nullable=True)
    previous_chain_length = db.Column(db.Integer, nullable=True)
    ratchet_public_key = db.Column(db.Text, nullable=True)
    prev_transcript_hash = db.Column(db.String(64), nullable=True)
    transcript_hash = db.Column(db.String(64), nullable=True)
    ciphertext = db.Column(db.Text, nullable=True)
    auth_tag = db.Column(db.String(64), nullable=True)
    packet_status = db.Column(db.String(32), nullable=False, default='accepted')
    failure_reason = db.Column(db.Text, nullable=True)
    media_filename = db.Column(db.String(255), nullable=True)
    media_stored_filename = db.Column(db.String(255), nullable=True)
    media_mime_type = db.Column(db.String(120), nullable=True)
    media_size = db.Column(db.Integer, nullable=True)
    media_kind = db.Column(db.String(24), nullable=True)
    media_open_count = db.Column(db.Integer, nullable=False, default=0)
    media_expires_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    sender = db.relationship('backend.models.User', foreign_keys=[sender_id])

class ChatroomMessage(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_chatroom_message'

    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    body = db.Column(db.Text, nullable=False)
    client_nonce = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    sender = db.relationship('backend.models.User', foreign_keys=[sender_id])

class ConversationRead(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_conversation_read'

    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey('wff_conversation.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    last_read_at = db.Column(db.DateTime, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = db.relationship('backend.models.User', foreign_keys=[user_id])

    __table_args__ = (
        db.UniqueConstraint('conversation_id', 'user_id', name='unique_conversation_user_read'),
    )

class PushSubscription(db.Model):
    __bind_key__ = WFF_BIND_KEY
    __tablename__ = 'wff_push_subscription'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('wff_user.id'), nullable=False)
    endpoint = db.Column(db.Text, nullable=False, unique=True)
    p256dh = db.Column(db.Text, nullable=False)
    auth = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = db.relationship('backend.models.User', foreign_keys=[user_id])

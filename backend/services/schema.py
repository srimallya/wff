from sqlalchemy import inspect, text

from backend.models import db


def ensure_schema():
    engine = db.engines.get('wff', db.engine)
    inspector = inspect(engine)

    def execute(statement):
        with engine.begin() as connection:
            connection.execute(text(statement))

    user_columns = {column['name'] for column in inspector.get_columns('wff_user')}
    if 'last_seen_at' not in user_columns:
        execute('ALTER TABLE "wff_user" ADD COLUMN last_seen_at DATETIME')
        execute('UPDATE "wff_user" SET last_seen_at = created_at WHERE last_seen_at IS NULL')
    user_additions = {
        'identity_public_key': 'TEXT',
        'signed_prekey_public_key': 'TEXT',
        'signed_prekey_signature': 'TEXT',
        'key_bundle_updated_at': 'DATETIME',
    }
    for column_name, column_type in user_additions.items():
        if column_name not in user_columns:
            execute(f'ALTER TABLE "wff_user" ADD COLUMN {column_name} {column_type}')

    essay_columns = {column['name'] for column in inspector.get_columns('wff_essay')}
    essay_additions = {
        'title': 'VARCHAR(50)',
        'country': 'VARCHAR(80) NOT NULL DEFAULT "Global"',
        'country_code': 'VARCHAR(8) NOT NULL DEFAULT "GLOBAL"',
        'edited_at': 'DATETIME',
        'edit_count': 'INTEGER NOT NULL DEFAULT 0',
    }
    for column_name, column_type in essay_additions.items():
        if column_name not in essay_columns:
            execute(f'ALTER TABLE "wff_essay" ADD COLUMN {column_name} {column_type}')

    message_columns = {column['name'] for column in inspector.get_columns('wff_message')}
    message_additions = {
        'client_nonce': 'VARCHAR(64)',
        'astr_version': 'VARCHAR(32)',
        'astr_direction': 'VARCHAR(32)',
        'astr_counter': 'INTEGER',
        'astr_epoch': 'INTEGER',
        'previous_chain_length': 'INTEGER',
        'ratchet_public_key': 'TEXT',
        'prev_transcript_hash': 'VARCHAR(64)',
        'transcript_hash': 'VARCHAR(64)',
        'ciphertext': 'TEXT',
        'auth_tag': 'VARCHAR(64)',
        'packet_status': 'VARCHAR(32) NOT NULL DEFAULT "accepted"',
        'failure_reason': 'TEXT',
        'media_filename': 'VARCHAR(255)',
        'media_stored_filename': 'VARCHAR(255)',
        'media_mime_type': 'VARCHAR(120)',
        'media_size': 'INTEGER',
        'media_kind': 'VARCHAR(24)',
        'media_open_count': 'INTEGER NOT NULL DEFAULT 0',
        'media_expires_at': 'DATETIME',
    }
    for column_name, column_type in message_additions.items():
        if column_name not in message_columns:
            execute(f'ALTER TABLE "wff_message" ADD COLUMN {column_name} {column_type}')

    conversation_columns = {column['name'] for column in inspector.get_columns('wff_conversation')}
    conversation_additions = {
        'user_one_cleared_at': 'DATETIME',
        'user_two_cleared_at': 'DATETIME',
        'messages_purged_at': 'DATETIME',
    }
    for column_name, column_type in conversation_additions.items():
        if column_name not in conversation_columns:
            execute(f'ALTER TABLE "wff_conversation" ADD COLUMN {column_name} {column_type}')

    table_names = set(inspector.get_table_names())
    if 'wff_user_device_key' not in table_names:
        execute('''
            CREATE TABLE wff_user_device_key (
                id INTEGER NOT NULL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                device_id VARCHAR(64) NOT NULL,
                identity_public_key TEXT NOT NULL,
                signed_prekey_public_key TEXT NOT NULL,
                signed_prekey_signature VARCHAR(256),
                created_at DATETIME,
                updated_at DATETIME,
                last_seen_at DATETIME,
                FOREIGN KEY(user_id) REFERENCES "wff_user" (id),
                CONSTRAINT unique_user_device_key UNIQUE (user_id, device_id)
            )
        ''')
    if 'wff_chatroom_message' not in table_names:
        execute('''
            CREATE TABLE wff_chatroom_message (
                id INTEGER NOT NULL PRIMARY KEY,
                sender_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                client_nonce VARCHAR(64),
                created_at DATETIME,
                FOREIGN KEY(sender_id) REFERENCES "wff_user" (id)
            )
        ''')

    if 'wff_notification' not in table_names:
        execute('''
            CREATE TABLE wff_notification (
                id INTEGER NOT NULL PRIMARY KEY,
                recipient_id INTEGER NOT NULL,
                actor_id INTEGER NOT NULL,
                kind VARCHAR(32) NOT NULL,
                essay_id INTEGER NOT NULL,
                comment_id INTEGER NOT NULL,
                parent_comment_id INTEGER,
                message VARCHAR(240) NOT NULL,
                created_at DATETIME,
                read_at DATETIME,
                FOREIGN KEY(recipient_id) REFERENCES "wff_user" (id),
                FOREIGN KEY(actor_id) REFERENCES "wff_user" (id),
                FOREIGN KEY(essay_id) REFERENCES "wff_essay" (id),
                FOREIGN KEY(comment_id) REFERENCES "wff_comment" (id),
                FOREIGN KEY(parent_comment_id) REFERENCES "wff_comment" (id)
            )
        ''')
        execute('CREATE INDEX ix_wff_notification_recipient_created ON wff_notification (recipient_id, created_at)')

    if 'wff_comment' in table_names:
        comment_columns = {column['name'] for column in inspector.get_columns('wff_comment')}
        if 'parent_id' not in comment_columns:
            execute('ALTER TABLE "wff_comment" ADD COLUMN parent_id INTEGER')

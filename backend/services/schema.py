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
        'country': 'VARCHAR(80) NOT NULL DEFAULT "Global"',
        'country_code': 'VARCHAR(8) NOT NULL DEFAULT "GLOBAL"',
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
    }
    for column_name, column_type in message_additions.items():
        if column_name not in message_columns:
            execute(f'ALTER TABLE "wff_message" ADD COLUMN {column_name} {column_type}')

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

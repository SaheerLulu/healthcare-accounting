"""On some installs the notifications_notification table was created from
an older 0001_initial that didn't include is_read / read_at, then the model
was updated in place — leaving the schema out of sync with the model. This
migration adds the missing columns idempotently using ADD COLUMN IF NOT
EXISTS (Postgres + SQLite ≥ 3.35), and falls back to a no-op when the
columns are already present.
"""
from django.db import migrations


def add_columns_if_missing(apps, schema_editor):
    vendor = schema_editor.connection.vendor
    with schema_editor.connection.cursor() as cur:
        if vendor == 'postgresql':
            cur.execute(
                'ALTER TABLE notifications_notification '
                'ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false'
            )
            cur.execute(
                'ALTER TABLE notifications_notification '
                'ADD COLUMN IF NOT EXISTS read_at timestamp with time zone NULL'
            )
        elif vendor == 'sqlite':
            # SQLite doesn't support ADD COLUMN IF NOT EXISTS until 3.35.
            # PRAGMA table_info gives us the column list; only add if missing.
            cur.execute('PRAGMA table_info(notifications_notification)')
            existing = {row[1] for row in cur.fetchall()}
            if 'is_read' not in existing:
                cur.execute(
                    'ALTER TABLE notifications_notification '
                    'ADD COLUMN is_read boolean NOT NULL DEFAULT 0'
                )
            if 'read_at' not in existing:
                cur.execute(
                    'ALTER TABLE notifications_notification '
                    'ADD COLUMN read_at datetime NULL'
                )
        # Other vendors (mysql etc.) — no-op; would need an explicit branch.


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(add_columns_if_missing, reverse_code=migrations.RunPython.noop),
    ]

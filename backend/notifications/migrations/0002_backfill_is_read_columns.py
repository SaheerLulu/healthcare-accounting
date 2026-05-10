"""Defensive schema-drift guard for notifications_notification.

Some installs applied an earlier 0001_initial that didn't include the full
set of columns the model now declares (is_read, read_at, expires_at, …),
then the migration was edited in place. Django's `django_migrations` table
already lists 0001 as applied, so it never re-runs and the schema stays
out of sync.

This migration walks the live `information_schema` and ALTER TABLE ADD
COLUMNs anything that's missing. Idempotent — re-running is a no-op.
"""
from django.db import migrations


# ddl is plain SQL fragment for the ADD COLUMN statement.
# Postgres flavour. SQLite gets a separate code path below.
EXPECTED_PG = {
    'is_read':       "boolean NOT NULL DEFAULT false",
    'read_at':       "timestamp with time zone NULL",
    'expires_at':    "timestamp with time zone NULL",
    'role_code':     "varchar(30) NOT NULL DEFAULT ''",
    'link_url':      "varchar(500) NOT NULL DEFAULT ''",
    'related_model': "varchar(100) NOT NULL DEFAULT ''",
    'related_id':    "integer NULL",
    'priority':      "varchar(10) NOT NULL DEFAULT 'normal'",
    'body':          "text NOT NULL DEFAULT ''",
}

EXPECTED_SQLITE = {
    'is_read':       "boolean NOT NULL DEFAULT 0",
    'read_at':       "datetime NULL",
    'expires_at':    "datetime NULL",
    'role_code':     "varchar(30) NOT NULL DEFAULT ''",
    'link_url':      "varchar(500) NOT NULL DEFAULT ''",
    'related_model': "varchar(100) NOT NULL DEFAULT ''",
    'related_id':    "integer NULL",
    'priority':      "varchar(10) NOT NULL DEFAULT 'normal'",
    'body':          "text NOT NULL DEFAULT ''",
}


def add_columns_if_missing(apps, schema_editor):
    vendor = schema_editor.connection.vendor
    table = 'notifications_notification'

    with schema_editor.connection.cursor() as cur:
        if vendor == 'postgresql':
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = %s",
                [table],
            )
            existing = {row[0] for row in cur.fetchall()}
            if not existing:
                # Table itself is missing — let CreateModel from 0001 own that.
                return
            for col, ddl in EXPECTED_PG.items():
                if col in existing:
                    continue
                cur.execute(
                    f'ALTER TABLE {table} ADD COLUMN {col} {ddl}'
                )
        elif vendor == 'sqlite':
            cur.execute(f'PRAGMA table_info({table})')
            rows = cur.fetchall()
            if not rows:
                return
            existing = {row[1] for row in rows}
            for col, ddl in EXPECTED_SQLITE.items():
                if col in existing:
                    continue
                cur.execute(
                    f'ALTER TABLE {table} ADD COLUMN {col} {ddl}'
                )
        # Other vendors — would need their own branch.


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(add_columns_if_missing, reverse_code=migrations.RunPython.noop),
    ]

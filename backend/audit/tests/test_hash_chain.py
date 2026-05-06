"""Tests for the tamper-evident audit-log hash chain (WP 673)."""
from django.contrib.auth.models import User
from django.test import TestCase

from audit.models import AuditLog
from audit.utils import _row_hash, log_action, verify_chain
from core.tests.utils import make_admin


class RowHashTests(TestCase):
    def test_deterministic(self):
        h1 = _row_hash('', {'a': 1, 'b': 'x'})
        h2 = _row_hash('', {'b': 'x', 'a': 1})  # different key order
        self.assertEqual(h1, h2)

    def test_changes_on_payload_change(self):
        h1 = _row_hash('', {'a': 1})
        h2 = _row_hash('', {'a': 2})
        self.assertNotEqual(h1, h2)

    def test_changes_on_prev_change(self):
        h1 = _row_hash('aaa', {'x': 1})
        h2 = _row_hash('bbb', {'x': 1})
        self.assertNotEqual(h1, h2)


class LogActionTests(TestCase):
    def test_first_log_has_empty_prev_hash(self):
        log_action('CREATE', 'Foo', '1', 'Foo #1')
        row = AuditLog.objects.first()
        self.assertEqual(row.prev_hash, '')
        self.assertNotEqual(row.content_hash, '')

    def test_subsequent_log_chains_to_previous(self):
        log_action('CREATE', 'Foo', '1', 'Foo #1')
        log_action('UPDATE', 'Foo', '1', 'Foo #1 updated')
        rows = list(AuditLog.objects.order_by('id'))
        self.assertEqual(rows[1].prev_hash, rows[0].content_hash)


class VerifyChainTests(TestCase):
    def test_intact_chain_returns_none(self):
        log_action('CREATE', 'Foo', '1', 'Foo #1')
        log_action('UPDATE', 'Foo', '1', 'Foo #1 updated')
        log_action('DELETE', 'Foo', '1', 'Foo #1 deleted')
        self.assertIsNone(verify_chain())

    def test_detects_tampered_payload(self):
        log_action('CREATE', 'Foo', '1', 'Foo #1')
        log_action('UPDATE', 'Foo', '1', 'Foo #1 updated')
        # Tamper with the second row — change object_repr (a hashed field) but
        # leave prev/content hash alone
        row = AuditLog.objects.order_by('id').last()
        row.object_repr = 'TAMPERED'
        row.save()
        result = verify_chain()
        self.assertIsNotNone(result)
        self.assertEqual(result['broken_at'], row.id)

    def test_detects_inserted_row(self):
        log_action('CREATE', 'Foo', '1', 'Foo #1')
        log_action('UPDATE', 'Foo', '1', 'Foo #1 updated')
        # Manually splice a row in between with no chain links
        AuditLog.objects.create(
            action='CREATE', model_name='Inserted', object_id='999',
            object_repr='Smuggled in', prev_hash='', content_hash='deadbeef',
        )
        result = verify_chain()
        # Chain breaks somewhere because the inserted row's hashes don't match
        self.assertIsNotNone(result)

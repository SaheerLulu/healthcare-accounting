"""Regression tests for two sync-engine resilience defects:

  H25 — overlapping syncs (a UI click racing the */5 cron) could both pass the
        read-then-create idempotency check and double-post every order. sync_all
        now serialises behind an advisory lock and skips if another run holds it.
  H24 — an order cancelled upstream AFTER it synced was never backed out, so the
        books kept a sale/purchase that no longer existed. reverse_cancelled now
        posts a reversal for any synced order whose source is now cancelled.
"""
import contextlib
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine
from sync.services import InventorySyncService, sync_advisory_lock


class AdvisoryLockTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def test_lock_is_noop_on_sqlite(self):
        with sync_advisory_lock() as acquired:
            self.assertTrue(acquired)  # non-Postgres backend → always acquires

    def test_sync_all_skips_when_lock_not_acquired(self):
        svc = InventorySyncService()

        @contextlib.contextmanager
        def _busy():
            yield False  # simulate another run holding the lock

        with patch('sync.services.sync_advisory_lock', _busy):
            result = svc.sync_all()

        self.assertTrue(result['skipped'])
        self.assertEqual(result['total'], 0)
        # Nothing posted while skipped.
        self.assertEqual(JournalEntry.objects.count(), 0)


class ReverseCancelledTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = InventorySyncService()
        self.cash = ChartOfAccount.objects.get(account_code='1110')
        self.sales = ChartOfAccount.objects.get(account_code='4100')

    def _synced_pos(self, ref_id=701, amount=Decimal('1000.00')):
        entry = JournalEntry.objects.create(
            date=date(2026, 4, 1), voucher_type='SALE',
            reference_type='POSOrder', reference_id=ref_id, location_id=1,
        )
        JournalEntryLine.objects.create(entry=entry, account=self.cash, debit=amount)
        JournalEntryLine.objects.create(entry=entry, account=self.sales, credit=amount)
        entry.post()
        return entry

    def _run_with_cancelled(self, cancelled_ids):
        # Mock the (unmanaged) POSOrderRO so the queried sources report cancelled.
        with patch('sync.services.POSOrderRO') as MockPOS:
            MockPOS.objects.filter.return_value.values_list.return_value = cancelled_ids
            return self.svc.reverse_cancelled()

    def test_cancelled_order_is_reversed(self):
        entry = self._synced_pos()
        n = self._run_with_cancelled([701])
        self.assertEqual(n, 1)
        entry.refresh_from_db()
        self.assertTrue(hasattr(entry, 'reversal_entry'))
        rev = entry.reversal_entry
        self.assertTrue(rev.is_posted)
        self.assertEqual(rev.reversal_of_id, entry.id)
        # Debits/credits swapped → net effect of original + reversal is zero.
        codes = {l.account.account_code: (l.debit, l.credit) for l in rev.lines.all()}
        self.assertEqual(codes['1110'], (Decimal('0.00'), Decimal('1000.00')))
        self.assertEqual(codes['4100'], (Decimal('1000.00'), Decimal('0.00')))

    def test_reverse_cancelled_is_idempotent(self):
        self._synced_pos()
        self.assertEqual(self._run_with_cancelled([701]), 1)
        # Second pass must not double-reverse the already-reversed entry.
        self.assertEqual(self._run_with_cancelled([701]), 0)

    def test_active_order_not_reversed(self):
        entry = self._synced_pos()
        # Source not in the cancelled set → nothing reversed.
        n = self._run_with_cancelled([])
        self.assertEqual(n, 0)
        entry.refresh_from_db()
        self.assertFalse(hasattr(entry, 'reversal_entry'))

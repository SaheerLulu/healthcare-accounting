"""Tests for full re-sync wipe (WP 668) and idempotency."""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import (
    make_journal_entry, make_settings, seed_chart_and_mappings,
)
from journals.models import JournalEntry
from sync.models import SyncError, SyncLog
from sync.services import AUTO_GEN_REF_TYPES, full_resync


class FullResyncWipeTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

        cash = ChartOfAccount.objects.get(account_code='1110')
        sales = ChartOfAccount.objects.get(account_code='4100')
        # Two manual JEs (must NOT be wiped)
        for i in range(2):
            make_journal_entry(d=date(2026, 4, i + 1), lines=[
                (cash, Decimal('100'), Decimal('0')),
                (sales, Decimal('0'), Decimal('100')),
            ])
        # Two auto-gen JEs (must be wiped)
        for ref_type in ('PurchaseOrder', 'POSOrder'):
            JournalEntry._skip_period_lock = False
            e = JournalEntry.objects.create(
                date=date(2026, 4, 5), narration=f'auto {ref_type}',
                voucher_type='SALE', reference_type=ref_type, reference_id=1,
                location_id=1,
            )
            from journals.models import JournalEntryLine
            JournalEntryLine.objects.create(entry=e, account=cash, debit=Decimal('50'))
            JournalEntryLine.objects.create(entry=e, account=sales, credit=Decimal('50'))
            e.post()

        SyncLog.objects.create(sync_type='purchase', last_synced_id=99,
                               records_processed=10)

    def test_dry_run_counts_without_wiping(self):
        before = JournalEntry.objects.count()
        result = full_resync(dry_run=True)
        self.assertTrue(result['dry_run'])
        self.assertEqual(result['would_delete_journals'], 2)
        self.assertEqual(JournalEntry.objects.count(), before)

    def test_full_resync_preserves_manual_entries(self):
        # Patch sync_all so we don't try to query inventory_reader proxies
        with patch('sync.services.InventorySyncService.sync_all',
                   return_value={'purchases': 0, 'pos': 0, 'b2b': 0,
                                 'returns': 0, 'purchase_returns': 0, 'total': 0}):
            result = full_resync(dry_run=False)
        self.assertFalse(result['dry_run'])

        # Manual entries survived
        self.assertEqual(JournalEntry.objects.filter(
            reference_type='Manual').count(), 2)
        # Auto entries wiped
        self.assertEqual(JournalEntry.objects.filter(
            reference_type__in=AUTO_GEN_REF_TYPES).count(), 0)

    def test_full_resync_resets_cursors(self):
        with patch('sync.services.InventorySyncService.sync_all',
                   return_value={'purchases': 0, 'pos': 0, 'b2b': 0,
                                 'returns': 0, 'purchase_returns': 0, 'total': 0}):
            full_resync(dry_run=False)
        for log in SyncLog.objects.all():
            self.assertEqual(log.last_synced_id, 0)

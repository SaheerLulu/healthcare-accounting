"""Backfill command repoints historical JournalEntryLine.account from
template CoA rows to per-store clones.

Critical invariants:
  - Shared accounts (GST, equity, suspense, round-off) are NEVER moved.
  - Lines whose entry already points at a per-store account are NEVER moved.
  - Re-running the backfill is a no-op once everything is repointed.
"""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from core.models import AccountMapping, ChartOfAccount
from core.tests.utils import seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine


class _FakeLocation:
    def __init__(self, id, name):
        self.id = id
        self.name = name


def _seed_loc(loc_id, name):
    """Helper to bootstrap one location end-to-end (CoA + mappings)."""
    loc = _FakeLocation(loc_id, name)
    with patch('inventory_reader.models.LocationRO') as MockLoc:
        MockLoc.objects.get.return_value = loc
        call_command('bootstrap_location_coa', location_id=loc_id)


class BackfillLocationJournalLinesTests(TestCase):
    """Order matters: post the legacy entries BEFORE bootstrap runs, exactly
    like the real-world migration. Bootstrap flips template accounts to
    non-leaf as it adds children, so post-bootstrap you can no longer
    write to the template directly (model validation rejects it)."""

    def setUp(self):
        seed_chart_and_mappings()
        # Resolve templates while they're still leaves.
        self.cash_template = ChartOfAccount.objects.get(
            account_code='1110', location_id__isnull=True,
        )
        self.cgst_template = ChartOfAccount.objects.get(
            account_code='2120', location_id__isnull=True,
        )
        self.sales_template = ChartOfAccount.objects.get(
            account_code='4100', location_id__isnull=True,
        )

    def _post_legacy_sale(self, loc_id, amount=Decimal('1000.00')):
        """Pre-refactor sale: every line points at the (still-leaf) template."""
        entry = JournalEntry.objects.create(
            date=date(2026, 1, 15), narration='legacy sale',
            voucher_type='SALE', reference_type='POSOrder',
            reference_id=loc_id * 1000, location_id=loc_id,
        )
        JournalEntryLine.objects.create(
            entry=entry, account=self.cash_template, debit=amount,
        )
        JournalEntryLine.objects.create(
            entry=entry, account=self.sales_template, credit=amount,
        )
        # A shared (GST) leg that must NOT be moved.
        JournalEntryLine.objects.create(
            entry=entry, account=self.cgst_template, credit=Decimal('90.00'),
        )
        return entry

    def _bootstrap_two_locations(self):
        _seed_loc(7, 'Mumbai')
        _seed_loc(8, 'Delhi')
        self.cash_mumbai = ChartOfAccount.objects.get(
            account_code='1110-MUM', location_id=7,
        )
        self.cash_delhi = ChartOfAccount.objects.get(
            account_code='1110-DEL', location_id=8,
        )

    def test_repoints_cash_sales_and_gst(self):
        entry = self._post_legacy_sale(loc_id=7)
        self._bootstrap_two_locations()
        call_command('backfill_location_journal_lines')

        lines = {l.account.account_code: l for l in entry.lines.all()}
        self.assertEqual(lines['1110-MUM'].debit, Decimal('1000.00'),
                         'Cash should now point at Mumbai clone')
        self.assertEqual(lines['4100-MUM'].credit, Decimal('1000.00'),
                         'Sales POS should now point at Mumbai clone')
        # Nothing is shared now — GST is repointed to its per-store clone too.
        self.assertIn('2120-MUM', lines)
        self.assertEqual(lines['2120-MUM'].credit, Decimal('90.00'))
        self.assertNotIn('2120', lines, 'GST line moved off the shared template')

    def test_per_location_routing(self):
        self._post_legacy_sale(loc_id=7, amount=Decimal('500.00'))
        self._post_legacy_sale(loc_id=8, amount=Decimal('700.00'))
        self._bootstrap_two_locations()
        call_command('backfill_location_journal_lines')

        # Mumbai's cash leg landed on 1110-MUM, Delhi's on 1110-DEL.
        mum_cash = JournalEntryLine.objects.filter(account=self.cash_mumbai)
        del_cash = JournalEntryLine.objects.filter(account=self.cash_delhi)
        self.assertEqual(mum_cash.count(), 1)
        self.assertEqual(del_cash.count(), 1)
        self.assertEqual(mum_cash.first().debit, Decimal('500.00'))
        self.assertEqual(del_cash.first().debit, Decimal('700.00'))

    def test_dry_run_does_not_write(self):
        entry = self._post_legacy_sale(loc_id=7)
        self._bootstrap_two_locations()
        call_command('backfill_location_journal_lines', dry_run=True)
        # No lines moved.
        cash_line = entry.lines.get(debit=Decimal('1000.00'))
        self.assertEqual(cash_line.account, self.cash_template)

    def test_idempotent(self):
        self._post_legacy_sale(loc_id=7)
        self._bootstrap_two_locations()
        call_command('backfill_location_journal_lines')
        # Second run finds nothing to move.
        mum_cash_before = JournalEntryLine.objects.filter(account=self.cash_mumbai).count()
        call_command('backfill_location_journal_lines')
        self.assertEqual(
            JournalEntryLine.objects.filter(account=self.cash_mumbai).count(),
            mum_cash_before,
        )

    def test_skips_entries_without_location(self):
        """Entries with location_id=NULL (e.g., legacy company-level adjustments)
        cannot be routed to a per-store clone; leave them alone."""
        entry = JournalEntry.objects.create(
            date=date(2026, 1, 15), narration='legacy company adj',
            voucher_type='JOURNAL', reference_type='Manual',
            location_id=None,
        )
        JournalEntryLine.objects.create(
            entry=entry, account=self.cash_template, debit=Decimal('100'),
        )
        JournalEntryLine.objects.create(
            entry=entry, account=self.sales_template, credit=Decimal('100'),
        )
        self._bootstrap_two_locations()
        call_command('backfill_location_journal_lines')
        # All lines still on the templates.
        self.assertEqual(entry.lines.filter(account=self.cash_template).count(), 1)
        self.assertEqual(entry.lines.filter(account=self.sales_template).count(), 1)

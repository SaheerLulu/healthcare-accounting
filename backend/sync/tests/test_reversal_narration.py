"""Auto-reversal narrations must carry the source document's bill number.

Every sync-side reversal used to read `Auto-reversal — PurchaseOrder #42
cancelled upstream (reverses JV-…)`, discarding the bill number that was
sitting in the original's narration all along, so a ledger search for
"INV-2233" surfaced the posting but never the reversal that cancelled it.

The purchase-amendment swap is the worse of the two live paths: it reverses the
stale JE and then `generate_purchase(force=True)` immediately re-posts a second
full-value "Purchase Invoice: INV-2233", so searching that bill number returned
two purchases with the netting reversal invisible between them.

Both now append the source narration using the same `: {narration}`.strip(': ')
shape as journals/views.py's manual reverse action and the auto_reverse command.
"""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine
from sync.services import InventorySyncService


class _NarrationTestBase(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = InventorySyncService()
        self.cash = ChartOfAccount.objects.get(account_code='1110')
        self.sales = ChartOfAccount.objects.get(account_code='4100')

    def _posted(self, *, reference_type, reference_id, narration,
                voucher_type='SALE', amount=Decimal('1000.00')):
        entry = JournalEntry.objects.create(
            date=date(2026, 4, 1), narration=narration,
            voucher_type=voucher_type, reference_type=reference_type,
            reference_id=reference_id, location_id=1,
        )
        JournalEntryLine.objects.create(entry=entry, account=self.cash, debit=amount)
        JournalEntryLine.objects.create(entry=entry, account=self.sales, credit=amount)
        entry.post()
        return entry


class CancellationReversalNarrationTests(_NarrationTestBase):
    """POS/B2B cancellations reach _reverse_entry with no explicit narration,
    so they take the default branch that was dropping the bill number."""

    def _run_with_cancelled(self, cancelled_ids):
        with patch('sync.services.POSOrderRO') as MockPOS:
            MockPOS.objects.filter.return_value.values_list.return_value = cancelled_ids
            return self.svc.reverse_cancelled()

    def test_reversal_narration_names_the_invoice(self):
        entry = self._posted(reference_type='POSOrder', reference_id=701,
                             narration='POS Sale: BILL-9001')
        self.assertEqual(self._run_with_cancelled([701]), 1)

        entry.refresh_from_db()
        rev = entry.reversal_entry
        # The bill number is what a user searches on — it must be in the
        # reversal, not only in the sale it backs out.
        self.assertIn('BILL-9001', rev.narration)
        # ...alongside the existing provenance, which nothing may lose.
        self.assertIn('cancelled upstream', rev.narration)
        self.assertIn(entry.entry_no, rev.narration)

    def test_blank_source_narration_leaves_no_dangling_separator(self):
        entry = self._posted(reference_type='POSOrder', reference_id=702,
                             narration='')
        self.assertEqual(self._run_with_cancelled([702]), 1)

        entry.refresh_from_db()
        self.assertTrue(entry.reversal_entry.narration.endswith(')'))

    def test_explicit_narration_still_wins(self):
        """Callers that pass their own narration (the amendment swap) must not
        get the default appended on top of it."""
        entry = self._posted(reference_type='POSOrder', reference_id=703,
                             narration='POS Sale: BILL-9003')
        rev = self.svc._reverse_entry(entry, narration='Custom narration')
        self.assertEqual(rev.narration, 'Custom narration')


class _FakeAmendmentQS:
    """Minimal duck-typed stand-in for PurchaseAmendmentRO.objects honouring
    the filter/exclude/select_related/order_by chain the sync step uses."""

    def __init__(self, rows):
        self.rows = list(rows)

    def filter(self, **kw):
        status = kw.get('status')
        return _FakeAmendmentQS(
            r for r in self.rows if status is None or r.status == status
        )

    def exclude(self, **kw):
        excluded = kw.get('id__in')
        done = set()
        if excluded is not None:
            for v in excluded:
                done.add(v['reference_id'] if isinstance(v, dict) else v)
        return _FakeAmendmentQS(r for r in self.rows if r.id not in done)

    def select_related(self, *args):
        return self

    def order_by(self, *args):
        return _FakeAmendmentQS(sorted(self.rows, key=lambda r: r.id))

    def __iter__(self):
        return iter(self.rows)


class AmendmentSwapNarrationTests(_NarrationTestBase):
    def _amendment(self, am_id, po_id):
        return SimpleNamespace(
            id=am_id, purchase_order_id=po_id, status='applied',
            approved_at=timezone.now() + timedelta(minutes=5),
            purchase_order=SimpleNamespace(state='confirmed'),
        )

    def _run(self, amendments, regen_narration='Purchase Invoice: INV-2233'):
        def _regen(po_id, force=False):
            return self._posted(reference_type='PurchaseOrder', reference_id=po_id,
                                narration=regen_narration, voucher_type='PURCHASE',
                                amount=Decimal('77.00'))

        fake = SimpleNamespace(objects=_FakeAmendmentQS(amendments))
        with patch('sync.services.PurchaseAmendmentRO', fake), \
             patch.object(self.svc.journal_service, 'generate_purchase',
                          side_effect=_regen):
            return self.svc.sync_purchase_amendments()

    def test_swap_narration_names_the_bill(self):
        live = self._posted(reference_type='PurchaseOrder', reference_id=42,
                            narration='Purchase Invoice: INV-2233',
                            voucher_type='PURCHASE')
        self.assertEqual(self._run([self._amendment(7, 42)]), 1)

        swap = JournalEntry.objects.get(reference_type='PurchaseAmendment')
        # Without the bill number here, the two full-value INV-2233 purchases
        # (the original and the regenerated one) bracket a reversal that a
        # bill-number search cannot see, and the invoice reads as double-booked.
        self.assertIn('INV-2233', swap.narration)
        self.assertIn('Purchase amendment #7', swap.narration)
        self.assertIn(live.entry_no, swap.narration)

    def test_blank_live_narration_leaves_no_dangling_separator(self):
        self._posted(reference_type='PurchaseOrder', reference_id=43,
                     narration='', voucher_type='PURCHASE')
        self.assertEqual(self._run([self._amendment(8, 43)]), 1)

        swap = JournalEntry.objects.get(reference_type='PurchaseAmendment')
        self.assertTrue(swap.narration.endswith('correction)'))

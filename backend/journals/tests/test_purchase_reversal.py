"""Purchase Reversal journal generation — a SEPARATE reversing entry that never
edits or deletes the original purchase. Full = exact swap of the original entry;
partial = a debit note for the reversed lines only."""
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry
from journals.services import JournalAutoGenerationService


def _make_purchase_order(*, po_id=601, location_id=1, supplier_gstin='27ABCDE1234A1Z5'):
    line = SimpleNamespace(
        product_id=101, quantity=100, free_qty=0,
        purchase_rate=Decimal('10.00'), discount_percent=Decimal('0'),
        cgst_amount=Decimal('0'), sgst_amount=Decimal('0'),
        igst_amount=Decimal('0'), tax_percent=Decimal('0'),
    )

    class _Lines:
        def all(self):
            return [line]

    return SimpleNamespace(
        id=po_id, state='confirmed',
        supplier=SimpleNamespace(gst_no=supplier_gstin),
        supplier_id=9, location_id=location_id,
        bill_date=None, bill_no='PO-RV1',
        transport_cost=Decimal('0'), other_charges=Decimal('0'),
        additional_discount=Decimal('0'),
        round_off=Decimal('0'), supply_type='intra_state',
        created_at=datetime(2026, 4, 10), lines=_Lines(),
    )


def _make_reversal(*, reversal_id=701, po_id=601, rev_type='full',
                   location_id=1, supplier_gstin='27ABCDE1234A1Z5', lines=None):
    if lines is None:
        lines = [SimpleNamespace(
            taxable_amount=Decimal('1000.00'), cgst_amount=Decimal('0'),
            sgst_amount=Decimal('0'), igst_amount=Decimal('0'), tax_percent=Decimal('0'),
        )]

    class _Lines:
        def all(self):
            return lines

    return SimpleNamespace(
        id=reversal_id, status='confirmed', reversal_type=rev_type,
        reversal_no='PREV-1', reversal_date=date(2026, 5, 2),
        original_purchase_order_id=po_id,
        supplier=SimpleNamespace(gst_no=supplier_gstin), supplier_id=9,
        location_id=location_id, lines=_Lines(),
    )


class PurchaseReversalJournalTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()
        # The isolated accounting test DB has none of pharmacy's managed=False RO
        # tables (product_master_location, supplier_master_supplier, …), which
        # the supply-type resolver and party-ledger lookup read. Stub them — the
        # reversal/swap logic under test doesn't depend on their internals.
        for target, kw in (
            ('_get_supply_type', {'return_value': 'intra_state'}),
            ('_party_account', {
                'side_effect': lambda party_type, party_id, fallback, location_id=None: fallback,
            }),
        ):
            p = patch.object(JournalAutoGenerationService, target, **kw)
            p.start()
            self.addCleanup(p.stop)

    def _post_original_purchase(self, po):
        with patch('journals.services.PurchaseOrderRO') as MockPO:
            MockPO.objects.select_related.return_value.prefetch_related.return_value.get.return_value = po
            return self.svc.generate_purchase(po.id)

    def _gen_reversal(self, rev):
        with patch('journals.services.PurchaseReversalRO') as MockRev:
            MockRev.objects.select_related.return_value.prefetch_related.return_value.get.return_value = rev
            return self.svc.generate_purchase_reversal(rev.id)

    def test_full_reversal_swaps_and_leaves_original(self):
        po = _make_purchase_order()
        original = self._post_original_purchase(po)
        self.assertIsNotNone(original)
        orig_debit = sum(l.debit for l in original.lines.all())
        orig_credit = sum(l.credit for l in original.lines.all())
        orig_line_count = original.lines.count()

        entry = self._gen_reversal(_make_reversal(po_id=po.id, rev_type='full'))
        self.assertIsNotNone(entry)
        self.assertEqual(entry.voucher_type, 'DEBIT_NOTE')
        self.assertEqual(entry.reference_type, 'PurchaseReversal')

        rev_debit = sum(l.debit for l in entry.lines.all())
        rev_credit = sum(l.credit for l in entry.lines.all())
        self.assertEqual(rev_debit, rev_credit)              # balanced
        self.assertEqual(rev_debit, orig_credit)             # debits ↔ credits swapped
        self.assertEqual(rev_credit, orig_debit)

        # Original purchase entry is untouched.
        original.refresh_from_db()
        self.assertTrue(original.is_posted)
        self.assertEqual(original.lines.count(), orig_line_count)
        self.assertIsNone(original.reversal_of)

    def test_full_reversal_without_booked_purchase_posts_nothing(self):
        # No purchase JE exists for this PO → nothing to reverse in the books.
        entry = self._gen_reversal(_make_reversal(reversal_id=750, po_id=999999, rev_type='full'))
        self.assertIsNone(entry)

    def test_partial_reversal_posts_balanced_debit_note(self):
        rev = _make_reversal(reversal_id=702, rev_type='partial', lines=[
            SimpleNamespace(taxable_amount=Decimal('500.00'), cgst_amount=Decimal('30.00'),
                            sgst_amount=Decimal('30.00'), igst_amount=Decimal('0'),
                            tax_percent=Decimal('12')),
        ])
        entry = self._gen_reversal(rev)
        self.assertIsNotNone(entry)
        self.assertEqual(entry.voucher_type, 'DEBIT_NOTE')
        lines = list(entry.lines.all())
        total_debit = sum(l.debit for l in lines)
        total_credit = sum(l.credit for l in lines)
        self.assertEqual(total_debit, total_credit)          # balanced
        self.assertEqual(total_debit, Decimal('560.00'))     # 500 taxable + 60 tax

    def test_idempotent(self):
        rev = _make_reversal(reversal_id=703, rev_type='partial', lines=[
            SimpleNamespace(taxable_amount=Decimal('100.00'), cgst_amount=Decimal('6'),
                            sgst_amount=Decimal('6'), igst_amount=Decimal('0'),
                            tax_percent=Decimal('12')),
        ])
        first = self._gen_reversal(rev)
        second = self._gen_reversal(rev)
        self.assertIsNotNone(first)
        self.assertIsNone(second)

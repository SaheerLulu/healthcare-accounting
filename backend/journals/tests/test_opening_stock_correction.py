"""Approved opening-stock corrections must post a DELTA JV — the original
OpeningStock JV is never rewritten. Value deltas move 1190 Closing Stock,
tax deltas move 1140/1150 Input GST (50/50), balanced against 3300 Opening
Balance Equity, with direction flipping per sign. Batch/expiry-only edits
net to zero and post nothing; pending/rejected corrections post nothing.
"""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry
from journals.services import JournalAutoGenerationService


def _make_correction(*, corr_id=901, status='approved', location_id=1,
                     lines=(((10, '50.00', '60.00'), (10, '50.00', '60.00')),),
                     supply_type=None):
    """Mock OpeningStockCorrectionRO. Each entry in `lines` is a pair of
    (qty, rate, tax_value) tuples: (old, new). `supply_type=None` omits the
    `opening_stock` relation entirely (legacy mock shape — exercises the
    service's getattr fallback); pass 'intra'/'inter' to attach a parent."""
    line_objs = []
    for i, (old, new) in enumerate(lines, start=1):
        line_objs.append(SimpleNamespace(
            id=i,
            old_quantity=old[0], old_purchase_rate=Decimal(old[1]),
            old_tax_value=Decimal(old[2]),
            new_quantity=new[0], new_purchase_rate=Decimal(new[1]),
            new_tax_value=Decimal(new[2]),
        ))

    class _LinesMgr:
        def all(self):
            return line_objs

    corr = SimpleNamespace(
        id=corr_id, status=status,
        opening_stock_id=701, location_id=location_id,
        location=SimpleNamespace(id=location_id, name='Test Store'),
        reviewed_at=datetime(2026, 4, 5, 10, 0),
        created_at=datetime(2026, 4, 5, 9, 0),
        lines=_LinesMgr(),
    )
    if supply_type is not None:
        corr.opening_stock = SimpleNamespace(id=701, supply_type=supply_type)
    return corr


class OpeningStockCorrectionJVTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _run(self, corr):
        with patch('journals.services.OpeningStockCorrectionRO') as MockRO:
            (MockRO.objects.select_related.return_value
             .get.return_value) = corr
            return self.svc.generate_opening_stock_correction(corr.id)

    def _codes(self, entry):
        return {l.account.account_code: (l.debit, l.credit) for l in entry.lines.all()}

    def test_quantity_increase_debits_stock_and_gst_credits_equity(self):
        # 100 → 130 @ ₹50 (value +1500); tax 600 → 780 (+180)
        corr = _make_correction(lines=(
            ((100, '50.00', '600.00'), (130, '50.00', '780.00')),
        ))
        entry = self._run(corr)

        self.assertIsNotNone(entry)
        self.assertTrue(entry.is_posted)
        codes = self._codes(entry)
        self.assertEqual(codes['1190'], (Decimal('1500.00'), Decimal('0')))
        self.assertEqual(codes['1140'], (Decimal('90.00'), Decimal('0')))
        self.assertEqual(codes['1150'], (Decimal('90.00'), Decimal('0')))
        self.assertEqual(codes['3300'], (Decimal('0'), Decimal('1680.00')))

    def test_quantity_decrease_credits_stock_and_gst_debits_equity(self):
        # 100 → 80 @ ₹50 (value −1000); tax 600 → 480 (−120)
        corr = _make_correction(corr_id=902, lines=(
            ((100, '50.00', '600.00'), (80, '50.00', '480.00')),
        ))
        entry = self._run(corr)

        codes = self._codes(entry)
        self.assertEqual(codes['1190'], (Decimal('0'), Decimal('1000.00')))
        self.assertEqual(codes['1140'], (Decimal('0'), Decimal('60.00')))
        self.assertEqual(codes['1150'], (Decimal('0'), Decimal('60.00')))
        self.assertEqual(codes['3300'], (Decimal('1120.00'), Decimal('0')))

    def test_opposite_sign_deltas_balance_without_equity_leg(self):
        # Value +100 while tax −100 → net 0: no equity line, JV still foots.
        corr = _make_correction(corr_id=903, lines=(
            ((10, '50.00', '100.00'), (12, '50.00', '0.00')),
        ))
        entry = self._run(corr)

        codes = self._codes(entry)
        self.assertEqual(codes['1190'], (Decimal('100.00'), Decimal('0')))
        self.assertEqual(codes['1140'], (Decimal('0'), Decimal('50.00')))
        self.assertEqual(codes['1150'], (Decimal('0'), Decimal('50.00')))
        self.assertNotIn('3300', codes)
        total_debits = sum(l.debit for l in entry.lines.all())
        total_credits = sum(l.credit for l in entry.lines.all())
        self.assertEqual(total_debits, total_credits)

    def test_odd_paise_tax_delta_foots(self):
        # tax delta +₹0.01 → CGST 0.01, SGST leg skipped (zero), equity 0.01.
        corr = _make_correction(corr_id=904, lines=(
            ((10, '50.00', '60.00'), (10, '50.00', '60.01')),
        ))
        entry = self._run(corr)

        codes = self._codes(entry)
        self.assertEqual(codes['1140'], (Decimal('0.01'), Decimal('0')))
        self.assertNotIn('1150', codes)
        self.assertEqual(codes['3300'], (Decimal('0'), Decimal('0.01')))
        total_debits = sum(l.debit for l in entry.lines.all())
        total_credits = sum(l.credit for l in entry.lines.all())
        self.assertEqual(total_debits, total_credits)

    def test_batch_only_edit_posts_nothing(self):
        # Same qty/rate/tax → zero delta (a rebatch) — books unaffected.
        corr = _make_correction(corr_id=905)
        result = self._run(corr)

        self.assertIsNone(result)
        self.assertFalse(JournalEntry.objects.filter(
            reference_type='OpeningStockCorrection').exists())

    def test_pending_correction_posts_nothing(self):
        corr = _make_correction(corr_id=906, status='pending', lines=(
            ((100, '50.00', '600.00'), (80, '50.00', '480.00')),
        ))
        self.assertIsNone(self._run(corr))

    def test_idempotent_on_rerun(self):
        corr = _make_correction(corr_id=907, lines=(
            ((100, '50.00', '600.00'), (80, '50.00', '480.00')),
        ))
        first = self._run(corr)
        second = self._run(corr)

        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertEqual(
            JournalEntry.objects.filter(
                reference_type='OpeningStockCorrection', reference_id=corr.id,
            ).count(),
            1,
        )

    def test_inter_parent_positive_tax_delta_debits_input_igst(self):
        # Parent entry was inter-state → the whole +180 delta hits 1160.
        corr = _make_correction(corr_id=908, supply_type='inter', lines=(
            ((100, '50.00', '600.00'), (130, '50.00', '780.00')),
        ))
        entry = self._run(corr)

        codes = self._codes(entry)
        self.assertEqual(codes['1160'], (Decimal('180.00'), Decimal('0')))
        self.assertNotIn('1140', codes)
        self.assertNotIn('1150', codes)
        self.assertEqual(codes['1190'], (Decimal('1500.00'), Decimal('0')))
        self.assertEqual(codes['3300'], (Decimal('0'), Decimal('1680.00')))

    def test_inter_parent_negative_tax_delta_credits_input_igst(self):
        corr = _make_correction(corr_id=909, supply_type='inter', lines=(
            ((100, '50.00', '600.00'), (80, '50.00', '480.00')),
        ))
        entry = self._run(corr)

        codes = self._codes(entry)
        self.assertEqual(codes['1160'], (Decimal('0'), Decimal('120.00')))
        self.assertNotIn('1140', codes)
        self.assertNotIn('1150', codes)

    def test_intra_parent_keeps_cgst_sgst_split(self):
        # Explicit intra parent — same split as the legacy no-parent mocks.
        corr = _make_correction(corr_id=910, supply_type='intra', lines=(
            ((100, '50.00', '600.00'), (130, '50.00', '780.00')),
        ))
        entry = self._run(corr)

        codes = self._codes(entry)
        self.assertEqual(codes['1140'], (Decimal('90.00'), Decimal('0')))
        self.assertEqual(codes['1150'], (Decimal('90.00'), Decimal('0')))
        self.assertNotIn('1160', codes)

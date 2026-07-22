"""Opening-stock auto-post: every OpeningStock batch on the inventory side
should generate a balanced JV (Dr 1190 Closing Stock / Cr 3300 Opening
Balance Equity) the first time sync sees it, and a no-op on every re-run.
Lines carrying a GST tax_value additionally bring the input credit onto the
books (Dr 1140 Input CGST + Dr 1150 Input SGST, equity grossed up).
"""
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine
from journals.services import JournalAutoGenerationService


def _make_opening_stock(*, batch_id=701, location_id=1,
                       lines=((10, '10.00'), (5, '20.00'))):
    """Build a mock OpeningStockRO with (qty, rate) or (qty, rate, tax_value)
    line tuples. 2-tuples get no tax_value attribute at all — mirroring rows
    from before the pharmacy added the column."""
    from datetime import datetime, date
    line_objs = []
    for i, spec in enumerate(lines, start=1):
        line = SimpleNamespace(product_id=100 + i, quantity=spec[0],
                               purchase_rate=Decimal(spec[1]), batch_no=f'B{i}')
        if len(spec) > 2:
            line.tax_value = Decimal(spec[2])
        line_objs.append(line)

    class _LinesMgr:
        def all(self):
            return line_objs

    return SimpleNamespace(
        id=batch_id, location_id=location_id,
        location=SimpleNamespace(id=location_id, name='Test Store'),
        opening_date=date(2026, 4, 1),
        created_at=datetime(2026, 4, 1, 9, 0),
        lines=_LinesMgr(),
    )


class OpeningStockJVTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _run_generate(self, batch):
        from journals.services import OpeningStockRO
        # Mock the select_related().get() chain on the proxy manager.
        manager = patch.object(OpeningStockRO, 'objects')
        m = manager.start()
        m.select_related.return_value.get.return_value = batch
        try:
            return self.svc.generate_opening_stock(batch.id)
        finally:
            manager.stop()

    def test_posts_dr_1190_cr_3300_for_total_value(self):
        # 10 × ₹10 + 5 × ₹20 = ₹200
        batch = _make_opening_stock(lines=((10, '10.00'), (5, '20.00')))
        entry = self._run_generate(batch)

        self.assertIsNotNone(entry)
        self.assertTrue(entry.is_posted)
        codes = {l.account.account_code: (l.debit, l.credit) for l in entry.lines.all()}

        self.assertEqual(codes['1190'], (Decimal('200.00'), Decimal('0')),
                         'Closing Stock (1190) must be debited for total value')
        self.assertEqual(codes['3300'], (Decimal('0'), Decimal('200.00')),
                         'Opening Balance Equity (3300) must be credited')

    def test_idempotent_on_rerun(self):
        batch = _make_opening_stock()
        first = self._run_generate(batch)
        second = self._run_generate(batch)

        self.assertIsNotNone(first)
        self.assertIsNone(second, 'second run must no-op (reference already synced)')
        self.assertEqual(
            JournalEntry.objects.filter(
                reference_type='OpeningStock', reference_id=batch.id,
            ).count(),
            1,
        )

    def test_empty_batch_returns_none_no_je_created(self):
        batch = _make_opening_stock(batch_id=702, lines=())
        result = self._run_generate(batch)

        self.assertIsNone(result)
        self.assertFalse(
            JournalEntry.objects.filter(reference_type='OpeningStock').exists(),
        )

    def test_zero_value_lines_skipped(self):
        # Both lines have zero qty → total value 0, no JE.
        batch = _make_opening_stock(batch_id=703, lines=((0, '10.00'), (0, '20.00')))
        result = self._run_generate(batch)
        self.assertIsNone(result)


class OpeningStockInputGSTTests(OpeningStockJVTests):
    """Lines with a tax_value must bring the input GST credit onto the books."""

    def test_tax_value_posts_input_cgst_sgst_and_grosses_up_equity(self):
        # value = 10×₹100 + 5×₹200 = ₹2000; tax = 120 + 120 = ₹240
        batch = _make_opening_stock(
            batch_id=711,
            lines=((10, '100.00', '120.00'), (5, '200.00', '120.00')),
        )
        entry = self._run_generate(batch)

        self.assertIsNotNone(entry)
        codes = {l.account.account_code: (l.debit, l.credit) for l in entry.lines.all()}
        self.assertEqual(codes['1190'], (Decimal('2000.00'), Decimal('0')),
                         'inventory stays at the ex-tax purchase value')
        self.assertEqual(codes['1140'], (Decimal('120.00'), Decimal('0')),
                         'half the tax lands in Input CGST')
        self.assertEqual(codes['1150'], (Decimal('120.00'), Decimal('0')),
                         'half the tax lands in Input SGST')
        self.assertEqual(codes['3300'], (Decimal('0'), Decimal('2240.00')),
                         'equity credit must gross up to value + tax')

    def test_odd_paise_tax_still_balances(self):
        # tax = ₹100.01 → CGST 50.01 (half-up) + SGST 50.00
        batch = _make_opening_stock(
            batch_id=712, lines=((1, '1000.00', '100.01'),))
        entry = self._run_generate(batch)

        codes = {l.account.account_code: (l.debit, l.credit) for l in entry.lines.all()}
        self.assertEqual(codes['1140'][0], Decimal('50.01'))
        self.assertEqual(codes['1150'][0], Decimal('50.00'))
        total_debits = sum(l.debit for l in entry.lines.all())
        total_credits = sum(l.credit for l in entry.lines.all())
        self.assertEqual(total_debits, total_credits, 'JV must foot')

    def test_zero_tax_batch_posts_no_input_gst_lines(self):
        # Legacy shape (2-tuples, no tax_value attribute at all).
        batch = _make_opening_stock(batch_id=713, lines=((10, '10.00'),))
        entry = self._run_generate(batch)

        codes = {l.account.account_code for l in entry.lines.all()}
        self.assertNotIn('1140', codes)
        self.assertNotIn('1150', codes)
        by_code = {l.account.account_code: (l.debit, l.credit) for l in entry.lines.all()}
        self.assertEqual(by_code['3300'], (Decimal('0'), Decimal('100.00')),
                         'no tax → equity credit equals plain inventory value')

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
                       lines=((10, '10.00'), (5, '20.00')),
                       supply_type=None):
    """Build a mock OpeningStockRO with (qty, rate) or (qty, rate, tax_value)
    line tuples. 2-tuples get no tax_value attribute at all — mirroring rows
    from before the pharmacy added the column. Likewise `supply_type=None`
    omits the attribute entirely (pre-column shape); pass 'intra'/'inter'
    to include it."""
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

    batch = SimpleNamespace(
        id=batch_id, location_id=location_id,
        location=SimpleNamespace(id=location_id, name='Test Store'),
        opening_date=date(2026, 4, 1),
        created_at=datetime(2026, 4, 1, 9, 0),
        lines=_LinesMgr(),
    )
    if supply_type is not None:
        batch.supply_type = supply_type
    return batch


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

    def test_inter_batch_posts_full_tax_to_input_igst(self):
        # value = 10×₹100 + 5×₹200 = ₹2000; tax = 120 + 120 = ₹240 all IGST
        batch = _make_opening_stock(
            batch_id=714, supply_type='inter',
            lines=((10, '100.00', '120.00'), (5, '200.00', '120.00')),
        )
        entry = self._run_generate(batch)

        self.assertIsNotNone(entry)
        codes = {l.account.account_code: (l.debit, l.credit) for l in entry.lines.all()}
        self.assertEqual(codes['1160'], (Decimal('240.00'), Decimal('0')),
                         'inter batch → whole tax lands in Input IGST')
        self.assertNotIn('1140', codes)
        self.assertNotIn('1150', codes)
        self.assertEqual(codes['3300'], (Decimal('0'), Decimal('2240.00')),
                         'equity credit still grosses up to value + tax')

    def test_explicit_intra_batch_keeps_cgst_sgst_split(self):
        batch = _make_opening_stock(
            batch_id=715, supply_type='intra',
            lines=((1, '1000.00', '100.00'),),
        )
        entry = self._run_generate(batch)

        codes = {l.account.account_code: (l.debit, l.credit) for l in entry.lines.all()}
        self.assertEqual(codes['1140'], (Decimal('50.00'), Decimal('0')))
        self.assertEqual(codes['1150'], (Decimal('50.00'), Decimal('0')))
        self.assertNotIn('1160', codes)

    def test_inter_batch_with_zero_tax_posts_no_gst_line(self):
        batch = _make_opening_stock(batch_id=716, supply_type='inter',
                                    lines=((10, '10.00'),))
        entry = self._run_generate(batch)

        codes = {l.account.account_code for l in entry.lines.all()}
        self.assertNotIn('1160', codes)


class OpeningStockLooseValueTests(OpeningStockJVTests):
    """Lines carrying loose units add loose × rate / qty_per_pack to the
    inventory value; legacy lines without the columns are unaffected."""

    def test_loose_units_join_the_inventory_value(self):
        # 10 packs × ₹100 + 5 loose × ₹100/10 = 1000 + 50 = ₹1050; tax ₹126
        batch = _make_opening_stock(batch_id=721, lines=((10, '100.00', '126.00'),))
        line = batch.lines.all()[0]
        line.qty_per_pack = 10
        line.loose_quantity = 5
        entry = self._run_generate(batch)

        codes = {l.account.account_code: (l.debit, l.credit) for l in entry.lines.all()}
        self.assertEqual(codes['1190'], (Decimal('1050.00'), Decimal('0')))
        self.assertEqual(codes['3300'], (Decimal('0'), Decimal('1176.00')))

    def test_zero_qty_per_pack_treated_as_one(self):
        # Defensive: loose with qpp=0 must not divide by zero; values as packs.
        batch = _make_opening_stock(batch_id=722, lines=((10, '100.00'),))
        line = batch.lines.all()[0]
        line.qty_per_pack = 0
        line.loose_quantity = 5
        entry = self._run_generate(batch)

        codes = {l.account.account_code: (l.debit, l.credit) for l in entry.lines.all()}
        self.assertEqual(codes['1190'], (Decimal('1500.00'), Decimal('0')))  # 1000 + 5×100/1

    def test_legacy_lines_without_columns_unchanged(self):
        batch = _make_opening_stock(batch_id=723, lines=((10, '10.00'),))
        entry = self._run_generate(batch)
        codes = {l.account.account_code: (l.debit, l.credit) for l in entry.lines.all()}
        self.assertEqual(codes['1190'], (Decimal('100.00'), Decimal('0')))

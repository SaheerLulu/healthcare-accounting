"""Opening-stock auto-post: every OpeningStock batch on the inventory side
should generate a balanced JV (Dr 1190 Closing Stock / Cr 3300 Opening
Balance Equity) the first time sync sees it, and a no-op on every re-run.
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
    """Build a mock OpeningStockRO with given (qty, rate) line tuples."""
    from datetime import datetime, date
    line_objs = [
        SimpleNamespace(product_id=100 + i, quantity=q,
                        purchase_rate=Decimal(r), batch_no=f'B{i}')
        for i, (q, r) in enumerate(lines, start=1)
    ]

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

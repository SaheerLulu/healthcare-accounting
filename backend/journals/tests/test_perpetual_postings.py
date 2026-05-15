"""Single-mode perpetual inventory — assert the JV shape produced by every
sync-driven generator. Purchases must hit 1190 Closing Stock (asset);
every sale must post a COGS leg debiting 5560 and crediting 1190.
"""
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine
from journals.services import JournalAutoGenerationService


def _make_purchase_order(*, location_id=1, supplier_gstin='27ABCDE1234A1Z5'):
    """Mock PurchaseOrderRO with one line at 100 qty × ₹10 = ₹1000, no tax."""
    from datetime import datetime
    from types import SimpleNamespace

    line = SimpleNamespace(
        product_id=101, quantity=100, free_qty=0,
        purchase_rate=Decimal('10.00'), discount_percent=Decimal('0'),
        cgst_amount=Decimal('0'), sgst_amount=Decimal('0'),
        igst_amount=Decimal('0'), tax_percent=Decimal('0'),
    )

    class _LinesMgr:
        def all(self):
            return [line]

    po = SimpleNamespace(
        id=501, state='confirmed',
        supplier=SimpleNamespace(gst_no=supplier_gstin),
        supplier_id=9, location_id=location_id,
        bill_date=None, bill_no='PO-001',
        transport_cost=Decimal('0'), other_charges=Decimal('0'),
        round_off=Decimal('0'), supply_type='intra_state',
        created_at=datetime(2026, 4, 10),
        lines=_LinesMgr(),
    )
    return po


class PerpetualPurchasePostsToStockTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def test_purchase_debits_1190_not_5100(self):
        po = _make_purchase_order()

        with patch('journals.services.PurchaseOrderRO') as MockPO:
            MockPO.objects.select_related.return_value.prefetch_related.return_value.get.return_value = po
            entry = self.svc.generate_purchase(po.id)

        self.assertIsNotNone(entry, 'purchase JE should be generated')
        lines = list(entry.lines.all())
        codes = {l.account.account_code: (l.debit, l.credit) for l in lines}

        # 1190 Closing Stock debited for the full purchase taxable amount.
        self.assertIn('1190', codes, 'Closing Stock (1190) must be debited')
        self.assertEqual(codes['1190'][0], Decimal('1000.00'))
        self.assertEqual(codes['1190'][1], Decimal('0'))

        # 5100 Purchases must NOT appear — perpetual mode bypasses it.
        self.assertNotIn('5100', codes, '5100 Purchases must not be touched in perpetual mode')

        # Trade Payables credited for the same amount.
        self.assertIn('2110', codes)
        self.assertEqual(codes['2110'][1], Decimal('1000.00'))


class PerpetualSalePostsCOGSTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def test_post_cogs_helper_creates_dr_cogs_cr_stock(self):
        from journals.models import JournalEntry, JournalEntryLine
        from datetime import date

        entry = JournalEntry.objects.create(
            date=date(2026, 4, 20), voucher_type='SALE',
            reference_type='POSOrder', reference_id=999, location_id=1,
        )

        class _SaleLine:
            product_id = 101
            quantity = 50

        # Avg cost = ₹10 (from the purchase order line at ₹10/unit).
        with patch.object(self.svc, '_product_avg_cost', return_value=Decimal('10.00')):
            total = self.svc._post_cogs(entry=entry, lines=[_SaleLine()])

        self.assertEqual(total, Decimal('500.00'))
        lines = list(entry.lines.all())
        codes = {l.account.account_code: (l.debit, l.credit) for l in lines}
        self.assertEqual(codes['5560'], (Decimal('500.00'), Decimal('0')),
                         'COGS (5560) must be debited at sale time')
        self.assertEqual(codes['1190'], (Decimal('0'), Decimal('500.00')),
                         'Closing Stock (1190) must be credited to relieve inventory')

    def test_post_cogs_skips_zero_qty_lines(self):
        from journals.models import JournalEntry
        from datetime import date

        entry = JournalEntry.objects.create(
            date=date(2026, 4, 20), voucher_type='SALE',
            reference_type='POSOrder', reference_id=998, location_id=1,
        )

        class _ZeroLine:
            product_id = 102
            quantity = 0

        with patch.object(self.svc, '_product_avg_cost', return_value=Decimal('10.00')):
            total = self.svc._post_cogs(entry=entry, lines=[_ZeroLine()])

        self.assertEqual(total, Decimal('0'))
        self.assertEqual(entry.lines.count(), 0)

"""Regression tests for two CRITICAL sync-engine accounting defects:

  C1 — COGS was a plain Avg('purchase_rate') (unweighted, location-blind,
       all-time), overstating cost of sales by tens of × on uneven lot sizes.
  C2 — A POS order-level discount left the sale JE unbalanced past the
       round-off band, so entry.post() raised and the sync loop silently
       swallowed the WHOLE sale (revenue, output GST and COGS all vanished).
"""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from core.models import AccountMapping, ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.services import JournalAutoGenerationService


class _LinesMgr:
    def __init__(self, lines):
        self._lines = lines

    def all(self):
        return self._lines


class WeightedCostTests(TestCase):
    """C1: cost must be quantity-weighted, not a simple average of rates."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def test_cost_is_quantity_weighted_not_simple_average(self):
        # Two lots: 1000 units @ ₹10 and 1 unit @ ₹1000.
        # Weighted = (1000*10 + 1*1000) / 1001 = ₹10.99.
        # The old Avg(purchase_rate) gave (10+1000)/2 = ₹505 — a ~46× overstate.
        with patch('journals.services.PurchaseOrderLineRO') as MockPO, \
             patch('journals.services.OpeningStockLineRO') as MockOS:
            MockPO.objects.filter.return_value.aggregate.return_value = {
                'cost': Decimal('11000'), 'qty': Decimal('1001'),
            }
            MockOS.objects.filter.return_value.aggregate.return_value = {
                'cost': None, 'qty': None,
            }
            cost = self.svc._product_avg_cost(101)

        self.assertLess(cost, Decimal('20'),
                        'cost must reflect the 1000-unit lot, not average the rates')
        self.assertAlmostEqual(cost, Decimal('10.99'), delta=Decimal('0.01'))

    def test_opening_stock_only_product_costs_out(self):
        # A product seeded ONLY via opening stock (never purchased through a PO)
        # must still cost out — previously it returned 0 and the sale relieved
        # no inventory, overstating Closing Stock forever.
        with patch('journals.services.PurchaseOrderLineRO') as MockPO, \
             patch('journals.services.OpeningStockLineRO') as MockOS:
            MockPO.objects.filter.return_value.aggregate.return_value = {
                'cost': None, 'qty': None,
            }
            MockOS.objects.filter.return_value.aggregate.return_value = {
                'cost': Decimal('5000'), 'qty': Decimal('100'),
            }
            cost = self.svc._product_avg_cost(202)

        self.assertEqual(cost, Decimal('50.0000'))

    def test_no_history_returns_zero(self):
        with patch('journals.services.PurchaseOrderLineRO') as MockPO, \
             patch('journals.services.OpeningStockLineRO') as MockOS:
            MockPO.objects.filter.return_value.aggregate.return_value = {'cost': None, 'qty': None}
            MockOS.objects.filter.return_value.aggregate.return_value = {'cost': None, 'qty': None}
            cost = self.svc._product_avg_cost(303)
        self.assertEqual(cost, Decimal('0'))


class POSDiscountBalancesTests(TestCase):
    """C2: a POS bill-level discount must still produce a balanced, posted sale."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        # The minimal test seed doesn't map DISCOUNT_ALLOWED — add it so the
        # discount lands deterministically on 5210 (else it falls back to 6100).
        disc, _ = ChartOfAccount.objects.get_or_create(
            account_code='5210',
            defaults=dict(account_name='Discount Allowed', account_type='REVENUE',
                          account_subtype='Other_Expense', is_leaf=True, is_active=True),
        )
        AccountMapping.objects.get_or_create(key='DISCOUNT_ALLOWED', defaults={'account': disc})
        self.svc = JournalAutoGenerationService()

    def _make_pos(self, *, discount):
        # One line ₹1180 incl. 18% GST → taxable 1000, tax 180 (cgst 90/sgst 90).
        line = SimpleNamespace(
            line_total=Decimal('1180.00'), tax_percent=Decimal('18'),
            product_id=301, quantity=10,
        )
        subtotal = Decimal('1180.00')
        return SimpleNamespace(
            id=701, status='completed', invoice_no='POS-701',
            customer_id=None, location_id=1,
            sale_date=datetime(2026, 4, 15),
            payment_type='Cash',
            discount_amount=Decimal(discount),
            round_off=Decimal('0.00'),
            subtotal=subtotal,
            total_amount=subtotal - Decimal(discount),
            lines=_LinesMgr([line]),
        )

    def _generate(self, pos):
        with patch('journals.services.POSOrderRO') as MockPOS, \
             patch.object(self.svc, '_product_avg_cost', return_value=Decimal('0')):
            MockPOS.objects.prefetch_related.return_value.get.return_value = pos
            return self.svc.generate_pos_sale(pos.id)

    def test_discounted_sale_posts_and_balances(self):
        pos = self._make_pos(discount='50.00')  # discount > ₹1 broke the old code
        entry = self._generate(pos)

        self.assertIsNotNone(entry, 'a discounted POS sale must still post')
        self.assertTrue(entry.is_posted)
        lines = list(entry.lines.all())
        total_dr = sum((l.debit for l in lines), Decimal('0'))
        total_cr = sum((l.credit for l in lines), Decimal('0'))
        self.assertEqual(total_dr, total_cr, 'the sale JE must balance')

        codes = {l.account.account_code: (l.debit, l.credit) for l in lines}
        # Revenue + output GST booked GROSS (pre-discount).
        self.assertEqual(codes['4100'][1], Decimal('1000.00'))
        self.assertEqual(codes['5210'][0], Decimal('50.00'), 'discount booked to Discount Allowed')
        # Customer settles net of discount.
        self.assertEqual(codes['1110'][0], Decimal('1130.00'))

    def test_zero_discount_unchanged(self):
        entry = self._generate(self._make_pos(discount='0.00'))
        self.assertTrue(entry.is_posted)
        codes = {l.account.account_code for l in entry.lines.all()}
        self.assertNotIn('5210', codes, 'no discount line when there is no discount')

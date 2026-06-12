"""Perf regression: `_product_avg_cost` runs 2 aggregate queries per call and
is invoked once per sale line. A 5-minute sync that posts hundreds of POS
sales over a small product catalogue therefore re-ran the same two aggregates
hundreds of times. The cost is now memoized per (product_id, location_id) on
the service instance — one instance lives for exactly one sync run, and
purchases post before sales in sync_all, so the snapshot cannot go stale
within its own run.
"""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.services import JournalAutoGenerationService


class _LinesMgr:
    def __init__(self, lines):
        self._lines = lines

    def all(self):
        return self._lines


def _make_pos(pos_id, *, product_id=301, location_id=1):
    line = SimpleNamespace(
        line_total=Decimal('1180.00'), tax_percent=Decimal('18'),
        product_id=product_id, quantity=10,
    )
    return SimpleNamespace(
        id=pos_id, status='completed', invoice_no=f'POS-{pos_id}',
        customer_id=None, location_id=location_id,
        sale_date=datetime(2026, 4, 15),
        payment_type='Cash',
        discount_amount=Decimal('0.00'),
        round_off=Decimal('0.00'),
        subtotal=Decimal('1180.00'),
        total_amount=Decimal('1180.00'),
        lines=_LinesMgr([line]),
    )


class AvgCostPerRunCacheTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _patched_aggregates(self):
        """Patch the RO line models so each .aggregate() is observable."""
        po = patch('journals.services.PurchaseOrderLineRO')
        os_ = patch('journals.services.OpeningStockLineRO')
        return po, os_

    def test_two_sales_of_same_product_run_aggregates_once(self):
        pos1, pos2 = _make_pos(701), _make_pos(702)
        po_patch, os_patch = self._patched_aggregates()
        with patch('journals.services.POSOrderRO') as MockPOS, \
                po_patch as MockPO, os_patch as MockOS:
            MockPOS.objects.prefetch_related.return_value.get.side_effect = [pos1, pos2]
            # The sale carries location_id=1, so the cost query is
            # .filter(product...).filter(location...).aggregate(...).
            po_agg = MockPO.objects.filter.return_value.filter.return_value.aggregate
            os_agg = MockOS.objects.filter.return_value.filter.return_value.aggregate
            po_agg.return_value = {'cost': Decimal('1000'), 'qty': Decimal('100')}
            os_agg.return_value = {'cost': None, 'qty': None}
            e1 = self.svc.generate_pos_sale(701)
            e2 = self.svc.generate_pos_sale(702)

        self.assertTrue(e1.is_posted)
        self.assertTrue(e2.is_posted)
        # Both sales costed (10 units @ ₹10 each → ₹100 COGS per sale)...
        for entry in (e1, e2):
            cogs = [l for l in entry.lines.all() if l.narration == 'COGS']
            self.assertEqual(len(cogs), 1)
            self.assertEqual(cogs[0].debit, Decimal('100.00'))
        # ...but the two underlying aggregates ran exactly ONCE for the run.
        self.assertEqual(po_agg.call_count, 1)
        self.assertEqual(os_agg.call_count, 1)

    def test_cache_is_scoped_per_product_and_location(self):
        po_patch, os_patch = self._patched_aggregates()
        with po_patch as MockPO, os_patch as MockOS:
            MockPO.objects.filter.return_value.filter.return_value.aggregate.return_value = {
                'cost': Decimal('1000'), 'qty': Decimal('100'),
            }
            MockPO.objects.filter.return_value.aggregate.return_value = {
                'cost': Decimal('1000'), 'qty': Decimal('100'),
            }
            MockOS.objects.filter.return_value.filter.return_value.aggregate.return_value = {
                'cost': None, 'qty': None,
            }
            MockOS.objects.filter.return_value.aggregate.return_value = {
                'cost': None, 'qty': None,
            }
            a = self.svc._product_avg_cost(301, 1)
            b = self.svc._product_avg_cost(301, 1)   # hit
            c = self.svc._product_avg_cost(301, 2)   # different location → miss
            d = self.svc._product_avg_cost(302, 1)   # different product → miss

        self.assertEqual(a, b)
        self.assertEqual(a, Decimal('10.0000'))
        self.assertEqual(c, Decimal('10.0000'))
        self.assertEqual(d, Decimal('10.0000'))
        # 3 distinct keys → 3 aggregate executions per RO model (not 4).
        agg_calls = (
            MockPO.objects.filter.return_value.filter.return_value.aggregate.call_count
        )
        self.assertEqual(agg_calls, 3)

    def test_zero_cost_is_cached_too(self):
        po_patch, os_patch = self._patched_aggregates()
        with po_patch as MockPO, os_patch as MockOS:
            MockPO.objects.filter.return_value.filter.return_value.aggregate.return_value = {
                'cost': None, 'qty': None,
            }
            MockOS.objects.filter.return_value.filter.return_value.aggregate.return_value = {
                'cost': None, 'qty': None,
            }
            self.assertEqual(self.svc._product_avg_cost(404, 1), Decimal('0'))
            self.assertEqual(self.svc._product_avg_cost(404, 1), Decimal('0'))
            self.assertEqual(
                MockPO.objects.filter.return_value.filter.return_value
                .aggregate.call_count, 1,
            )

    def test_fresh_service_does_not_share_cache(self):
        po_patch, os_patch = self._patched_aggregates()
        with po_patch as MockPO, os_patch as MockOS:
            MockPO.objects.filter.return_value.filter.return_value.aggregate.return_value = {
                'cost': Decimal('500'), 'qty': Decimal('50'),
            }
            MockOS.objects.filter.return_value.filter.return_value.aggregate.return_value = {
                'cost': None, 'qty': None,
            }
            self.svc._product_avg_cost(301, 1)
            JournalAutoGenerationService()._product_avg_cost(301, 1)
            self.assertEqual(
                MockPO.objects.filter.return_value.filter.return_value
                .aggregate.call_count, 2,
            )

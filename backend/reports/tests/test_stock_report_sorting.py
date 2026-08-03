"""#801 — product-name sorting was case-sensitive in the stock reports.

Python compares strings by codepoint, so every capital sorted ahead of every
lowercase letter and "Zinc" came before "amoxicillin".
"""
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.sorting import ci_key
from core.tests.utils import make_admin, make_settings, seed_chart_and_mappings
from reports.views import StockMovementSummaryView, StockValuationView

# Deliberately mixed case, and two products sharing a name so the tiebreak is
# exercised rather than left to dict order.
PRODUCTS = [
    SimpleNamespace(id=1, name='Zinc', pharma_hsn_code='30045020', default_code='P-004'),
    SimpleNamespace(id=2, name='amoxicillin', pharma_hsn_code='30041020', default_code='P-002'),
    SimpleNamespace(id=3, name='Betadine', pharma_hsn_code='30049099', default_code='P-003'),
    SimpleNamespace(id=4, name='apple', pharma_hsn_code='30049010', default_code='P-001'),
    SimpleNamespace(id=5, name='Apple', pharma_hsn_code='30049011', default_code='P-005'),
    SimpleNamespace(id=6, name='banana', pharma_hsn_code='30049012', default_code='P-006'),
]

MOVES = [
    SimpleNamespace(
        product_id=p.id, product=p, quantity=10, quantity_before=0,
        quantity_after=10, location_id=1,
        created_at=datetime(2026, 5, 1, 10, 0), movement_type='purchase',
    )
    for p in PRODUCTS
]


class _FakeQS:
    """Enough of a queryset for the two views' access patterns."""

    def __init__(self, items):
        self._items = list(items)

    def _filtered(self, **kw):
        items = self._items
        for key, value in kw.items():
            if key == 'id__in':
                items = [i for i in items if i.id in set(value)]
            elif key.endswith('__gte') or key.endswith('__lte') or key.endswith('__lt'):
                continue
            elif key in ('location_id',):
                items = [i for i in items if getattr(i, 'location_id', None) == value]
        return _FakeQS(items)

    def filter(self, *args, **kw):
        return self._filtered(**kw)

    def exclude(self, *a, **kw):
        return self

    def select_related(self, *a, **kw):
        return self

    def order_by(self, *a):
        return self

    def all(self):
        return self

    def none(self):
        return _FakeQS([])

    def __iter__(self):
        return iter(self._items)

    def __len__(self):
        return len(self._items)


class StockReportSortingTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _names(self, view, params):
        request = self.factory.get('/api/reports/x/', params)
        force_authenticate(request, self.admin)
        with patch('inventory_reader.models.StockMovementRO.objects', _FakeQS(MOVES)), \
             patch('inventory_reader.models.ProductRO.objects', _FakeQS(PRODUCTS)), \
             patch('reports.views._weighted_avg_rates', return_value={}):
            resp = view.as_view()(request)
        return [r['product_name'] for r in resp.data['rows']]

    # The ticket's example — apple/Apple, banana, Zinc — plus amoxicillin and
    # Betadine so a capital has to sort between two lowercase names rather
    # than only at the end.
    EXPECTED = ['amoxicillin', 'apple', 'Apple', 'banana', 'Betadine', 'Zinc']

    def test_stock_movement_sorts_case_insensitively(self):
        names = self._names(StockMovementSummaryView, {
            'start_date': '2026-04-01', 'end_date': '2026-06-30'})
        self.assertEqual(names, self.EXPECTED)

    def test_stock_valuation_sorts_case_insensitively(self):
        names = self._names(StockValuationView, {'date': '2026-06-30'})
        self.assertEqual(names, self.EXPECTED)

    def test_equal_names_fall_back_to_product_code(self):
        """'apple' (P-001) must precede 'Apple' (P-005) every run, rather than
        landing in whatever order the source dict happened to yield."""
        request = self.factory.get('/api/reports/x/', {'date': '2026-06-30'})
        force_authenticate(request, self.admin)
        with patch('inventory_reader.models.StockMovementRO.objects', _FakeQS(MOVES)), \
             patch('inventory_reader.models.ProductRO.objects', _FakeQS(PRODUCTS)), \
             patch('reports.views._weighted_avg_rates', return_value={}):
            rows = StockValuationView.as_view()(request).data['rows']
        order = [r['product_id'] for r in rows]
        # apple is P-001 and Apple is P-005, so the code breaks the tie the
        # same way on every run rather than following dict order.
        self.assertLess(order.index(4), order.index(5))


class CiKeyTests(TestCase):
    def test_folds_case_but_keeps_numbers_numeric(self):
        self.assertEqual(
            sorted(['Zinc', 'amoxicillin', 'Betadine', 'aspirin'], key=ci_key),
            ['amoxicillin', 'aspirin', 'Betadine', 'Zinc'],
        )
        self.assertLess(ci_key('a', 2), ci_key('a', 10))

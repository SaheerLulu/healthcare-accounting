"""Dashboard window: defaults to the current FY, but any custom
?start_date/?end_date range must drive the totals and the monthly chart."""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from core.views import DashboardView


class DashboardRangeTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        cash, sales = self.coa['1110'], self.coa['4100']
        # Previous FY revenue (June 2025) + current FY revenue (May 2026).
        make_journal_entry(d=date(2025, 6, 10), lines=[
            (cash, Decimal('1000'), Decimal('0')), (sales, Decimal('0'), Decimal('1000'))])
        make_journal_entry(d=date(2026, 5, 10), lines=[
            (cash, Decimal('400'), Decimal('0')), (sales, Decimal('0'), Decimal('400'))])

    def _get(self, **params):
        request = self.factory.get('/api/accounts/dashboard/', params)
        force_authenticate(request, user=self.admin)
        return DashboardView.as_view()(request).data

    def test_default_is_current_fy(self):
        data = self._get()
        self.assertEqual(data['total_revenue'], 400.0)

    def test_custom_range_spans_both_years(self):
        data = self._get(start_date='2025-04-01', end_date='2026-06-30')
        self.assertEqual(data['total_revenue'], 1400.0)
        months = [m['month'] for m in data['monthly_data']]
        self.assertIn('Jun 2025', months)
        self.assertIn('May 2026', months)
        self.assertEqual(data['range_start'], '2025-04-01')

    def test_single_past_month(self):
        data = self._get(start_date='2025-06-01', end_date='2025-06-30')
        self.assertEqual(data['total_revenue'], 1000.0)
        self.assertEqual(len(data['monthly_data']), 1)

    def test_swapped_dates_are_normalised(self):
        data = self._get(start_date='2026-06-30', end_date='2025-04-01')
        self.assertEqual(data['total_revenue'], 1400.0)

"""Dashboard window: defaults to the current FY, but any custom
?start_date/?end_date range must drive the totals and the monthly chart —
and nothing may be reported past today, however far the window runs."""
from datetime import date, timedelta
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
        # A reversed range is a slip of the date pickers, not an error — the
        # window is swapped into order and reported back that way.
        self.assertEqual(data['range_start'], '2025-04-01')
        self.assertEqual(data['range_end'], '2026-06-30')

    def test_month_span_reported_for_the_default_fy(self):
        data = self._get()
        # 12 months of financial year, none of them lost to the 36-bucket cap.
        self.assertEqual(data['monthly_months_total'], 12)
        self.assertFalse(data['monthly_truncated'])


class DashboardClampTests(TestCase):
    """The default window ends on the LAST day of the FY, i.e. in the future.
    Balances and P&L totals must still stop at today, or the Receivables card
    reports money nobody owes yet and the KPIs count months the chart cannot
    draw."""

    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        self.today = date.today()
        recv, sales = self.coa['1130'], self.coa['4100']
        # Yesterday: a real credit sale. Post-dated: an invoice that has not
        # happened yet (a dated cheque, a scheduled bill).
        make_journal_entry(d=self.today - timedelta(days=1), lines=[
            (recv, Decimal('600'), Decimal('0')), (sales, Decimal('0'), Decimal('600'))])
        make_journal_entry(d=self.today + timedelta(days=20), lines=[
            (recv, Decimal('900'), Decimal('0')), (sales, Decimal('0'), Decimal('900'))])

    def _get(self, **params):
        request = self.factory.get('/api/accounts/dashboard/', params)
        force_authenticate(request, user=self.admin)
        return DashboardView.as_view()(request).data

    def test_future_window_reports_balances_as_of_today(self):
        data = self._get(start_date=str(self.today - timedelta(days=365)),
                         end_date=str(self.today + timedelta(days=365)))
        self.assertEqual(data['balances_as_of'], str(self.today))
        self.assertEqual(data['total_receivables'], 600.0)
        self.assertEqual(data['total_revenue'], 600.0)
        # The window the user asked for is still echoed back untouched.
        self.assertEqual(data['range_end'], str(self.today + timedelta(days=365)))

    def test_past_window_keeps_its_own_end_date(self):
        end = self.today - timedelta(days=2)
        data = self._get(start_date=str(self.today - timedelta(days=365)),
                         end_date=str(end))
        self.assertEqual(data['balances_as_of'], str(end))
        self.assertEqual(data['total_receivables'], 0.0)

    def test_wholly_future_window_is_empty(self):
        # Starts in a later month than the one we are in, so not even a
        # partial current-month bucket belongs on the chart.
        data = self._get(start_date=str(self.today + timedelta(days=40)),
                         end_date=str(self.today + timedelta(days=70)))
        self.assertEqual(data['total_revenue'], 0.0)
        self.assertEqual(data['monthly_data'], [])
        self.assertFalse(data['monthly_truncated'])

    def test_long_range_flags_the_truncated_chart(self):
        start = date(self.today.year - 6, self.today.month, 1)
        data = self._get(start_date=str(start), end_date=str(self.today))
        self.assertEqual(data['monthly_months_total'], 73)
        self.assertTrue(data['monthly_truncated'])
        # The cap still holds — the flag is what tells the UI it is partial.
        self.assertEqual(len(data['monthly_data']), 36)

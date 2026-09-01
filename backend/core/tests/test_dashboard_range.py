"""Dashboard window: defaults to the current FY, but any custom
?start_date/?end_date range must drive the totals and the monthly chart —
and nothing may be reported past today, however far the window runs."""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.models import ChartOfAccount
from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from core.views import DashboardView
from core.year_end import close_fiscal_year
from reports.views import BalanceSheetView


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


class DashboardCashBankTests(TestCase):
    """The Cash/Bank cards are as-of BALANCES, not flows through the window.

    They must read cumulatively from inception to min(range_end, today), the
    way Receivables and Payables already do — a window opened yesterday still
    has to show the money banked last year, and a window running into the
    future must not count a post-dated deposit as cash on hand.
    """

    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        self.today = date.today()
        cash, bank, sales = self.coa['1110'], self.coa['1120'], self.coa['4100']
        # Long before any window below: a 1000 cash sale.
        make_journal_entry(d=self.today - timedelta(days=400), lines=[
            (cash, Decimal('1000'), Decimal('0')), (sales, Decimal('0'), Decimal('1000'))])
        # Yesterday: 250 of it deposited — moves between the two cards, and
        # nets to zero on the P&L, so neither is a rounding of the other.
        make_journal_entry(d=self.today - timedelta(days=1), lines=[
            (bank, Decimal('250'), Decimal('0')), (cash, Decimal('0'), Decimal('250'))])
        # Post-dated cheque credit — banked on paper, not in the bank yet.
        make_journal_entry(d=self.today + timedelta(days=10), lines=[
            (bank, Decimal('900'), Decimal('0')), (sales, Decimal('0'), Decimal('900'))])

    def _get(self, **params):
        request = self.factory.get('/api/accounts/dashboard/', params)
        force_authenticate(request, user=self.admin)
        return DashboardView.as_view()(request).data

    def test_balances_ignore_the_window_start(self):
        data = self._get(start_date=str(self.today - timedelta(days=1)),
                         end_date=str(self.today))
        self.assertEqual(data['cash_balance'], 750.0)
        self.assertEqual(data['bank_balance'], 250.0)
        # The P&L half of the same payload still honours the window — nothing
        # was sold inside it — which is what makes these two genuinely as-of.
        self.assertEqual(data['total_revenue'], 0.0)

    def test_post_dated_deposit_is_not_counted(self):
        data = self._get(start_date=str(self.today - timedelta(days=500)),
                         end_date=str(self.today + timedelta(days=365)))
        self.assertEqual(data['balances_as_of'], str(self.today))
        self.assertEqual(data['bank_balance'], 250.0)

    def test_past_window_states_the_balance_at_its_end_date(self):
        end = self.today - timedelta(days=2)
        data = self._get(start_date=str(self.today - timedelta(days=500)),
                         end_date=str(end))
        # The deposit happened after that date, so it is all still in cash.
        self.assertEqual(data['cash_balance'], 1000.0)
        self.assertEqual(data['bank_balance'], 0.0)

    def test_overdrawn_bank_is_reported_negative(self):
        make_journal_entry(d=self.today, lines=[
            (self.coa['5410'], Decimal('700'), Decimal('0')),
            (self.coa['1120'], Decimal('0'), Decimal('700'))])
        data = self._get(start_date=str(self.today - timedelta(days=500)),
                         end_date=str(self.today))
        # An overdraft is real money owed, not a floor at zero.
        self.assertEqual(data['bank_balance'], -450.0)


class DashboardCashBankScopingTests(TestCase):
    """Per-store CoA cloning gives every branch its own subtype-Cash leaf, so
    the cards are scoped by the ENTRY's location — a branch must never see the
    next branch's till in its own Cash card."""

    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        sales = self.coa['4100']

        def clone(template, code, location_id):
            return ChartOfAccount.objects.create(
                account_code=code, account_name=code,
                account_type=template.account_type,
                account_subtype=template.account_subtype,
                location_id=location_id, is_leaf=True, is_active=True,
            )

        cash_a = clone(self.coa['1110'], '1110-AAA', 1)
        cash_b = clone(self.coa['1110'], '1110-BBB', 2)
        bank_b = clone(self.coa['1120'], '1120-BBB', 2)
        make_journal_entry(d=date(2026, 4, 10), location_id=1, lines=[
            (cash_a, Decimal('600'), Decimal('0')), (sales, Decimal('0'), Decimal('600'))])
        make_journal_entry(d=date(2026, 4, 11), location_id=2, lines=[
            (cash_b, Decimal('777'), Decimal('0')), (sales, Decimal('0'), Decimal('777'))])
        make_journal_entry(d=date(2026, 4, 12), location_id=2, lines=[
            (bank_b, Decimal('333'), Decimal('0')), (sales, Decimal('0'), Decimal('333'))])

    def _get(self, location_id=None):
        kw = {} if location_id is None else {'HTTP_X_LOCATION_ID': str(location_id)}
        request = self.factory.get('/api/accounts/dashboard/', {
            'start_date': '2026-04-01', 'end_date': '2026-04-30',
        }, **kw)
        force_authenticate(request, user=self.admin)
        if location_id is None:
            return DashboardView.as_view()(request).data
        with mock.patch('core.mixins.resolve_active_location',
                        lambda r: SimpleNamespace(id=int(location_id))):
            return DashboardView.as_view()(request).data

    def test_store_sees_only_its_own_till(self):
        data = self._get(location_id=1)
        self.assertEqual(data['cash_balance'], 600.0)
        self.assertEqual(data['bank_balance'], 0.0)

    def test_other_store_sees_its_own(self):
        data = self._get(location_id=2)
        self.assertEqual(data['cash_balance'], 777.0)
        self.assertEqual(data['bank_balance'], 333.0)

    def test_admin_without_a_header_sees_every_store(self):
        data = self._get()
        self.assertEqual(data['cash_balance'], 1377.0)
        self.assertEqual(data['bank_balance'], 333.0)


class DashboardTotalAssetsTests(TestCase):
    """Total assets is the Balance Sheet's asset total, not a period flow —
    every ASSET account, debit-positive, cumulative to `as_of`."""

    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        cash, bank, recv = self.coa['1110'], self.coa['1120'], self.coa['1130']
        sales, payables = self.coa['4100'], self.coa['2110']
        # Credit sale 1000, of which 600 is collected into the bank; a 100
        # cash sale; and 250 of stock bought on credit — the payable must not
        # net against assets.
        make_journal_entry(d=date(2026, 4, 10), lines=[
            (recv, Decimal('1000'), Decimal('0')), (sales, Decimal('0'), Decimal('1000'))])
        make_journal_entry(d=date(2026, 4, 12), lines=[
            (bank, Decimal('600'), Decimal('0')), (recv, Decimal('0'), Decimal('600'))])
        make_journal_entry(d=date(2026, 4, 15), lines=[
            (cash, Decimal('100'), Decimal('0')), (sales, Decimal('0'), Decimal('100'))])
        make_journal_entry(d=date(2026, 4, 18), lines=[
            (self.coa['1190'], Decimal('250'), Decimal('0')),
            (payables, Decimal('0'), Decimal('250'))])

    def _get(self, **params):
        request = self.factory.get('/api/accounts/dashboard/', params)
        force_authenticate(request, user=self.admin)
        return DashboardView.as_view()(request).data

    def _balance_sheet(self, as_of):
        request = self.factory.get('/api/reports/balance-sheet/', {'date': as_of})
        force_authenticate(request, user=self.admin)
        return BalanceSheetView.as_view()(request).data

    def test_sums_every_asset_account(self):
        data = self._get(start_date='2026-04-01', end_date='2026-04-30')
        # Receivable 400 + bank 600 + cash 100 + closing stock 250.
        self.assertEqual(data['total_assets'], 1350.0)
        # Liabilities stay out of it — the 250 payable is reported separately.
        self.assertEqual(data['total_payables'], 250.0)

    def test_ties_to_the_balance_sheet(self):
        data = self._get(start_date='2026-04-01', end_date='2026-04-30')
        bs = self._balance_sheet('2026-04-30')
        self.assertEqual(Decimal(bs['assets']['total']),
                         Decimal(str(data['total_assets'])))

    def test_ignores_the_window_start_but_not_its_end(self):
        # Opened after every posting above: still the full as-of balance.
        late = self._get(start_date='2026-04-20', end_date='2026-04-30')
        self.assertEqual(late['total_assets'], 1350.0)
        # Cut off before the cash sale and the stock purchase.
        early = self._get(start_date='2026-04-01', end_date='2026-04-13')
        self.assertEqual(early['total_assets'], 1000.0)

    def test_contra_assets_are_netted_not_added(self):
        """A credit balance on an ASSET account (accumulated depreciation) has
        to reduce the total — summing |balances| would inflate it."""
        accum = ChartOfAccount.objects.create(
            account_code='1285', account_name='Accumulated Depreciation',
            account_type='ASSET', is_leaf=True, is_active=True,
        )
        make_journal_entry(d=date(2026, 4, 20), lines=[
            (self.coa['5410'], Decimal('150'), Decimal('0')),
            (accum, Decimal('0'), Decimal('150'))])
        data = self._get(start_date='2026-04-01', end_date='2026-04-30')
        self.assertEqual(data['total_assets'], 1200.0)
        self.assertEqual(Decimal(self._balance_sheet('2026-04-30')['assets']['total']),
                         Decimal(str(data['total_assets'])))


class DashboardCarryForwardTests(TestCase):
    """The year-end opening JV restates every Asset/Liability/Equity balance
    the continuous ledger already carries. BalanceSheetView excludes it (see
    test_year_end_balance_sheet); the dashboard's as-of cards read the same
    cumulative basis, so they have to exclude it too — otherwise every one of
    them doubles the day an FY is closed."""

    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        # FY 2025-26: 100000 cash sale, 40000 rent paid in cash → cash 60000.
        make_journal_entry(d=date(2025, 6, 15), lines=[
            (self.coa['1110'], Decimal('100000'), Decimal('0')),
            (self.coa['4100'], Decimal('0'), Decimal('100000'))])
        make_journal_entry(d=date(2025, 7, 10), lines=[
            (self.coa['5410'], Decimal('40000'), Decimal('0')),
            (self.coa['1110'], Decimal('0'), Decimal('40000'))])
        # A receivable that survives the close, so the restatement covers more
        # than one card.
        make_journal_entry(d=date(2025, 8, 1), lines=[
            (self.coa['1130'], Decimal('5000'), Decimal('0')),
            (self.coa['4100'], Decimal('0'), Decimal('5000'))])
        close_fiscal_year(2025, location_id=1, generate_opening=True)

    def _get(self, **params):
        request = self.factory.get('/api/accounts/dashboard/', params)
        force_authenticate(request, user=self.admin)
        return DashboardView.as_view()(request).data

    def test_balances_are_not_doubled_by_the_opening_jv(self):
        data = self._get(start_date='2026-04-01', end_date='2026-06-30')
        self.assertEqual(data['cash_balance'], 60000.0)
        self.assertEqual(data['total_receivables'], 5000.0)
        self.assertEqual(data['total_assets'], 65000.0)

    def test_matches_the_balance_sheet_after_the_close(self):
        data = self._get(start_date='2026-04-01', end_date='2026-06-30')
        request = self.factory.get('/api/reports/balance-sheet/', {'date': '2026-06-30'})
        force_authenticate(request, user=self.admin)
        bs = BalanceSheetView.as_view()(request).data
        self.assertEqual(Decimal(bs['assets']['total']),
                         Decimal(str(data['total_assets'])))
        self.assertTrue(bs['is_balanced'])

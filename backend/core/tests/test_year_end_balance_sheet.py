"""Regression test for CRITICAL C3: the year-end opening carry-forward JV
double-counted every Asset/Liability/Equity on the cumulative Balance Sheet.

The opening JV restates balances the continuous ledger already carries to the
report date; the Balance Sheet summed BOTH, so e.g. true Cash ₹60,000 reported
₹120,000 (and stayed 'balanced' because the double was symmetric). The fix marks
the opening JV reference_type='OpeningCarryForward' and excludes it from the
cumulative Balance Sheet, while the windowed Trial Balance still uses it.
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.models import ChartOfAccount
from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from core.year_end import close_fiscal_year
from reports.views import BalanceSheetView, TrialBalanceView


class BalanceSheetCarryForwardTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _book(self, dr_code, cr_code, amount, on):
        make_journal_entry(d=on, lines=[
            (self.coa[dr_code], amount, Decimal('0.00')),
            (self.coa[cr_code], Decimal('0.00'), amount),
        ])

    def _balance_sheet(self, as_of):
        request = self.factory.get('/api/reports/balance-sheet/', {'date': as_of})
        force_authenticate(request, self.admin)
        return BalanceSheetView.as_view()(request)

    def test_balance_sheet_not_doubled_after_close_with_opening(self):
        # FY 2025-26: cash +100000 (sales), cash -40000 (rent) → cash 60000.
        self._book('1110', '4100', Decimal('100000'), date(2025, 6, 15))
        self._book('5410', '1110', Decimal('40000'), date(2025, 7, 10))

        close_fiscal_year(2025, generate_opening=True)  # posts the opening JV

        resp = self._balance_sheet('2026-06-01')
        assets = {i['account_code']: Decimal(i['balance']) for i in resp.data['assets']['items']}

        self.assertEqual(assets.get('1110'), Decimal('60000.00'),
                         'cash must not be doubled by the opening carry-forward JV')
        self.assertTrue(resp.data['is_balanced'])

    def test_trial_balance_still_uses_opening_jv_as_brought_forward(self):
        # The windowed TB for the NEW year must still see opening balances —
        # the opening JV is its brought-forward, so it is NOT excluded there.
        self._book('1110', '4100', Decimal('100000'), date(2025, 6, 15))
        self._book('5410', '1110', Decimal('40000'), date(2025, 7, 10))
        close_fiscal_year(2025, generate_opening=True)

        request = self.factory.get(
            '/api/reports/trial-balance/',
            {'start_date': '2026-04-01', 'end_date': '2027-03-31'},
        )
        force_authenticate(request, self.admin)
        resp = TrialBalanceView.as_view()(request)
        rows = {r['account_code']: Decimal(r['balance']) for r in resp.data['rows']}

        # Cash brought forward into the new FY window via the opening JV.
        self.assertEqual(rows.get('1110'), Decimal('60000.00'))
        self.assertEqual(resp.data['total_debit'], resp.data['total_credit'])

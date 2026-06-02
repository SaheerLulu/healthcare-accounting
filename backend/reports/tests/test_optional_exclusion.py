"""Regression test for M26: optional / memorandum vouchers must NOT affect the
financial statements (they're tracked outside the books, like Tally), matching
ChartOfAccount.get_balance() which already excludes them.
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from reports.views import TrialBalanceView


class OptionalVoucherExclusionTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _tb(self):
        request = self.factory.get('/api/reports/trial-balance/', {
            'start_date': '2026-04-01', 'end_date': '2026-04-30',
        })
        force_authenticate(request, self.admin)
        resp = TrialBalanceView.as_view()(request)
        return {r['account_code']: r for r in resp.data['rows']}, resp.data

    def test_optional_voucher_excluded_from_trial_balance(self):
        cash, sales = self.coa['1110'], self.coa['4100']
        make_journal_entry(d=date(2026, 4, 5), lines=[
            (cash, Decimal('1000'), Decimal('0')),
            (sales, Decimal('0'), Decimal('1000'))])
        # Optional voucher — must not move any balance.
        make_journal_entry(d=date(2026, 4, 6), lines=[
            (cash, Decimal('5000'), Decimal('0')),
            (sales, Decimal('0'), Decimal('5000'))], is_optional=True)

        rows, data = self._tb()
        self.assertEqual(Decimal(rows['4100']['credit']), Decimal('1000.00'))
        self.assertEqual(Decimal(rows['1110']['debit']), Decimal('1000.00'))
        self.assertEqual(data['total_debit'], data['total_credit'])

    def test_memorandum_voucher_excluded_from_trial_balance(self):
        cash, sales = self.coa['1110'], self.coa['4100']
        make_journal_entry(d=date(2026, 4, 5), lines=[
            (cash, Decimal('1000'), Decimal('0')),
            (sales, Decimal('0'), Decimal('1000'))])
        make_journal_entry(d=date(2026, 4, 6), lines=[
            (cash, Decimal('7000'), Decimal('0')),
            (sales, Decimal('0'), Decimal('7000'))], is_memorandum=True)

        rows, _ = self._tb()
        self.assertEqual(Decimal(rows['1110']['debit']), Decimal('1000.00'))

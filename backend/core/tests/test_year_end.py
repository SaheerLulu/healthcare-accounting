"""Tests for year-end close service."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.models import AccountingSettings, ChartOfAccount
from core.tests.utils import (
    make_journal_entry, make_settings, seed_chart_and_mappings,
)
from core.year_end import close_fiscal_year, fy_label, fy_window


class FYHelperTests(TestCase):
    def test_fy_label_format(self):
        self.assertEqual(fy_label(2025), '2025-26')
        self.assertEqual(fy_label(2099), '2099-00')

    def test_fy_window_april(self):
        start, end = fy_window(2025, 4)
        self.assertEqual(start, date(2025, 4, 1))
        self.assertEqual(end, date(2026, 3, 31))


class CloseFiscalYearTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()

    def _book_revenue(self, amount: Decimal, on=date(2025, 6, 15)):
        cash = self.coa['1110']
        sales = self.coa['4100']
        make_journal_entry(d=on, lines=[
            (cash, amount, Decimal('0.00')),
            (sales, Decimal('0.00'), amount),
        ])

    def _book_expense(self, amount: Decimal, on=date(2025, 7, 10)):
        cash = self.coa['1110']
        rent = self.coa['5410']
        make_journal_entry(d=on, lines=[
            (rent, amount, Decimal('0.00')),
            (cash, Decimal('0.00'), amount),
        ])

    def test_close_with_profit(self):
        self._book_revenue(Decimal('100000'))
        self._book_expense(Decimal('40000'))

        result = close_fiscal_year(2025, generate_opening=False)
        self.assertEqual(result['fy'], '2025-26')
        self.assertEqual(result['net_profit'], '60000.00')

        # P&L accounts should now have zero balance
        sales = ChartOfAccount.objects.get(account_code='4100')
        rent = ChartOfAccount.objects.get(account_code='5410')
        self.assertEqual(sales.get_balance(end_date=date(2026, 3, 31)), 0)
        self.assertEqual(rent.get_balance(end_date=date(2026, 3, 31)), 0)

        # Retained Earnings should hold the net profit (credit balance)
        re = ChartOfAccount.objects.get(account_code='3200')
        self.assertEqual(re.get_balance(end_date=date(2026, 3, 31)),
                         Decimal('-60000.00'))  # credit-positive shows as negative

        # FY locked
        s = AccountingSettings.get_settings()
        self.assertTrue(s.is_fy_closed)
        self.assertEqual(s.last_closed_fy, '2025-26')

    def test_close_with_loss(self):
        self._book_revenue(Decimal('20000'))
        self._book_expense(Decimal('50000'))

        result = close_fiscal_year(2025, generate_opening=False)
        self.assertEqual(result['net_profit'], '-30000.00')

    def test_close_twice_raises(self):
        self._book_revenue(Decimal('100'))
        self._book_expense(Decimal('40'))
        close_fiscal_year(2025, generate_opening=False)
        with self.assertRaises(ValueError):
            close_fiscal_year(2025, generate_opening=False)

    def test_close_no_pl_activity_raises(self):
        with self.assertRaises(ValueError):
            close_fiscal_year(2025, generate_opening=False)

    def test_opening_balances_generated(self):
        self._book_revenue(Decimal('100000'))
        self._book_expense(Decimal('40000'))
        # also book some BS-side activity (cash already has balance from above)
        result = close_fiscal_year(2025, generate_opening=True)
        self.assertIsNotNone(result['opening_entry_no'])

        # Opening JV should be dated in the new FY
        from journals.models import JournalEntry
        opening = JournalEntry.objects.get(entry_no=result['opening_entry_no'])
        self.assertEqual(opening.date, date(2026, 4, 1))

"""Tests for the period-end closing-stock JV — proves the equation balances."""
from datetime import date
from decimal import Decimal

from django.db.models import Sum
from django.test import TestCase

from core.models import AccountMapping, ChartOfAccount
from core.tests.utils import (
    make_journal_entry, make_settings, seed_chart_and_mappings,
)
from journals.models import JournalEntry, JournalEntryLine
from journals.services import JournalAutoGenerationService


def _seed_closing_stock_account():
    cs, _ = ChartOfAccount.objects.get_or_create(
        account_code='1190',
        defaults=dict(account_name='Closing Stock', account_type='ASSET',
                      account_subtype='Cash', is_leaf=True),
    )
    AccountMapping.objects.update_or_create(
        key='CLOSING_STOCK', defaults={'account': cs},
    )


class ClosingStockJVTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        _seed_closing_stock_account()
        self.svc = JournalAutoGenerationService()
        self.purchases = ChartOfAccount.objects.get(account_code='5100')
        self.closing = ChartOfAccount.objects.get(account_code='1190')
        self.payables = ChartOfAccount.objects.get(account_code='2110')
        self.cash = ChartOfAccount.objects.get(account_code='1110')
        self.sales = ChartOfAccount.objects.get(account_code='4100')

        # Book a year of business: ₹10L purchases + ₹12L sales
        make_journal_entry(d=date(2025, 6, 1), lines=[
            (self.purchases, Decimal('1000000'), Decimal('0')),
            (self.payables, Decimal('0'), Decimal('1000000')),
        ])
        make_journal_entry(d=date(2025, 7, 1), lines=[
            (self.cash, Decimal('1200000'), Decimal('0')),
            (self.sales, Decimal('0'), Decimal('1200000')),
        ])

    def test_balance_sheet_wrong_before_closing_stock_jv(self):
        # Before the closing-stock JV: Closing Stock = 0
        cs_bal = self.closing.get_balance(end_date=date(2026, 3, 31))
        self.assertEqual(cs_bal, Decimal('0'))
        # Net P/L = sales - purchases = 200000 (under-reported)
        purchases_bal = self.purchases.get_balance(end_date=date(2026, 3, 31))
        sales_bal = self.sales.get_balance(end_date=date(2026, 3, 31))
        self.assertEqual(purchases_bal, Decimal('1000000'))
        self.assertEqual(sales_bal, Decimal('-1200000'))  # credit balance

    def test_closing_stock_jv_corrects_balance_sheet(self):
        # Physical count: ₹2,00,000 of stock left on shelves
        je = self.svc.post_closing_stock_adjustment(
            date=date(2026, 3, 31), value=Decimal('200000'),
        )
        self.assertIsNotNone(je)
        # Closing Stock now ₹2L (asset)
        cs_bal = self.closing.get_balance(end_date=date(2026, 3, 31))
        self.assertEqual(cs_bal, Decimal('200000'))
        # Purchases reduced by ₹2L → effective expense ₹8L
        purchases_bal = self.purchases.get_balance(end_date=date(2026, 3, 31))
        self.assertEqual(purchases_bal, Decimal('800000'))

    def test_accounting_equation_balances(self):
        """Assets = Liabilities + Equity must hold after the JV.

        Cash ₹12L + Closing Stock ₹2L = ₹14L Assets
        Payables ₹10L Liabilities + Net Profit ₹4L Equity = ₹14L
        """
        self.svc.post_closing_stock_adjustment(
            date=date(2026, 3, 31), value=Decimal('200000'),
        )
        # Sum debits and credits across all posted lines
        agg = JournalEntryLine.objects.filter(
            entry__is_posted=True,
        ).aggregate(d=Sum('debit'), c=Sum('credit'))
        self.assertEqual(agg['d'], agg['c'])  # books always balance

        # Assets side
        cash = self.cash.get_balance(end_date=date(2026, 3, 31))
        cs = self.closing.get_balance(end_date=date(2026, 3, 31))
        total_assets = cash + cs
        # Liabilities side (payables — credit balance shows as negative)
        payables = -self.payables.get_balance(end_date=date(2026, 3, 31))
        # Equity side: net profit = -sales + purchases (with sign flip)
        sales_bal = -self.sales.get_balance(end_date=date(2026, 3, 31))
        purch_bal = self.purchases.get_balance(end_date=date(2026, 3, 31))
        net_profit = sales_bal - purch_bal
        # Cash 1.2M + Stock 0.2M = 1.4M; Payables 1M + Profit 0.4M = 1.4M
        self.assertEqual(total_assets, Decimal('1400000'))
        self.assertEqual(payables + net_profit, Decimal('1400000'))

    def test_idempotent_when_target_unchanged(self):
        self.svc.post_closing_stock_adjustment(
            date=date(2026, 3, 31), value=Decimal('200000'),
        )
        # Re-running with the same target — no JV
        result = self.svc.post_closing_stock_adjustment(
            date=date(2026, 3, 31), value=Decimal('200000'),
        )
        self.assertIsNone(result)

    def test_negative_target_rejected(self):
        with self.assertRaises(ValueError):
            self.svc.post_closing_stock_adjustment(
                date=date(2026, 3, 31), value=Decimal('-100'),
            )

    def test_decreasing_target_reverses(self):
        self.svc.post_closing_stock_adjustment(
            date=date(2026, 3, 31), value=Decimal('200000'),
        )
        # Now lower the target — should post a reverse-direction JV
        self.svc.post_closing_stock_adjustment(
            date=date(2026, 3, 31), value=Decimal('150000'),
        )
        cs_bal = self.closing.get_balance(end_date=date(2026, 3, 31))
        self.assertEqual(cs_bal, Decimal('150000'))


class CloseFiscalYearWithStockTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        _seed_closing_stock_account()
        # Same setup as above
        cash = ChartOfAccount.objects.get(account_code='1110')
        sales = ChartOfAccount.objects.get(account_code='4100')
        purchases = ChartOfAccount.objects.get(account_code='5100')
        payables = ChartOfAccount.objects.get(account_code='2110')
        make_journal_entry(d=date(2025, 6, 1), lines=[
            (purchases, Decimal('1000000'), Decimal('0')),
            (payables, Decimal('0'), Decimal('1000000')),
        ])
        make_journal_entry(d=date(2025, 7, 1), lines=[
            (cash, Decimal('1200000'), Decimal('0')),
            (sales, Decimal('0'), Decimal('1200000')),
        ])

    def test_close_fy_with_closing_stock_value(self):
        from core.year_end import close_fiscal_year
        result = close_fiscal_year(
            2025, generate_opening=False,
            closing_stock_value=Decimal('200000'),
        )
        # Net profit should reflect the closing-stock adjustment: 1.2M - (1M - 0.2M) = 0.4M
        self.assertEqual(result['net_profit'], '400000.00')
        self.assertIsNotNone(result['closing_stock_entry_no'])

    def test_close_fy_without_closing_stock_value(self):
        from core.year_end import close_fiscal_year
        # Without the value, profit is the under-reported 200K
        result = close_fiscal_year(2025, generate_opening=False)
        self.assertEqual(result['net_profit'], '200000.00')
        self.assertIsNone(result['closing_stock_entry_no'])

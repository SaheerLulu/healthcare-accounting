"""Tests for Budget vs Actual variance computation."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from budgets.models import Budget
from budgets.services import variance_report
from core.models import ChartOfAccount
from core.tests.utils import (
    make_journal_entry, make_settings, seed_chart_and_mappings,
)


class BudgetVarianceTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.rent = ChartOfAccount.objects.get(account_code='5410')
        self.cash = ChartOfAccount.objects.get(account_code='1110')

        # Budget rent at ₹20,000 for April 2026
        Budget.objects.create(
            period='2026-04', period_kind='monthly',
            account=self.rent, amount=Decimal('20000'),
        )
        # Actual rent JE for ₹25,000
        make_journal_entry(d=date(2026, 4, 5), lines=[
            (self.rent, Decimal('25000'), Decimal('0')),
            (self.cash, Decimal('0'), Decimal('25000')),
        ])

    def test_variance_calculation(self):
        result = variance_report(period='2026-04', period_kind='monthly')
        rent_row = next(r for r in result['rows'] if r['account_code'] == '5410')
        self.assertEqual(rent_row['budget'], '20000.00')
        self.assertEqual(rent_row['actual'], '25000.00')
        self.assertEqual(rent_row['variance'], '5000.00')
        self.assertEqual(rent_row['status'], 'over')

    def test_no_actual_means_under_budget(self):
        # Add a budget for an account with no activity
        utility = ChartOfAccount.objects.get(account_code='5420')
        Budget.objects.create(period='2026-04', period_kind='monthly',
                              account=utility, amount=Decimal('5000'))
        result = variance_report(period='2026-04', period_kind='monthly')
        utility_row = next(r for r in result['rows'] if r['account_code'] == '5420')
        self.assertEqual(utility_row['actual'], '0.00')
        self.assertEqual(utility_row['status'], 'under')


class RevenueBudgetStatusTests(TestCase):
    """M22 — revenue budgets used to always read 'on_track'."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.sales = ChartOfAccount.objects.get(account_code='4100')
        self.cash = ChartOfAccount.objects.get(account_code='1110')
        Budget.objects.create(
            period='2026-04', period_kind='monthly',
            account=self.sales, amount=Decimal('50000'),
        )

    def _row(self):
        result = variance_report(period='2026-04', period_kind='monthly')
        return next(r for r in result['rows'] if r['account_code'] == '4100')

    def test_revenue_shortfall_is_under(self):
        make_journal_entry(d=date(2026, 4, 10), lines=[
            (self.cash, Decimal('30000'), Decimal('0')),
            (self.sales, Decimal('0'), Decimal('30000')),
        ])
        row = self._row()
        self.assertEqual(row['actual'], '30000.00')
        self.assertEqual(row['status'], 'under')

    def test_revenue_over_collection_is_on_track(self):
        make_journal_entry(d=date(2026, 4, 10), lines=[
            (self.cash, Decimal('60000'), Decimal('0')),
            (self.sales, Decimal('0'), Decimal('60000')),
        ])
        self.assertEqual(self._row()['status'], 'on_track')

    def test_asset_budget_stays_on_track(self):
        bank = ChartOfAccount.objects.get(account_code='1120')
        Budget.objects.create(period='2026-04', period_kind='monthly',
                              account=bank, amount=Decimal('1000'))
        result = variance_report(period='2026-04', period_kind='monthly')
        row = next(r for r in result['rows'] if r['account_code'] == '1120')
        self.assertEqual(row['status'], 'on_track')


class BudgetPeriodFormatTests(TestCase):
    """L8 — period label must match period_kind or the variance report
    crashes when it later parses the label."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.rent = ChartOfAccount.objects.get(account_code='5410')

    def _ser(self, period, period_kind):
        from budgets.serializers import BudgetSerializer
        return BudgetSerializer(data={
            'period': period, 'period_kind': period_kind,
            'account': self.rent.id, 'amount': '1000.00',
            'cost_center': '',
        })

    def test_valid_formats_accepted(self):
        for period, kind in [('2026-04', 'monthly'), ('2026-Q1', 'quarterly'),
                             ('2026', 'annual'), ('2026-27', 'annual')]:
            ser = self._ser(period, kind)
            self.assertTrue(ser.is_valid(), (period, kind, ser.errors))

    def test_mismatched_formats_rejected(self):
        for period, kind in [('2026', 'monthly'), ('2026-13', 'monthly'),
                             ('2026-04', 'quarterly'), ('2026-Q5', 'quarterly'),
                             ('Q1-2026', 'quarterly'), ('2026-Q1', 'annual'),
                             ('2026-28', 'annual')]:
            ser = self._ser(period, kind)
            self.assertFalse(ser.is_valid(), (period, kind))
            self.assertIn('period', ser.errors)


class BudgetUniqueConstraintTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.rent = ChartOfAccount.objects.get(account_code='5410')

    def test_duplicate_blocked(self):
        from django.db import IntegrityError
        Budget.objects.create(
            period='2026-04', period_kind='monthly',
            account=self.rent, amount=Decimal('1000'),
            location_id=1,
        )
        with self.assertRaises(IntegrityError):
            Budget.objects.create(
                period='2026-04', period_kind='monthly',
                account=self.rent, amount=Decimal('2000'),
                location_id=1,
            )

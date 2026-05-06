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

"""Tests for petty cash spend / replenishment."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from banking.models import PettyCashFloat, PettyCashTransaction
from banking.services import (
    petty_cash_balance, post_petty_cash_spend, replenish_petty_cash,
)
from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings


class PettyCashTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.cash = ChartOfAccount.objects.get(account_code='1110')
        self.rent = ChartOfAccount.objects.get(account_code='5410')
        self.float = PettyCashFloat.objects.create(
            location_id=1, location_name='Main',
            chart_account=self.cash,
            imprest_amount=Decimal('5000'),
            replenishment_threshold=Decimal('1000'),
        )

    def test_replenish_increases_balance(self):
        replenish_petty_cash(float_obj=self.float, date=date(2026, 4, 1),
                             amount=Decimal('5000'))
        self.assertEqual(petty_cash_balance(self.float), Decimal('5000'))

    def test_replenish_zero_amount_rejected(self):
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            replenish_petty_cash(float_obj=self.float, date=date(2026, 4, 1),
                                 amount=Decimal('0'))

    def test_replenish_negative_amount_rejected(self):
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            replenish_petty_cash(float_obj=self.float, date=date(2026, 4, 1),
                                 amount=Decimal('-500'))

    def test_spend_decreases_balance(self):
        replenish_petty_cash(float_obj=self.float, date=date(2026, 4, 1),
                             amount=Decimal('5000'))
        post_petty_cash_spend(float_obj=self.float, date=date(2026, 4, 5),
                              amount=Decimal('500'),
                              expense_account=self.rent,
                              description='Office supplies')
        self.assertEqual(petty_cash_balance(self.float), Decimal('4500'))
        self.assertEqual(PettyCashTransaction.objects.count(), 2)

    def test_zero_amount_rejected(self):
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            post_petty_cash_spend(float_obj=self.float, date=date(2026, 4, 5),
                                  amount=Decimal('0'),
                                  expense_account=self.rent,
                                  description='zero')

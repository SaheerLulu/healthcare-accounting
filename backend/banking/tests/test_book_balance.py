"""M17 — book_balance must include opening_balance so it is symmetric with
statement_balance (which starts from it); otherwise the books-vs-statement
difference is permanently overstated by the opening amount."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from banking.models import BankAccount, BankTransaction
from banking.services import book_balance, statement_balance
from core.models import ChartOfAccount
from core.tests.utils import (
    make_journal_entry, make_settings, seed_chart_and_mappings,
)


class BookBalanceOpeningTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.bank_gl = ChartOfAccount.objects.get(account_code='1120')
        self.account = BankAccount.objects.create(
            name='HDFC', account_number='2', ifsc='HDFC0000002',
            chart_account=self.bank_gl, location_id=1,
            opening_balance=Decimal('50000.00'),
        )

    def test_book_balance_includes_opening(self):
        cash = ChartOfAccount.objects.get(account_code='1110')
        # Dr Bank 1000 / Cr Cash 1000 (posted)
        make_journal_entry(d=date(2026, 4, 2), lines=[
            (self.bank_gl, Decimal('1000.00'), Decimal('0.00')),
            (cash, Decimal('0.00'), Decimal('1000.00')),
        ])
        self.assertEqual(book_balance(self.account), Decimal('51000.00'))

    def test_book_and_statement_symmetric_with_no_activity(self):
        # No JEs, no imported transactions: both sides are just the opening.
        self.assertEqual(book_balance(self.account),
                         statement_balance(self.account))

    def test_statement_balance_unchanged(self):
        BankTransaction.objects.create(
            bank_account=self.account, date=date(2026, 4, 3),
            description='NEFT in', amount=Decimal('2500.00'),
        )
        self.assertEqual(statement_balance(self.account), Decimal('52500.00'))

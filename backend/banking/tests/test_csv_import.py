"""Tests for bank statement CSV import + matching (WP 643/644)."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from banking.models import BankAccount, BankTransaction
from banking.services import find_match_suggestions, import_csv, match_transaction
from core.models import ChartOfAccount
from core.tests.utils import (
    make_journal_entry, make_settings, seed_chart_and_mappings,
)


CSV_SAMPLE = b"""Date,Description,Withdrawal,Deposit,Balance,Reference
01-04-2026,Opening,,,100000.00,
05-04-2026,POS Sale,,15000.00,115000.00,UTR123456
07-04-2026,Vendor Payment,8000.00,,107000.00,UTR123457
"""


class CSVImportTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        bank_acct = ChartOfAccount.objects.get(account_code='1120')
        self.account = BankAccount.objects.create(
            name='HDFC Current', account_number='12345',
            ifsc='HDFC0000001', chart_account=bank_acct, location_id=1,
        )

    def test_import_creates_transactions(self):
        result = import_csv(self.account, CSV_SAMPLE)
        self.assertGreater(result['imported'], 0)
        self.assertEqual(BankTransaction.objects.count(), result['imported'])

    def test_dedupe_on_reimport(self):
        import_csv(self.account, CSV_SAMPLE)
        before = BankTransaction.objects.count()
        result = import_csv(self.account, CSV_SAMPLE)
        # Should detect duplicates
        self.assertEqual(BankTransaction.objects.count(), before)
        self.assertGreaterEqual(result.get('duplicates', 0), before)

    def test_match_transaction_links_to_je(self):
        # Make a JE for the deposit
        cash = ChartOfAccount.objects.get(account_code='1120')  # Bank GL
        sales = ChartOfAccount.objects.get(account_code='4100')
        je = make_journal_entry(d=date(2026, 4, 5), lines=[
            (cash, Decimal('15000'), Decimal('0')),
            (sales, Decimal('0'), Decimal('15000')),
        ])
        import_csv(self.account, CSV_SAMPLE)
        txn = BankTransaction.objects.filter(amount=Decimal('15000')).first()
        self.assertIsNotNone(txn)
        match_transaction(txn, je)
        txn.refresh_from_db()
        self.assertEqual(txn.matched_journal_entry_id, je.id)
        self.assertEqual(txn.status, 'matched')


class MatchSuggestionTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        bank_acct = ChartOfAccount.objects.get(account_code='1120')
        self.account = BankAccount.objects.create(
            name='HDFC', account_number='1', ifsc='HDFC0000001',
            chart_account=bank_acct, location_id=1,
        )
        # Three JEs at different dates with same amount
        bank = ChartOfAccount.objects.get(account_code='1120')
        sales = ChartOfAccount.objects.get(account_code='4100')
        for d_offset in (-2, 0, 4):
            make_journal_entry(d=date(2026, 4, 5 + d_offset), lines=[
                (bank, Decimal('15000'), Decimal('0')),
                (sales, Decimal('0'), Decimal('15000')),
            ])

    def test_suggestions_within_window(self):
        txn = BankTransaction.objects.create(
            bank_account=self.account, date=date(2026, 4, 5),
            description='deposit', amount=Decimal('15000'),
            reference='X1',
        )
        # ±3 days = covers d=4/3, 4/5, 4/7 — only 4/3 and 4/5 of our 3 JEs match
        suggestions = find_match_suggestions(txn, days_window=3)
        self.assertEqual(len(suggestions), 2)

"""Tests for the provision-for-doubtful-debts service."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from core.models import AccountMapping, ChartOfAccount
from core.tests.utils import (
    make_journal_entry, make_settings, seed_chart_and_mappings,
)
from journals.bad_debts import compute_required_provision, post_provision_adjustment


def _seed_bad_debt_accounts():
    for code, (name, atype, sub) in [
        ('5530', ('Bad Debts Expense', 'EXPENSE', 'Other_Expense')),
        ('1131', ('Provision for Doubtful Debts', 'ASSET', 'Receivable')),
    ]:
        ChartOfAccount.objects.get_or_create(
            account_code=code,
            defaults=dict(account_name=name, account_type=atype,
                          account_subtype=sub, is_leaf=True),
        )
    for key, code in [('BAD_DEBTS_EXPENSE', '5530'),
                      ('PROVISION_BAD_DEBTS', '1131')]:
        AccountMapping.objects.update_or_create(
            key=key, defaults={'account': ChartOfAccount.objects.get(account_code=code)},
        )


class BadDebtsTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        _seed_bad_debt_accounts()
        self.recv = ChartOfAccount.objects.get(account_code='1130')
        self.sales = ChartOfAccount.objects.get(account_code='4200')

    def _book_receivable(self, amount, customer_id, on):
        from journals.models import JournalEntryLine
        je = make_journal_entry(d=on, lines=[
            (self.recv, Decimal(str(amount)), Decimal('0')),
            (self.sales, Decimal('0'), Decimal(str(amount))),
        ])
        # Tag receivable line with party
        line = je.lines.filter(account=self.recv).first()
        line.party_type = 'Customer'
        line.party_id = customer_id
        line.save()

    def test_no_provision_when_all_under_90_days(self):
        self._book_receivable(10000, customer_id=1, on=date(2026, 5, 1))
        required, rows = compute_required_provision(as_of=date(2026, 5, 30))
        self.assertEqual(required, Decimal('0'))

    def test_25_pct_provision_for_91_180_days(self):
        # invoice on Jan 1, as_of May 1 → 120 days old → 25%
        self._book_receivable(10000, customer_id=2, on=date(2026, 1, 1))
        required, _ = compute_required_provision(as_of=date(2026, 5, 1))
        self.assertEqual(required, Decimal('2500.00'))

    def test_post_adjustment_creates_je(self):
        self._book_receivable(10000, customer_id=3, on=date(2026, 1, 1))
        result = post_provision_adjustment(as_of=date(2026, 5, 1), location_id=1)
        self.assertEqual(result['adjustment'], '2500.00')
        self.assertIsNotNone(result['journal_entry'])

    def test_no_je_when_no_change_needed(self):
        # First run sets provision
        self._book_receivable(10000, customer_id=4, on=date(2026, 1, 1))
        post_provision_adjustment(as_of=date(2026, 5, 1), location_id=1)
        # Second run on same date — no change
        result = post_provision_adjustment(as_of=date(2026, 5, 1), location_id=1)
        self.assertEqual(result['adjustment'], '0.00')
        self.assertIsNone(result['journal_entry'])

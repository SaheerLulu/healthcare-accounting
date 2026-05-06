"""Tests for cheque tracking + bounce flow."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from banking.models import BankAccount, Cheque
from banking.services import mark_cheque_bounced, mark_cheque_cleared
from core.models import ChartOfAccount
from core.tests.utils import (
    make_journal_entry, make_settings, seed_chart_and_mappings,
)


class ChequeLifecycleTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        bank_acct = ChartOfAccount.objects.get(account_code='1120')
        self.account = BankAccount.objects.create(
            name='HDFC', account_number='1', ifsc='HDFC0000001',
            chart_account=bank_acct, location_id=1,
        )

    def test_clear_pending_cheque(self):
        cheque = Cheque.objects.create(
            cheque_no='000123', kind='received', bank_account=self.account,
            cheque_date=date(2026, 4, 1), amount=Decimal('5000'),
            party_type='Customer', party_id=1, party_name='Acme',
        )
        mark_cheque_cleared(cheque)
        cheque.refresh_from_db()
        self.assertEqual(cheque.status, 'cleared')

    def test_clear_already_cleared_raises(self):
        cheque = Cheque.objects.create(
            cheque_no='000124', kind='received', bank_account=self.account,
            cheque_date=date(2026, 4, 1), amount=Decimal('5000'),
            status='cleared',
        )
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            mark_cheque_cleared(cheque)

    def test_bounce_reverses_original_je(self):
        # Create original receipt JE (Dr Bank, Cr Receivable)
        bank = ChartOfAccount.objects.get(account_code='1120')
        recv = ChartOfAccount.objects.get(account_code='1130')
        je = make_journal_entry(d=date(2026, 4, 1), lines=[
            (bank, Decimal('5000'), Decimal('0')),
            (recv, Decimal('0'), Decimal('5000')),
        ])
        cheque = Cheque.objects.create(
            cheque_no='000125', kind='received', bank_account=self.account,
            cheque_date=date(2026, 4, 1), amount=Decimal('5000'),
            journal_entry=je,
        )
        mark_cheque_bounced(cheque, reason='Insufficient funds')
        cheque.refresh_from_db()
        self.assertEqual(cheque.status, 'bounced')
        self.assertEqual(cheque.bounce_reason, 'Insufficient funds')
        self.assertIsNotNone(cheque.bounce_journal_entry)
        # Bounce JE swapped Dr/Cr of original
        bounce = cheque.bounce_journal_entry
        for orig_line, b_line in zip(je.lines.all(), bounce.lines.all()):
            self.assertEqual(orig_line.debit, b_line.credit)
            self.assertEqual(orig_line.credit, b_line.debit)

    def test_pdc_flag(self):
        cheque = Cheque.objects.create(
            cheque_no='000126', kind='received', bank_account=self.account,
            cheque_date=date(2026, 4, 1), amount=Decimal('5000'),
            expected_clear_date=date(2026, 5, 1),
        )
        self.assertTrue(cheque.is_pdc)

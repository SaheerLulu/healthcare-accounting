"""Regression tests for two banking integrity defects:

  H2 — a cheque could be bound (via the API) to an arbitrary unrelated posted JE
       and then 'bounced' to reverse books it had nothing to do with. The link
       is now read-only, and bounce refuses to reverse a JE that doesn't touch
       the cheque's own bank account.
  H3 — the same JE could be reconciled against two different bank transactions
       on the same account/side, double-counting the reconciliation.
"""
from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

import json

from rest_framework.test import APIRequestFactory, force_authenticate

from banking.models import BankAccount, BankTransaction, Cheque
from banking.serializers import ChequeSerializer
from banking.services import mark_cheque_bounced, match_transaction
from banking.views import BankTransactionViewSet
from core.models import ChartOfAccount
from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)


class ChequeBounceGuardTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.bank_gl = ChartOfAccount.objects.get(account_code='1120')
        self.account = BankAccount.objects.create(
            name='HDFC', account_number='1', ifsc='HDFC0000001',
            chart_account=self.bank_gl, location_id=1,
        )

    def test_journal_entry_and_bill_payment_are_read_only(self):
        fields = ChequeSerializer().fields
        self.assertTrue(fields['journal_entry'].read_only)
        self.assertTrue(fields['bill_payment'].read_only)

    def test_bounce_refuses_je_not_touching_cheque_bank(self):
        # JE touches Cash (1110) + Receivable (1130) — NOT this cheque's bank 1120.
        cash = ChartOfAccount.objects.get(account_code='1110')
        recv = ChartOfAccount.objects.get(account_code='1130')
        unrelated = make_journal_entry(d=date(2026, 4, 1), lines=[
            (cash, Decimal('5000'), Decimal('0')),
            (recv, Decimal('0'), Decimal('5000')),
        ])
        cheque = Cheque.objects.create(
            cheque_no='C-1', kind='received', bank_account=self.account,
            cheque_date=date(2026, 4, 1), amount=Decimal('5000'),
            journal_entry=unrelated,
        )
        with self.assertRaises(ValidationError):
            mark_cheque_bounced(cheque, reason='Insufficient funds')
        cheque.refresh_from_db()
        # Status not flipped, no reversal posted.
        self.assertIsNone(cheque.bounce_journal_entry)

    def test_bounce_allows_je_that_touches_bank(self):
        recv = ChartOfAccount.objects.get(account_code='1130')
        je = make_journal_entry(d=date(2026, 4, 1), lines=[
            (self.bank_gl, Decimal('5000'), Decimal('0')),
            (recv, Decimal('0'), Decimal('5000')),
        ])
        cheque = Cheque.objects.create(
            cheque_no='C-2', kind='received', bank_account=self.account,
            cheque_date=date(2026, 4, 1), amount=Decimal('5000'), journal_entry=je,
        )
        mark_cheque_bounced(cheque, reason='Stop payment')
        cheque.refresh_from_db()
        self.assertEqual(cheque.status, 'bounced')
        self.assertIsNotNone(cheque.bounce_journal_entry)


class DoubleMatchGuardTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.bank_gl = ChartOfAccount.objects.get(account_code='1120')
        self.account = BankAccount.objects.create(
            name='HDFC', account_number='1', ifsc='HDFC0000001',
            chart_account=self.bank_gl, location_id=1,
        )
        other = ChartOfAccount.objects.get(account_code='1130')
        # Outflow JE: Dr 1130 / Cr 1120 (bank) 5000.
        self.je = make_journal_entry(d=date(2026, 4, 1), lines=[
            (other, Decimal('5000'), Decimal('0')),
            (self.bank_gl, Decimal('0'), Decimal('5000')),
        ])

    def _txn(self, amount, desc):
        return BankTransaction.objects.create(
            bank_account=self.account, date=date(2026, 4, 1),
            amount=Decimal(amount), description=desc,
        )

    def test_same_je_cannot_match_two_same_side_transactions(self):
        # Distinct descriptions so the statement-dedupe constraint passes —
        # exactly the case the over-match guard must still catch.
        t1, t2 = self._txn('-5000', 'NEFT to vendor'), self._txn('-5000', 'cheque 12')
        match_transaction(t1, self.je)
        with self.assertRaises(ValidationError):
            match_transaction(t2, self.je)
        t1.refresh_from_db()
        t2.refresh_from_db()
        self.assertEqual(t1.status, 'matched')
        self.assertEqual(t2.status, 'unmatched')


class ReconciledEditGuardTests(TestCase):
    """M16: a matched transaction's amount/date/account are frozen until unmatched."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        gl = ChartOfAccount.objects.get(account_code='1120')
        self.account = BankAccount.objects.create(
            name='HDFC', account_number='1', ifsc='HDFC0000001',
            chart_account=gl, location_id=1)
        self.txn = BankTransaction.objects.create(
            bank_account=self.account, date=date(2026, 4, 1),
            amount=Decimal('5000'), description='matched line', status='matched')

    def _patch(self, payload):
        request = self.factory.patch(
            f'/api/banking/transactions/{self.txn.id}/',
            data=json.dumps(payload), content_type='application/json')
        force_authenticate(request, self.admin)
        return BankTransactionViewSet.as_view({'patch': 'partial_update'})(request, pk=self.txn.id)

    def test_amount_edit_on_matched_txn_rejected(self):
        resp = self._patch({'amount': '9999'})
        self.assertEqual(resp.status_code, 400)
        self.txn.refresh_from_db()
        self.assertEqual(self.txn.amount, Decimal('5000'))

    def test_noncritical_edit_on_matched_txn_allowed(self):
        resp = self._patch({'notes': 'cleared via NEFT'})
        self.assertIn(resp.status_code, (200, 202))
        self.txn.refresh_from_db()
        self.assertEqual(self.txn.amount, Decimal('5000'))

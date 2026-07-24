"""Regression tests for the banking design-conformance pass (2026-07).

Covers: excluded rows out of statement_balance, optional/memorandum vouchers
out of balances and reconciliation, cheque cancel lifecycle, store-isolation
on matching, and leaf/subtype guards on picked accounts.
"""
from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from banking.models import BankAccount, BankTransaction, Cheque, PettyCashFloat
from banking.services import (
    book_balance, categorize_transaction, find_match_suggestions,
    mark_cheque_cancelled, match_transaction, post_petty_cash_spend,
    statement_balance,
)
from core.models import ChartOfAccount
from core.tests.utils import (
    make_journal_entry, make_settings, seed_chart_and_mappings,
)


class BalanceExclusionTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.bank_gl = ChartOfAccount.objects.get(account_code='1120')
        self.account = BankAccount.objects.create(
            name='HDFC', chart_account=self.bank_gl, location_id=1,
        )

    def test_statement_balance_ignores_excluded_rows(self):
        BankTransaction.objects.create(
            bank_account=self.account, date=date(2026, 4, 1),
            description='real', amount=Decimal('1000'))
        BankTransaction.objects.create(
            bank_account=self.account, date=date(2026, 4, 2),
            description='duplicate', amount=Decimal('999'), status='excluded')
        self.assertEqual(statement_balance(self.account), Decimal('1000'))

    def test_book_balance_ignores_optional_and_memorandum(self):
        recv = ChartOfAccount.objects.get(account_code='1130')
        make_journal_entry(d=date(2026, 4, 1), lines=[
            (self.bank_gl, Decimal('500'), Decimal('0')),
            (recv, Decimal('0'), Decimal('500')),
        ])
        optional = make_journal_entry(d=date(2026, 4, 2), lines=[
            (self.bank_gl, Decimal('111'), Decimal('0')),
            (recv, Decimal('0'), Decimal('111')),
        ])
        optional.is_optional = True
        optional.save(update_fields=['is_optional'])
        self.assertEqual(book_balance(self.account), Decimal('500'))


class MatchIsolationTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.bank_gl = ChartOfAccount.objects.get(account_code='1120')
        self.recv = ChartOfAccount.objects.get(account_code='1130')
        self.account = BankAccount.objects.create(
            name='HDFC', chart_account=self.bank_gl, location_id=1,
        )
        self.txn = BankTransaction.objects.create(
            bank_account=self.account, date=date(2026, 4, 5),
            description='NEFT in', amount=Decimal('5000'))

    def _entry(self, location_id=1, **flags):
        je = make_journal_entry(d=date(2026, 4, 5), lines=[
            (self.bank_gl, Decimal('5000'), Decimal('0')),
            (self.recv, Decimal('0'), Decimal('5000')),
        ])
        changed = []
        if je.location_id != location_id:
            je.location_id = location_id
            changed.append('location_id')
        for k, v in flags.items():
            setattr(je, k, v)
            changed.append(k)
        if changed:
            je.save(update_fields=changed)
        return je

    def test_match_refuses_other_stores_entry(self):
        je = self._entry(location_id=2)
        with self.assertRaises(ValidationError):
            match_transaction(self.txn, je)

    def test_match_refuses_memorandum_entry(self):
        je = self._entry(is_memorandum=True)
        with self.assertRaises(ValidationError):
            match_transaction(self.txn, je)

    def test_suggestions_skip_other_store_and_off_book_entries(self):
        self._entry(location_id=2)
        self._entry(is_optional=True)
        good = self._entry()
        rows = find_match_suggestions(self.txn)
        self.assertEqual([r['entry_id'] for r in rows], [good.id])


class CategorizeGuardTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.bank_gl = ChartOfAccount.objects.get(account_code='1120')
        self.account = BankAccount.objects.create(
            name='HDFC', chart_account=self.bank_gl, location_id=1,
        )
        self.txn = BankTransaction.objects.create(
            bank_account=self.account, date=date(2026, 4, 5),
            description='rent', amount=Decimal('-7000'))

    def test_group_account_rejected(self):
        group = ChartOfAccount.objects.filter(is_leaf=False).first()
        self.assertIsNotNone(group)
        with self.assertRaises(ValidationError):
            categorize_transaction(self.txn, account_id=group.id)

    def test_other_stores_account_rejected(self):
        rent = ChartOfAccount.objects.filter(
            account_type='EXPENSE', is_leaf=True).first()
        clone = ChartOfAccount.objects.create(
            account_code=f'{rent.account_code}-X2', account_name='Rent — Store 2',
            account_type='EXPENSE', account_subtype=rent.account_subtype,
            parent=rent.parent, location_id=2, is_leaf=True, is_active=True,
        )
        with self.assertRaises(ValidationError):
            categorize_transaction(self.txn, account_id=clone.id)


class ChequeCancelTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        bank_gl = ChartOfAccount.objects.get(account_code='1120')
        self.account = BankAccount.objects.create(
            name='HDFC', chart_account=bank_gl, location_id=1,
        )

    def test_cancel_reverses_linked_entry(self):
        bank = ChartOfAccount.objects.get(account_code='1120')
        recv = ChartOfAccount.objects.get(account_code='1130')
        je = make_journal_entry(d=date(2026, 4, 1), lines=[
            (bank, Decimal('5000'), Decimal('0')),
            (recv, Decimal('0'), Decimal('5000')),
        ])
        cheque = Cheque.objects.create(
            cheque_no='000200', kind='received', bank_account=self.account,
            cheque_date=date(2026, 4, 1), amount=Decimal('5000'),
            journal_entry=je,
        )
        mark_cheque_cancelled(cheque, reason='stop payment')
        cheque.refresh_from_db()
        self.assertEqual(cheque.status, 'cancelled')
        self.assertIn('stop payment', cheque.notes)
        self.assertIsNotNone(cheque.bounce_journal_entry)

    def test_cancel_non_pending_raises(self):
        cheque = Cheque.objects.create(
            cheque_no='000201', kind='received', bank_account=self.account,
            cheque_date=date(2026, 4, 1), amount=Decimal('5000'),
            status='cleared',
        )
        with self.assertRaises(ValidationError):
            mark_cheque_cancelled(cheque)


class PettyCashSpendGuardTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        cash = ChartOfAccount.objects.get(account_code='1110')
        self.float_obj = PettyCashFloat.objects.create(
            location_id=1, location_name='Main',
            chart_account=cash,
            imprest_amount=Decimal('5000'),
            replenishment_threshold=Decimal('1000'),
        )

    def test_non_expense_account_rejected(self):
        recv = ChartOfAccount.objects.get(account_code='1130')
        with self.assertRaises(ValidationError):
            post_petty_cash_spend(
                float_obj=self.float_obj, date=date(2026, 4, 1),
                amount=Decimal('100'), expense_account=recv,
                description='wrong head')

"""Categorising a bank line to a trade control WITHOUT a party mints an
invisible balance: money out debits Trade Receivables that no customer owes,
money in credits it while every named customer's ledger stays untouched — the
control drains and nothing on any statement can ever clear it. The party tag is
required there.

And ONLY there: 'Payable'/'Receivable' is also the subtype of PF, ESI, PT, Net
Salary and the deposit/provision accounts, which are categorised without a party
every single month — a subtype-based guard would 400 all of them and would also
re-route a party-tagged PF payment into that party's ledger.
"""
from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from banking.models import BankAccount, BankTransaction
from banking.services import categorize_transaction
from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry


class CategorizePartyTagTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.bank_gl = ChartOfAccount.objects.get(account_code='1120')
        self.payables = ChartOfAccount.objects.get(account_code='2110')
        self.receivables = ChartOfAccount.objects.get(account_code='1130')
        self.pf = ChartOfAccount.objects.get(account_code='2170')
        self.net_salary = ChartOfAccount.objects.get(account_code='2200')
        self.account = BankAccount.objects.create(
            name='HDFC', chart_account=self.bank_gl, location_id=1,
        )

    def _txn(self, amount):
        return BankTransaction.objects.create(
            bank_account=self.account, date=date(2026, 4, 5),
            description='NEFT', amount=Decimal(amount))

    def _other_line(self, entry):
        return entry.lines.exclude(account=self.bank_gl).get()

    # ── the control accounts demand a party ────────────────────────────────
    def test_payment_to_payables_without_party_rejected(self):
        txn = self._txn('-5000')
        with self.assertRaises(ValidationError) as ctx:
            categorize_transaction(txn, account_id=self.payables.id)
        self.assertIn('supplier', str(ctx.exception).lower())
        # Nothing half-written: no JE, and the row is still waiting.
        self.assertEqual(JournalEntry.objects.count(), 0)
        txn.refresh_from_db()
        self.assertEqual(txn.status, 'unmatched')

    def test_receipt_to_receivables_without_party_rejected(self):
        txn = self._txn('5000')
        with self.assertRaises(ValidationError) as ctx:
            categorize_transaction(txn, account_id=self.receivables.id)
        self.assertIn('customer', str(ctx.exception).lower())
        self.assertEqual(JournalEntry.objects.count(), 0)

    def test_blank_party_type_with_id_still_rejected(self):
        # The serializer defaults party_type to '' — an id alone is not a tag.
        txn = self._txn('5000')
        with self.assertRaises(ValidationError):
            categorize_transaction(txn, account_id=self.receivables.id,
                                   party_type='', party_id=42)

    def test_supplier_tag_on_the_receivables_control_rejected(self):
        # The UI pre-selects party_type='Supplier' on every outflow, so a
        # customer refund categorised to 1130 arrives tagged with the WRONG
        # side — accepting it would open a creditor ledger for a debtor.
        txn = self._txn('-5000')
        with self.assertRaises(ValidationError):
            categorize_transaction(txn, account_id=self.receivables.id,
                                   party_type='Supplier', party_id=7)

    def test_payment_to_payables_with_supplier_accepted(self):
        txn = self._txn('-5000')
        entry = categorize_transaction(txn, account_id=self.payables.id,
                                       party_type='Supplier', party_id=7)
        line = self._other_line(entry)
        self.assertEqual((line.party_type, line.party_id), ('Supplier', 7))
        self.assertEqual(line.debit, Decimal('5000'))
        txn.refresh_from_db()
        self.assertEqual(txn.status, 'matched')

    # ── everything else keeps working untagged ─────────────────────────────
    def test_statutory_payable_without_party_accepted(self):
        # PF Payable shares the 'Payable' subtype with the trade control but is
        # a different account — the monthly PF challan has no party.
        txn = self._txn('-1800')
        entry = categorize_transaction(txn, account_id=self.pf.id)
        line = self._other_line(entry)
        self.assertEqual(line.account_id, self.pf.id)
        self.assertEqual(line.party_id, None)

    def test_net_salary_payout_without_party_accepted(self):
        txn = self._txn('-42000')
        entry = categorize_transaction(txn, account_id=self.net_salary.id)
        self.assertEqual(self._other_line(entry).account_id, self.net_salary.id)

    def test_tagged_statutory_payable_is_not_rerouted(self):
        # Redirect-to-party-ledger is keyed on account identity: a tag on PF
        # Payable annotates the line, it must not move the money to a creditor.
        txn = self._txn('-1800')
        entry = categorize_transaction(txn, account_id=self.pf.id,
                                       party_type='Supplier', party_id=7)
        line = self._other_line(entry)
        self.assertEqual(line.account_id, self.pf.id)
        self.assertEqual((line.party_type, line.party_id), ('Supplier', 7))

    def test_expense_account_without_party_accepted(self):
        rent = ChartOfAccount.objects.get(account_code='5410')
        txn = self._txn('-7000')
        entry = categorize_transaction(txn, account_id=rent.id)
        self.assertEqual(self._other_line(entry).account_id, rent.id)

    def test_party_ledger_account_carries_its_own_party(self):
        # Picking a supplier's OWN ledger already names the party; the line
        # inherits it instead of tripping the tag↔ledger guard untagged.
        ledger = ChartOfAccount.objects.create(
            account_code='2105-S7-L1', account_name='Supplier #7',
            account_type='LIABILITY', account_subtype='Payable',
            party_type='Supplier', party_id=7, location_id=1,
            is_leaf=True, is_active=True,
        )
        txn = self._txn('-2500')
        entry = categorize_transaction(txn, account_id=ledger.id)
        line = self._other_line(entry)
        self.assertEqual(line.account_id, ledger.id)
        self.assertEqual((line.party_type, line.party_id), ('Supplier', 7))

"""A petty-cash movement must debit the account the counter picked.

Every deposit used to debit the one account mapped to BANK and every expense
the one mapped to PETTY_EXPENSE, so a chain with three bank accounts and fifty
expense heads had books that said nothing about where the money went. The
pharmacy row now carries `ledger_account` (a bare core_chartofaccount.id —
there is no FK across the app boundary and there cannot be one).

Two properties are load-bearing and pinned here:

  * NULL must post EXACTLY what it posted before, because every row written
    before the picker existed is NULL and `full_resync` re-posts them all.
  * A pick that is no longer postable must RAISE, not fall back. The sync
    turns a raise into a visible SyncError that `retry_failed` re-drives;
    a silent fallback would book the wrong account and look like a success.
"""
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import TestCase

from core.models import AccountMapping, ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.services import JournalAutoGenerationService


def _txn(rid, txn_type='expense', ledger_account=None, location_id=1, **kw):
    """A stand-in for the read-only mirror row."""
    return SimpleNamespace(
        id=rid, txn_type=txn_type, amount=Decimal('250.00'),
        txn_date='2026-08-09', description='', bank_reference='',
        location_id=location_id, ledger_account=ledger_account, **kw,
    )


class PettyCashAccountRoutingTests(TestCase):

    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        # seed_chart_and_mappings has no petty-expense head; the fallback path
        # needs one, and 5475 is what production's coa_data maps.
        self.petty_default = ChartOfAccount.objects.create(
            account_code='5475', account_name='Petty Cash Expenses',
            account_type='EXPENSE', account_subtype='Other_Expense',
            parent=self.coa['5700'], is_leaf=True, is_active=True,
        )
        AccountMapping.objects.get_or_create(
            key='PETTY_EXPENSE', defaults={'account': self.petty_default})
        # The alternatives the counter can now choose between.
        self.bank_2 = ChartOfAccount.objects.create(
            account_code='1121', account_name='Bank Account 2 (Current)',
            account_type='ASSET', account_subtype='Bank',
            is_leaf=True, is_active=True,
        )
        self.travel = ChartOfAccount.objects.create(
            account_code='5472', account_name='Travel & Conveyance',
            account_type='EXPENSE', account_subtype='Other_Expense',
            parent=self.coa['5700'], is_leaf=True, is_active=True,
        )
        self.svc = JournalAutoGenerationService()

    def _generate(self, txn):
        with patch('journals.services.PettyCashTxnRO') as MockRO:
            MockRO.objects.get.return_value = txn
            return self.svc.generate_petty_cash(txn.id)

    def _debit_code(self, entry):
        debits = [l for l in entry.lines.all() if l.debit > 0]
        self.assertEqual(len(debits), 1)
        return debits[0].account.account_code

    def _credit_code(self, entry):
        credits = [l for l in entry.lines.all() if l.credit > 0]
        self.assertEqual(len(credits), 1)
        return credits[0].account.account_code

    # ── the default path must not move ──────────────────────────────────

    def test_null_account_deposit_posts_the_mapped_bank(self):
        entry = self._generate(_txn(9001, 'deposit'))
        self.assertEqual(self._debit_code(entry), '1120')
        self.assertEqual(self._credit_code(entry), '1110')
        self.assertEqual(entry.voucher_type, 'CONTRA')

    def test_null_account_expense_posts_the_mapped_petty_head(self):
        entry = self._generate(_txn(9002))
        self.assertEqual(self._debit_code(entry), '5475')
        self.assertEqual(self._credit_code(entry), '1110')
        self.assertEqual(entry.voucher_type, 'PAYMENT')

    def test_row_without_the_field_at_all_still_posts(self):
        """A stale accounting deploy whose RO mirror predates the column.

        The attribute is read with getattr(..., None) precisely so this keeps
        working instead of AttributeError-ing every petty-cash row in the sync.
        """
        txn = _txn(9003)
        del txn.ledger_account
        entry = self._generate(txn)
        self.assertEqual(self._debit_code(entry), '5475')

    # ── the picked account ──────────────────────────────────────────────

    def test_deposit_debits_the_chosen_bank(self):
        entry = self._generate(_txn(9010, 'deposit', ledger_account=self.bank_2.id))
        self.assertEqual(self._debit_code(entry), '1121')
        self.assertEqual(self._credit_code(entry), '1110',
                         'cash always leaves the drawer, whichever bank it lands in')

    def test_expense_debits_the_chosen_head(self):
        entry = self._generate(_txn(9011, ledger_account=self.travel.id))
        self.assertEqual(self._debit_code(entry), '5472')
        self.assertEqual(self._credit_code(entry), '1110')

    # ── refusals ────────────────────────────────────────────────────────

    def test_deposit_refuses_a_non_bank_account(self):
        with self.assertRaises(ValueError):
            self._generate(_txn(9020, 'deposit', ledger_account=self.travel.id))

    def test_expense_refuses_a_bank_account(self):
        with self.assertRaises(ValueError):
            self._generate(_txn(9021, ledger_account=self.bank_2.id))

    def test_expense_refuses_a_non_expense_type_with_the_expense_subtype(self):
        """Accumulated depreciation is an ASSET carrying 'Other_Expense'."""
        accum = ChartOfAccount.objects.create(
            account_code='1691', account_name='Accum Dep - Building',
            account_type='ASSET', account_subtype='Other_Expense',
            is_leaf=True, is_active=True,
        )
        with self.assertRaises(ValueError):
            self._generate(_txn(9022, ledger_account=accum.id))

    def test_refuses_group_inactive_and_other_store_accounts(self):
        inactive = ChartOfAccount.objects.create(
            account_code='5461', account_name='Postage & Courier',
            account_type='EXPENSE', account_subtype='Other_Expense',
            is_leaf=True, is_active=False,
        )
        other_store = ChartOfAccount.objects.create(
            account_code='5460-B2', account_name='Printing - Branch 2',
            account_type='EXPENSE', account_subtype='Other_Expense',
            location_id=99, is_leaf=True, is_active=True,
        )
        for rid, account in ((9030, self.coa['5700']), (9031, inactive),
                             (9032, other_store)):
            with self.subTest(account=account.account_code):
                # _assert_account_usable raises Django's ValidationError.
                with self.assertRaises((ValidationError, ValueError)):
                    self._generate(_txn(rid, ledger_account=account.id))

    def test_refuses_an_account_the_stock_integration_posts_to(self):
        """COGS is an ordinary active EXPENSE/Other_Expense leaf.

        Nothing else in this method would stop a petty expense landing there
        and detaching gross margin from the stock ledger, and the guard cannot
        live only in the pharmacy — an older pharmacy build could write the row.
        """
        AccountMapping.objects.update_or_create(
            key='COGS', defaults={'account': self.coa['5560']})
        with self.assertRaises(ValueError):
            self._generate(_txn(9045, ledger_account=self.coa['5560'].id))

    def test_deleted_account_raises_instead_of_falling_back(self):
        with self.assertRaises(ValueError):
            self._generate(_txn(9040, ledger_account=999999))

    def test_a_refused_pick_leaves_no_half_written_entry(self):
        """generate_petty_cash is atomic — a raise must roll the entry back.

        Without that, the unposted stub would sit in the books and
        `_entry_exists` would stop the retry ever posting the real one.
        """
        from journals.models import JournalEntry

        before = JournalEntry.objects.count()
        with self.assertRaises(ValueError):
            self._generate(_txn(9050, ledger_account=self.bank_2.id))
        self.assertEqual(JournalEntry.objects.count(), before)

    # ── idempotency is unchanged ────────────────────────────────────────

    def test_second_run_is_a_no_op(self):
        first = self._generate(_txn(9060, ledger_account=self.travel.id))
        self.assertIsNotNone(first)
        self.assertIsNone(self._generate(_txn(9060, ledger_account=self.travel.id)))

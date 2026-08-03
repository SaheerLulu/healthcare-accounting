"""#741 — the Cash Book showed other branches' ledgers and balances.

Two defects behind one symptom:

  * _build_book_response enumerated cash/bank accounts globally. Under
    per-store chart-of-accounts cloning every store has its own '1110-<STORE>'
    leaf, so Store A's Cash Book listed Store B's ledger as a card of its own.
  * require_location_or_all_access returned None -- "all stores, no filter" --
    whenever the X-Location-Id header failed to resolve, even though one had
    been sent. For an all-access user that silently turned a store report into
    a consolidated one while the switcher still said Store A.
"""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.models import ChartOfAccount
from core.tests.utils import (
    make_admin, make_settings, seed_chart_and_mappings,
)
from journals.models import JournalEntry, JournalEntryLine
from reports.views import BankBookView, CashBookView


def _clone(template, code, name, location_id):
    """A per-store leaf, the way core.location_coa clones the template."""
    return ChartOfAccount.objects.create(
        account_code=code, account_name=name,
        account_type=template.account_type,
        account_subtype=template.account_subtype,
        location_id=location_id, is_leaf=True, is_active=True,
    )


def _posted(d, lines, *, location_id, entry_no):
    entry = JournalEntry.objects.create(
        date=d, narration='x', voucher_type='JOURNAL', reference_type='Manual',
        location_id=location_id, entry_no=entry_no,
    )
    for account, debit, credit in lines:
        JournalEntryLine.objects.create(entry=entry, account=account,
                                        debit=debit, credit=credit)
    entry.post()
    return entry


class CashBookLocationScopingTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

        cash, bank, sales = self.coa['1110'], self.coa['1120'], self.coa['4100']
        self.cash_a = _clone(cash, '1110-AAA', 'Cash in Hand - Store A', 1)
        self.cash_b = _clone(cash, '1110-BBB', 'Cash in Hand - Store B', 2)
        self.bank_a = _clone(bank, '1120-AAA', 'HDFC - Store A', 1)
        self.bank_b = _clone(bank, '1120-BBB', 'HDFC - Store B', 2)

        # Store A: 500 before the window, 100 inside it.
        _posted(date(2026, 3, 20), [(self.cash_a, Decimal('500'), Decimal('0')),
                                    (sales, Decimal('0'), Decimal('500'))],
                location_id=1, entry_no='A-OPEN')
        _posted(date(2026, 4, 10), [(self.cash_a, Decimal('100'), Decimal('0')),
                                    (sales, Decimal('0'), Decimal('100'))],
                location_id=1, entry_no='A-IN')
        # Store B: money that must never appear in Store A's book.
        _posted(date(2026, 4, 11), [(self.cash_b, Decimal('777'), Decimal('0')),
                                    (sales, Decimal('0'), Decimal('777'))],
                location_id=2, entry_no='B-IN')
        _posted(date(2026, 4, 12), [(self.bank_b, Decimal('333'), Decimal('0')),
                                    (sales, Decimal('0'), Decimal('333'))],
                location_id=2, entry_no='B-BANK')

    def book(self, view, location_id='1'):
        request = self.factory.get('/api/reports/cash-book/', {
            'start_date': '2026-04-01', 'end_date': '2026-04-30',
        }, HTTP_X_LOCATION_ID=location_id)
        force_authenticate(request, self.admin)
        with mock.patch('core.mixins.resolve_active_location',
                        lambda r: SimpleNamespace(id=int(location_id))):
            return view.as_view()(request).data

    def test_only_the_selected_stores_cash_ledgers_are_listed(self):
        codes = [a['account_code'] for a in self.book(CashBookView)['accounts']]
        self.assertIn('1110-AAA', codes)
        self.assertNotIn('1110-BBB', codes)

    def test_shared_untagged_ledgers_are_still_listed(self):
        """The seeded 1110 template carries history for stores that were never
        cloned, so it must stay visible — this is not the leak."""
        codes = [a['account_code'] for a in self.book(CashBookView)['accounts']]
        self.assertIn('1110', codes)

    def test_balances_are_per_store(self):
        acct = next(a for a in self.book(CashBookView)['accounts']
                    if a['account_code'] == '1110-AAA')
        self.assertEqual(Decimal(acct['opening_balance']), Decimal('500.00'))
        self.assertEqual(Decimal(acct['closing_balance']), Decimal('600.00'))

    def test_another_stores_money_is_absent_from_the_summary(self):
        data = self.book(CashBookView)
        self.assertEqual(Decimal(data['summary']['total_debit']), Decimal('100.00'))

    def test_switching_store_shows_only_that_store(self):
        codes = [a['account_code'] for a in self.book(CashBookView, '2')['accounts']]
        self.assertIn('1110-BBB', codes)
        self.assertNotIn('1110-AAA', codes)

    def test_bank_book_is_scoped_the_same_way(self):
        codes = [a['account_code'] for a in self.book(BankBookView)['accounts']]
        self.assertIn('1120-AAA', codes)
        self.assertNotIn('1120-BBB', codes)


class UnresolvableLocationHeaderTests(TestCase):
    """A store was selected but could not be resolved — a stale id in
    localStorage, say. Reporting every branch's money under that store's name
    is worse than refusing, so 'all stores' must mean 'no header'."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _get(self, **headers):
        request = self.factory.get('/api/reports/cash-book/', {}, **headers)
        force_authenticate(request, self.admin)
        with mock.patch('core.mixins.resolve_active_location', lambda r: None):
            return CashBookView.as_view()(request)

    def test_unresolvable_header_is_refused(self):
        resp = self._get(HTTP_X_LOCATION_ID='999')
        self.assertEqual(resp.status_code, 403)

    def test_no_header_still_means_all_stores(self):
        self.assertEqual(self._get().status_code, 200)

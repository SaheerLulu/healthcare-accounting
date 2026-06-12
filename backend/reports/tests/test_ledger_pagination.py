"""Ledger pagination contract + perf shape.

The paginated branch used to iterate every pre-page row in Python to seed the
running balance, and both branches materialised full line+entry instances.
Rows now come from .values() and the pre-page balance from one aggregate over
the sliced queryset — these tests pin that the paginated pages stitch together
into EXACTLY the legacy non-paginated response (same rows, same running
balances, same closing balance).
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from reports.views import LedgerView


class LedgerPaginationTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

        cash, sales = self.coa['1110'], self.coa['4100']
        # Prior-period activity → opening balance 1000.
        make_journal_entry(d=date(2026, 3, 15), lines=[
            (cash, Decimal('1000'), Decimal('0')),
            (sales, Decimal('0'), Decimal('1000')),
        ])
        # Five in-window cash lines with distinct amounts.
        for day, amount in ((1, '100'), (2, '200'), (3, '300'),
                            (4, '400'), (5, '500')):
            make_journal_entry(d=date(2026, 4, day), lines=[
                (cash, Decimal(amount), Decimal('0')),
                (sales, Decimal('0'), Decimal(amount)),
            ])

    def _get(self, **params):
        params.setdefault('account_code', '1110')
        params.setdefault('start_date', '2026-04-01')
        params.setdefault('end_date', '2026-04-30')
        request = self.factory.get('/api/reports/ledger/', params)
        force_authenticate(request, self.admin)
        response = LedgerView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        return response.data

    def test_pages_stitch_into_the_full_ledger(self):
        full = self._get()                      # legacy non-paginated branch
        self.assertEqual(len(full['transactions']), 5)
        self.assertEqual(Decimal(full['opening_balance']), Decimal('1000.00'))
        self.assertEqual(Decimal(full['closing_balance']), Decimal('2500.00'))

        stitched = []
        for page in (1, 2, 3):
            data = self._get(page=str(page), page_size='2')
            self.assertEqual(data['count'], 5)
            results = data['results']
            # Same opening balance on every page (period opening, not page).
            self.assertEqual(results['opening_balance'], full['opening_balance'])
            self.assertEqual(results['account'], full['account'])
            stitched.extend(results['transactions'])

        # Rows AND running balances are byte-identical to the full response —
        # this exercises the pre-page aggregate (pages 2 and 3).
        self.assertEqual(stitched, full['transactions'])

    def test_last_page_closing_matches_full_closing(self):
        full = self._get()
        last = self._get(page='3', page_size='2')
        self.assertEqual(last['results']['closing_balance'], full['closing_balance'])
        self.assertIsNone(last['next'])

    def test_mid_page_closing_is_balance_through_that_page(self):
        # Page 1 of 2-per-page: 1000 + 100 + 200.
        data = self._get(page='1', page_size='2')
        self.assertEqual(Decimal(data['results']['closing_balance']), Decimal('1300.00'))
        self.assertIsNotNone(data['next'])

"""Perf regression for the journal-entries list endpoint:

  1. The line serializer embeds `bill_references`, but the viewset only
     prefetched `lines__account` — one extra query PER LINE on every page.
  2. posted_count / draft_count re-filtered the queryset twice (two COUNT
     queries) on top of the paginator's own count.

The list must now run a CONSTANT number of queries no matter how many
entries/lines/bill-references are on the page, and the two counts collapse
into one conditional aggregate with an unchanged response shape.
"""
from datetime import date
from decimal import Decimal

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from journals.models import BillReference
from journals.views import JournalEntryViewSet


class JournalListQueryCountTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _make_entry_with_refs(self, *, post=True):
        entry = make_journal_entry(d=date(2026, 4, 10), post=post)
        for line in entry.lines.all():
            BillReference.objects.create(
                line=line, kind='ON_ACCOUNT', ref_no=f'REF-{line.pk}',
                amount=Decimal('10.00'),
            )
        return entry

    def _list_queries(self):
        request = self.factory.get('/api/journals/journal-entries/')
        force_authenticate(request, user=self.admin)
        view = JournalEntryViewSet.as_view({'get': 'list'})
        with CaptureQueriesContext(connection) as ctx:
            response = view(request)
            self.assertEqual(response.status_code, 200)
            # Force full serialization inside the capture window.
            payload = response.data
            self.assertIn('results', payload)
        return len(ctx), payload

    def test_query_count_constant_in_rows_and_refs(self):
        for _ in range(2):
            self._make_entry_with_refs()
        small_n, small_payload = self._list_queries()
        self.assertEqual(len(small_payload['results']), 2)

        for _ in range(8):
            self._make_entry_with_refs()
        big_n, big_payload = self._list_queries()
        self.assertEqual(len(big_payload['results']), 10)

        # 5× the rows (each with lines + bill references) must not add a
        # single query: page + prefetches + counts are all constant.
        self.assertEqual(small_n, big_n)
        # Every line of every entry carries its bill reference in the payload.
        for row in big_payload['results']:
            for line in row['lines']:
                self.assertEqual(len(line['bill_references']), 1)

    def test_posted_and_draft_counts_unchanged_shape(self):
        self._make_entry_with_refs(post=True)
        self._make_entry_with_refs(post=True)
        self._make_entry_with_refs(post=False)

        _, payload = self._list_queries()
        self.assertEqual(payload['posted_count'], 2)
        self.assertEqual(payload['draft_count'], 1)
        self.assertEqual(payload['count'], 3)

    def test_counts_with_line_join_filter_stay_distinct(self):
        # account filter joins the lines table and applies .distinct();
        # the conditional aggregate must not double-count multi-line entries.
        from core.models import ChartOfAccount
        cash = ChartOfAccount.objects.get(account_code='1110')
        sales = ChartOfAccount.objects.get(account_code='4100')
        make_journal_entry(d=date(2026, 4, 10), lines=[
            (cash, Decimal('60.00'), Decimal('0.00')),
            (cash, Decimal('40.00'), Decimal('0.00')),
            (sales, Decimal('0.00'), Decimal('100.00')),
        ])
        request = self.factory.get(
            f'/api/journals/journal-entries/?account={cash.pk}')
        force_authenticate(request, user=self.admin)
        response = JournalEntryViewSet.as_view({'get': 'list'})(request)
        self.assertEqual(response.status_code, 200)
        # Two cash lines on ONE entry → still one posted entry, not two.
        self.assertEqual(response.data['posted_count'], 1)
        self.assertEqual(response.data['draft_count'], 0)
        self.assertEqual(response.data['count'], 1)

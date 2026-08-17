"""Two regressions on the journals API:

  1. JournalEntryLineCreateSerializer omitted 'id', so the create/update
     response's line objects carried no pk. Both voucher screens guard their
     bill-wise allocation call with `if (drLine?.id)` — permanently false —
     so createBillReference never ran and no voucher could write a bill
     allocation.
  2. The single search box (`q`) matched only entry_no/narration, but the list
     renders the source document as "PurchaseReturn #4021"; that number was
     unsearchable.
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.models import ChartOfAccount
from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from journals.models import JournalEntry, JournalEntryLine
from journals.serializers import JournalEntryCreateSerializer
from journals.views import JournalEntryViewSet


class CreateResponseCarriesLineIdsTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        self.cash = ChartOfAccount.objects.get(account_code='1110')
        self.sales = ChartOfAccount.objects.get(account_code='4100')

    def _payload(self, lines=None):
        return {
            'date': '2026-04-15', 'narration': 'Manual voucher',
            'voucher_type': 'JOURNAL', 'reference_type': 'Manual',
            'location_id': 1,
            'lines': lines if lines is not None else [
                {'account': self.cash.id, 'debit': '100.00', 'credit': '0.00'},
                {'account': self.sales.id, 'debit': '0.00', 'credit': '100.00'},
            ],
        }

    def _create(self, payload=None):
        req = self.factory.post('/api/journals/journal-entries/',
                                payload or self._payload(), format='json')
        force_authenticate(req, user=self.admin)
        return JournalEntryViewSet.as_view({'post': 'create'})(req)

    def test_create_response_lines_carry_id(self):
        resp = self._create()
        self.assertEqual(resp.status_code, 201, getattr(resp, 'data', None))
        entry = JournalEntry.objects.get(pk=resp.data['id'])
        returned = [l.get('id') for l in resp.data['lines']]
        self.assertTrue(all(returned), resp.data['lines'])
        # The pks the voucher screen posts bill references against must be the
        # rows that were actually saved.
        self.assertEqual(sorted(returned),
                         sorted(entry.lines.values_list('id', flat=True)))

    def test_update_response_lines_carry_id(self):
        created = self._create()
        entry_id = created.data['id']
        payload = self._payload([
            {'account': self.cash.id, 'debit': '250.00', 'credit': '0.00'},
            {'account': self.sales.id, 'debit': '0.00', 'credit': '250.00'},
        ])
        req = self.factory.put(f'/api/journals/journal-entries/{entry_id}/',
                               payload, format='json')
        force_authenticate(req, user=self.admin)
        resp = JournalEntryViewSet.as_view({'put': 'update'})(req, pk=entry_id)
        self.assertEqual(resp.status_code, 200, getattr(resp, 'data', None))
        entry = JournalEntry.objects.get(pk=entry_id)
        self.assertEqual(sorted(l['id'] for l in resp.data['lines']),
                         sorted(entry.lines.values_list('id', flat=True)))

    def test_client_supplied_line_id_is_ignored(self):
        """'id' is read-only, so it never reaches create()'s **line_data —
        a spoofed pk must not overwrite an existing line."""
        existing = make_journal_entry(d=date(2026, 4, 10))
        victim = existing.lines.first()
        resp = self._create(self._payload([
            {'id': victim.pk, 'account': self.cash.id,
             'debit': '100.00', 'credit': '0.00'},
            {'id': victim.pk, 'account': self.sales.id,
             'debit': '0.00', 'credit': '100.00'},
        ]))
        self.assertEqual(resp.status_code, 201, getattr(resp, 'data', None))
        victim.refresh_from_db()
        self.assertEqual(victim.entry_id, existing.pk)
        self.assertNotIn(victim.pk, [l['id'] for l in resp.data['lines']])

    def test_serializer_save_still_creates_both_lines(self):
        ser = JournalEntryCreateSerializer(data=self._payload())
        self.assertTrue(ser.is_valid(), ser.errors)
        entry = ser.save()
        self.assertEqual(entry.lines.count(), 2)
        self.assertEqual({l['id'] for l in ser.data['lines']},
                         set(entry.lines.values_list('id', flat=True)))


class JournalSearchTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _search(self, **params):
        req = self.factory.get('/api/journals/journal-entries/', params)
        force_authenticate(req, user=self.admin)
        resp = JournalEntryViewSet.as_view({'get': 'list'})(req)
        self.assertEqual(resp.status_code, 200, getattr(resp, 'data', None))
        return resp.data

    def test_search_matches_reference_id(self):
        target = make_journal_entry(
            d=date(2026, 4, 10), narration='Return to vendor',
            reference_type='PurchaseReturn', reference_id=4021)
        make_journal_entry(d=date(2026, 4, 11), narration='Unrelated',
                           reference_type='Sale', reference_id=99)
        data = self._search(q='4021')
        self.assertEqual([r['id'] for r in data['results']], [target.pk])

    def test_search_still_matches_entry_no(self):
        target = make_journal_entry(d=date(2026, 4, 10), narration='Alpha')
        make_journal_entry(d=date(2026, 4, 11), narration='Beta')
        data = self._search(q=target.entry_no)
        self.assertEqual([r['id'] for r in data['results']], [target.pk])

    def test_search_still_matches_narration(self):
        target = make_journal_entry(d=date(2026, 4, 10),
                                    narration='Diesel generator fuel')
        make_journal_entry(d=date(2026, 4, 11), narration='Beta')
        data = self._search(q='generator')
        self.assertEqual([r['id'] for r in data['results']], [target.pk])

    def test_search_with_amount_min_totals_whole_entry(self):
        """filter_q must not join the lines table: it is applied BEFORE
        amount_min, whose annotate(Sum('lines__debit')) would then total only
        the joined subset."""
        cash = ChartOfAccount.objects.get(account_code='1110')
        sales = ChartOfAccount.objects.get(account_code='4100')
        target = make_journal_entry(
            d=date(2026, 4, 10), narration='Widget purchase',
            reference_type='PurchaseOrder', reference_id=4021,
            lines=[
                (cash, Decimal('60.00'), Decimal('0.00')),
                (cash, Decimal('40.00'), Decimal('0.00')),
                (sales, Decimal('0.00'), Decimal('100.00')),
            ])

        for term in ('Widget', '4021'):
            with self.subTest(term=term):
                data = self._search(q=term, amount_min='100')
                self.assertEqual([r['id'] for r in data['results']], [target.pk])
                # Total is exactly 100 — one row, not double-counted by a join.
                self.assertEqual(self._search(q=term, amount_min='101')['results'], [])
                self.assertEqual(
                    [r['id'] for r in self._search(q=term, amount_max='100')['results']],
                    [target.pk])

    def test_oversized_numeric_search_is_harmless(self):
        """A pasted digit string past PositiveIntegerField's ceiling (or long
        enough to make str→int itself expensive) must return no rows, not 500."""
        make_journal_entry(d=date(2026, 4, 10), narration='Alpha',
                           reference_type='Sale', reference_id=7)
        for term in ('2147483648', '9' * 5000):
            with self.subTest(term=term):
                self.assertEqual(self._search(q=term)['results'], [])

    def test_numeric_search_still_matches_entry_no_digits(self):
        target = make_journal_entry(d=date(2026, 4, 10), narration='Alpha')
        digits = target.entry_no.split('-')[-1]
        data = self._search(q=digits)
        self.assertIn(target.pk, [r['id'] for r in data['results']])


class LineIdFeedsBillReferenceTests(TestCase):
    """End-to-end shape of the blocked flow: create a voucher, then post a
    bill reference against the pk the create response handed back."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def test_allocation_can_be_attached_to_a_returned_line_id(self):
        payable = ChartOfAccount.objects.get(account_code='2110')
        bank = ChartOfAccount.objects.get(account_code='1120')
        req = self.factory.post('/api/journals/journal-entries/', {
            'date': '2026-04-20', 'narration': 'Supplier payment',
            'voucher_type': 'PAYMENT', 'reference_type': 'Manual',
            'location_id': 1,
            'lines': [
                {'account': payable.id, 'debit': '500.00', 'credit': '0.00',
                 'party_type': 'Supplier', 'party_id': 42},
                {'account': bank.id, 'debit': '0.00', 'credit': '500.00'},
            ],
        }, format='json')
        force_authenticate(req, user=self.admin)
        resp = JournalEntryViewSet.as_view({'post': 'create'})(req)
        self.assertEqual(resp.status_code, 201, getattr(resp, 'data', None))

        dr_line_id = next(l['id'] for l in resp.data['lines']
                          if Decimal(l['debit']) > 0)
        from journals.views import BillReferenceViewSet
        ref_req = self.factory.post('/api/journals/bill-references/', {
            'line': dr_line_id, 'kind': 'ON_ACCOUNT',
            'ref_no': 'PI-9', 'amount': '500.00',
        }, format='json')
        force_authenticate(ref_req, user=self.admin)
        ref_resp = BillReferenceViewSet.as_view({'post': 'create'})(ref_req)
        self.assertEqual(ref_resp.status_code, 201, getattr(ref_resp, 'data', None))
        self.assertEqual(
            JournalEntryLine.objects.get(pk=dr_line_id).bill_references.count(), 1)

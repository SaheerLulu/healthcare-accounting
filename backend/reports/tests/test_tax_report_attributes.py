"""Tax-filing attributes added to reports:

  - GST Computation worksheet nets credit notes into the liability (matching
    GSTR-3B 3.1(a)) and surfaces them, RCM and exempt income as visible blocks.
  - HSN summary carries the GSTR-1 Table 12 Phase-3 B2B/B2C segment split and
    exports CSV.
  - Ledger transactions expose the source document reference.
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from gst_returns.models import GSTR1Entry, GSTR1HSNSummary
from reports.views import GSTComputationView, HSNSummaryView, LedgerView


def _gstr1_entry(**kw):
    defaults = dict(
        source_type='b2b', source_id=1, period='2026-05', version=1,
        is_active=True, location_id=1, invoice_no='INV-1',
        invoice_date=date(2026, 5, 10), customer_gstin='27AAAAA0000A1Z5',
        invoice_type='B2B', place_of_supply='27',
        taxable_value=Decimal('1000.00'),
        cgst=Decimal('60.00'), sgst=Decimal('60.00'), igst=Decimal('0.00'),
        rate=Decimal('12.00'),
    )
    defaults.update(kw)
    return GSTR1Entry.objects.create(**defaults)


class GSTComputationCreditNoteTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _get(self):
        request = self.factory.get('/api/reports/gst-computation/', {'period': '2026-05'})
        force_authenticate(request, user=self.admin)
        return GSTComputationView.as_view()(request).data

    def test_credit_notes_reduce_net_liability(self):
        _gstr1_entry()  # forward sale: 60/60 CGST/SGST
        _gstr1_entry(   # credit note: −10/−10
            source_type='return', source_id=9, invoice_no='RET-9',
            invoice_type='CDNR',
            taxable_value=Decimal('-200.00'),
            cgst=Decimal('-10.00'), sgst=Decimal('-10.00'),
        )
        data = self._get()
        # CN block shown as positive reductions.
        self.assertEqual(Decimal(data['credit_notes']['cgst']), Decimal('10'))
        self.assertEqual(Decimal(data['credit_notes']['taxable']), Decimal('200'))
        # Liability netted: 60 − 10 = 50 per head (no ITC seeded).
        self.assertEqual(Decimal(data['net_payable']['cgst']), Decimal('50'))
        self.assertEqual(Decimal(data['net_payable']['sgst']), Decimal('50'))
        self.assertIn('rcm_inward', data)
        self.assertIn('exempt_outward', data)

    def test_time_barred_credit_notes_are_excluded(self):
        _gstr1_entry()
        _gstr1_entry(
            source_type='return', source_id=10, invoice_no='RET-10',
            invoice_type='CDNR', is_time_barred=True,
            taxable_value=Decimal('-200.00'),
            cgst=Decimal('-10.00'), sgst=Decimal('-10.00'),
        )
        data = self._get()
        self.assertEqual(Decimal(data['credit_notes']['cgst']), Decimal('0'))
        self.assertEqual(Decimal(data['net_payable']['cgst']), Decimal('60'))


class HSNSegmentTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        GSTR1HSNSummary.objects.create(
            period='2026-05', location_id=1, hsn_code='3004', segment='B2B',
            description='Tablets', uqc='NOS', quantity=Decimal('10'),
            taxable_value=Decimal('1000'), cgst=Decimal('60'),
            sgst=Decimal('60'), igst=Decimal('0'), rate=Decimal('12'),
            version=1, is_active=True,
        )
        GSTR1HSNSummary.objects.create(
            period='2026-05', location_id=1, hsn_code='3004', segment='B2C',
            description='Tablets', uqc='NOS', quantity=Decimal('4'),
            taxable_value=Decimal('400'), cgst=Decimal('24'),
            sgst=Decimal('24'), igst=Decimal('0'), rate=Decimal('12'),
            version=1, is_active=True,
        )

    def _get(self, **params):
        request = self.factory.get('/api/reports/hsn-summary/', {'period': '2026-05', **params})
        force_authenticate(request, user=self.admin)
        return HSNSummaryView.as_view()(request)

    def test_rows_carry_segment_and_segment_totals(self):
        data = self._get().data
        segments = {r['segment'] for r in data['rows']}
        self.assertEqual(segments, {'B2B', 'B2C'})
        self.assertEqual(Decimal(data['segment_totals']['B2B']['taxable']), Decimal('1000'))
        self.assertEqual(Decimal(data['segment_totals']['B2C']['taxable']), Decimal('400'))

    def test_segment_filter(self):
        data = self._get(segment='B2B').data
        self.assertEqual(len(data['rows']), 1)
        self.assertEqual(data['rows'][0]['segment'], 'B2B')

    def test_csv_export(self):
        response = self._get(export='csv', segment='B2C')
        self.assertEqual(response['Content-Type'], 'text/csv')
        body = response.content.decode()
        self.assertIn('HSN,Segment,Description,UQC', body)
        self.assertIn('3004', body)
        self.assertIn('B2C', body)
        self.assertNotIn('B2B', body.replace('B2B/B2C', ''))


class LedgerSourceReferenceTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def test_ledger_rows_expose_source_document(self):
        cash, sales = self.coa['1110'], self.coa['4100']
        make_journal_entry(
            d=date(2026, 5, 10),
            reference_type='POSOrder', reference_id=4321,
            lines=[(cash, Decimal('100'), Decimal('0')),
                   (sales, Decimal('0'), Decimal('100'))],
        )
        request = self.factory.get('/api/reports/ledger/', {'account_code': '1110'})
        force_authenticate(request, user=self.admin)
        data = LedgerView.as_view()(request).data
        txn = data['transactions'][0]
        self.assertEqual(txn['reference_type'], 'POSOrder')
        self.assertEqual(txn['reference_id'], 4321)

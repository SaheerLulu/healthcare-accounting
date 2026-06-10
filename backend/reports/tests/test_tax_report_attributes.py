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


class GSTFilingHealthTests(TestCase):
    """Pre-filing health check: GSTR-backed sections detect real issues; the
    inventory-backed sections degrade to status='unavailable' when the
    inventory DB can't be read (as in this SQLite test environment)."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _get(self, period='2026-05'):
        from reports.views import GSTFilingHealthView
        request = self.factory.get('/api/reports/gst-filing-health/', {'period': period})
        force_authenticate(request, user=self.admin)
        return GSTFilingHealthView.as_view()(request).data

    def test_detects_invalid_b2b_gstin_and_zero_rate(self):
        _gstr1_entry(invoice_no='INV-OK')                      # valid GSTIN, 12%
        _gstr1_entry(source_id=2, invoice_no='INV-BAD',
                     customer_gstin='BADGSTIN123')             # malformed
        _gstr1_entry(source_id=3, invoice_no='INV-ZERO',
                     invoice_type='B2C_SMALL', customer_gstin='',
                     rate=Decimal('0'), cgst=Decimal('0'), sgst=Decimal('0'))

        data = self._get()
        bad = data['sections']['invalid_customer_gstin']
        self.assertEqual(bad['count'], 1)
        self.assertEqual(bad['rows'][0]['invoice_no'], 'INV-BAD')

        zero = data['sections']['zero_rate_supplies']
        self.assertEqual(zero['count'], 1)
        self.assertEqual(zero['rows'][0]['invoice_no'], 'INV-ZERO')

        self.assertGreaterEqual(data['total_issues'], 2)

    def test_time_barred_section_and_unavailable_degradation(self):
        _gstr1_entry(source_type='return', source_id=9, invoice_no='RET-9',
                     invoice_type='CDNR', is_time_barred=True,
                     taxable_value=Decimal('-100'), cgst=Decimal('-6'),
                     sgst=Decimal('-6'))
        data = self._get()
        self.assertEqual(data['sections']['time_barred_credit_notes']['count'], 1)
        # Inventory-backed sections must exist but be marked unavailable here
        # (no inventory tables in the SQLite test DB) — never crash the view.
        for key in ('missing_hsn', 'writeoff_itc_reversal', 'tds_194q'):
            self.assertIn(key, data['sections'])
            self.assertEqual(data['sections'][key]['status'], 'unavailable')

    def test_invalid_supplier_gstin_flags_itc_at_risk(self):
        from gst_returns.models import GSTR2BEntry
        GSTR2BEntry.objects.create(
            period='2026-05', location_id=1, supplier_gstin='',
            supplier_name='No-GSTIN Traders', invoice_no='PB-1',
            invoice_date=date(2026, 5, 5), place_of_supply='27',
            taxable_value=Decimal('1000'), cgst=Decimal('60'),
            sgst=Decimal('60'), igst=Decimal('0'), itc_eligible=True,
        )
        data = self._get()
        sec = data['sections']['invalid_supplier_gstin']
        self.assertEqual(sec['count'], 1)
        self.assertEqual(Decimal(sec['rows'][0]['itc_at_risk']), Decimal('120'))

    def test_requires_period(self):
        from reports.views import GSTFilingHealthView
        request = self.factory.get('/api/reports/gst-filing-health/')
        force_authenticate(request, user=self.admin)
        response = GSTFilingHealthView.as_view()(request)
        self.assertEqual(response.status_code, 400)

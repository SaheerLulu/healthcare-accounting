"""Tests for GSTR-2B JSON portal upload (WP 651) and ITC discrepancy export (WP 654)."""
import json
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import make_admin, make_settings, seed_chart_and_mappings
from gst_returns.models import GSTR2BEntry, ITCReconciliation
from gst_returns.views import GSTR2BEntryViewSet, ITCReconciliationViewSet


class GSTR2BUploadTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _post_payload(self, payload):
        request = self.factory.post(
            '/api/gst/gstr2b/upload-json/',
            data=json.dumps({'period': '2026-04', 'location_id': 1, 'payload': payload}),
            content_type='application/json',
        )
        force_authenticate(request, user=self.admin)
        view = GSTR2BEntryViewSet.as_view({'post': 'upload_json'})
        return view(request)

    def test_b2b_invoice_creates_entry(self):
        portal_doc = {
            'data': {
                'docdata': {
                    'b2b': [{
                        'ctin': '27AABCS1234A1Z5',
                        'supname': 'Acme Suppliers',
                        'inv': [{
                            'inum': 'INV-001', 'idt': '01-04-2026',
                            'txval': 10000, 'camt': 900, 'samt': 900,
                            'iamt': 0, 'pos': '27',
                        }],
                    }],
                },
            },
        }
        response = self._post_payload(json.dumps(portal_doc))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(GSTR2BEntry.objects.count(), 1)
        e = GSTR2BEntry.objects.first()
        self.assertEqual(e.supplier_gstin, '27AABCS1234A1Z5')
        self.assertEqual(e.cgst, Decimal('900'))

    def test_dedupe_on_reupload(self):
        portal_doc = {
            'data': {
                'docdata': {
                    'b2b': [{
                        'ctin': '27AABCS1234A1Z5',
                        'supname': 'Acme',
                        'inv': [{
                            'inum': 'INV-001', 'idt': '01-04-2026',
                            'txval': 10000, 'camt': 900, 'samt': 900, 'iamt': 0,
                        }],
                    }],
                },
            },
        }
        self._post_payload(json.dumps(portal_doc))
        self._post_payload(json.dumps(portal_doc))
        self.assertEqual(GSTR2BEntry.objects.count(), 1)

    def test_credit_note_negates_amount(self):
        portal_doc = {
            'data': {
                'docdata': {
                    'cdnr': [{
                        'ctin': '27AABCS1234A1Z5', 'supname': 'Acme',
                        'nt': [{
                            'nt_num': 'CN-001', 'nt_dt': '15-04-2026',
                            'ntty': 'C',  # credit note
                            'txval': 1000, 'camt': 90, 'samt': 90, 'iamt': 0,
                        }],
                    }],
                },
            },
        }
        self._post_payload(json.dumps(portal_doc))
        e = GSTR2BEntry.objects.get(invoice_no='CN-001')
        self.assertEqual(e.taxable_value, Decimal('-1000'))

    def test_invalid_json_returns_400(self):
        request = self.factory.post(
            '/api/gst/gstr2b/upload-json/',
            data=json.dumps({'period': '2026-04', 'location_id': 1,
                             'payload': '{not valid'}),
            content_type='application/json',
        )
        force_authenticate(request, user=self.admin)
        view = GSTR2BEntryViewSet.as_view({'post': 'upload_json'})
        response = view(request)
        self.assertEqual(response.status_code, 400)


class ITCDiscrepancyExportTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()

        ITCReconciliation.objects.create(
            period='2026-04', location_id=1,
            supplier_gstin='27AABCS1234A1Z5',
            books_taxable=Decimal('10000'), gstr2b_taxable=Decimal('9000'),
            books_cgst=Decimal('900'), gstr2b_cgst=Decimal('810'),
            status='partial', action_taken='Supplier filing amendment',
        )
        ITCReconciliation.objects.create(
            period='2026-04', location_id=1, supplier_gstin='29MATCH123A1Z5',
            books_taxable=Decimal('5000'), gstr2b_taxable=Decimal('5000'),
            status='matched',
        )

    def test_csv_excludes_matched(self):
        factory = APIRequestFactory()
        request = factory.get('/api/gst/itc-reconciliation/discrepancies-csv/')
        force_authenticate(request, user=self.admin)
        view = ITCReconciliationViewSet.as_view({'get': 'discrepancies_csv'})
        response = view(request)
        self.assertEqual(response.status_code, 200)
        body = response.content.decode()
        self.assertIn('27AABCS1234A1Z5', body)
        self.assertNotIn('29MATCH123A1Z5', body)

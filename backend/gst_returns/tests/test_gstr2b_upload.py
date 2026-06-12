"""Tests for GSTR-2B JSON portal upload (WP 651) and ITC discrepancy export (WP 654)."""
import json
from datetime import date
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from core.tests.utils import make_admin, make_settings, seed_chart_and_mappings
from gst_returns.models import GSTR2BEntry, ITCReconciliation
from gst_returns.views import (
    MAX_UPLOAD_BYTES, GSTR2BEntryViewSet, ITCReconciliationViewSet,
)


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


class GSTR2BUploadFileTests(TestCase):
    """Multipart file-upload path, routed through the real URLconf so the
    action's parser_classes are exercised (parser_classes=[] used to 415
    every routed call) plus the size/content-type caps."""

    PORTAL_DOC = json.dumps({
        'data': {'docdata': {'b2b': [{
            'ctin': '27AABCS1234A1Z5', 'supname': 'Acme',
            'inv': [{'inum': 'INV-009', 'idt': '01-04-2026',
                     'txval': 5000, 'camt': 450, 'samt': 450, 'iamt': 0}],
        }]}},
    }).encode()

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.client = APIClient()
        self.client.force_authenticate(make_admin())

    def _upload(self, content, name='gstr2b.json', ctype='application/json'):
        f = SimpleUploadedFile(name, content, content_type=ctype)
        return self.client.post(
            '/api/gst/gstr2b/upload-json/?period=2026-04&location_id=1',
            {'file': f}, format='multipart',
        )

    def test_routed_file_upload_creates_entries(self):
        resp = self._upload(self.PORTAL_DOC)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(GSTR2BEntry.objects.count(), 1)

    def test_routed_json_payload_still_works(self):
        resp = self.client.post(
            '/api/gst/gstr2b/upload-json/',
            {'period': '2026-04', 'location_id': 1,
             'payload': self.PORTAL_DOC.decode()},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(GSTR2BEntry.objects.count(), 1)

    def test_oversized_upload_rejected(self):
        resp = self._upload(b'x' * (MAX_UPLOAD_BYTES + 1))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('too large', resp.data['detail'])
        self.assertEqual(GSTR2BEntry.objects.count(), 0)

    def test_non_json_upload_rejected(self):
        resp = self._upload(self.PORTAL_DOC, name='gstr2b.csv', ctype='text/csv')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('.json', resp.data['detail'])
        self.assertEqual(GSTR2BEntry.objects.count(), 0)


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

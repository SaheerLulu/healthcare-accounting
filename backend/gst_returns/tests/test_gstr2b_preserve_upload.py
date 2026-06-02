"""Regression test for CRITICAL C4: GSTR2BGenerator.generate() must NOT delete
uploaded government GSTR-2B rows.

Uploaded portal rows have source_po_id=NULL and are the authoritative source
for ITC reconciliation. The old unscoped .delete() wiped them on every
regenerate — and GSTR-3B 'Generate' calls GSTR-2B generate — so a routine
monthly click silently destroyed the uploaded government data unrecoverably.
The fix scopes the delete to source_po_id__isnull=False (auto-derived rows only).
"""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from gst_returns.models import GSTR2BEntry
from gst_returns.services import GSTR2BGenerator


class GSTR2BPreserveUploadTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        # An uploaded government 2B row — source_po_id NULL.
        self.uploaded = GSTR2BEntry.objects.create(
            period='2026-04', location_id=1,
            supplier_gstin='27AABCS1234A1Z5', supplier_name='Govt Source Co',
            invoice_no='GOVT-INV-1', invoice_date=date(2026, 4, 5),
            place_of_supply='27',
            taxable_value=Decimal('10000'), cgst=Decimal('900'),
            sgst=Decimal('900'), igst=Decimal('0'),
            itc_eligible=True, source_po_id=None,
        )
        # An auto-derived row from a previous generate — source_po_id set.
        self.derived = GSTR2BEntry.objects.create(
            period='2026-04', location_id=1,
            supplier_gstin='27ZZZZZ9999Z1Z5', supplier_name='Derived Co',
            invoice_no='PO-DERIVED-1', invoice_date=date(2026, 4, 6),
            place_of_supply='27',
            taxable_value=Decimal('5000'), cgst=Decimal('450'),
            sgst=Decimal('450'), igst=Decimal('0'),
            itc_eligible=True, source_po_id=99,
        )

    def test_regenerate_preserves_uploaded_rows(self):
        # No PurchaseOrders to derive from (RO table not in test DB) → mock empty.
        with patch('gst_returns.services.PurchaseOrderRO') as MockPO:
            (MockPO.objects.filter.return_value.filter.return_value
             .select_related.return_value.prefetch_related.return_value) = []
            GSTR2BGenerator().generate('2026-04', 1)

        # The uploaded government row must survive.
        self.assertTrue(
            GSTR2BEntry.objects.filter(pk=self.uploaded.pk).exists(),
            'uploaded government GSTR-2B (source_po_id NULL) must not be deleted',
        )
        # The stale auto-derived row must be cleared (and not re-created here).
        self.assertFalse(
            GSTR2BEntry.objects.filter(pk=self.derived.pk).exists(),
            'auto-derived rows are still refreshed on regenerate',
        )

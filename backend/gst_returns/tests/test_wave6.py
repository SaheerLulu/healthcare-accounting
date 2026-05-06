"""Tests for Wave 6 GST features: GSTR-9C, E-Way Bill."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from gst_returns.gstr9c import generate_gstr9c
from gst_returns.models import EWayBill, GSTR1Entry


class GSTR9CTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def test_not_applicable_below_5cr(self):
        # Single ₹10K B2B sale → ₹10K turnover, well below ₹5 Cr
        GSTR1Entry.objects.create(
            period='2026-04', location_id=1, invoice_no='INV-1',
            invoice_date=date(2026, 4, 5), customer_gstin='27AAAAA1111A1Z5',
            invoice_type='B2B', taxable_value=Decimal('10000'),
            cgst=Decimal('900'), sgst=Decimal('900'),
            source_type='b2b', source_id=1,
        )
        payload = generate_gstr9c(fy_start_year=2026, location_id=1)
        self.assertFalse(payload['applicable'])
        self.assertIn('NOT applicable', payload['note'])

    def test_applicable_above_5cr(self):
        # ₹6 Cr B2B
        GSTR1Entry.objects.create(
            period='2026-04', location_id=1, invoice_no='INV-LARGE',
            invoice_date=date(2026, 4, 5), customer_gstin='27AAAAA1111A1Z5',
            invoice_type='B2B', taxable_value=Decimal('60000000'),
            cgst=Decimal('5400000'), sgst=Decimal('5400000'),
            source_type='b2b', source_id=1,
        )
        payload = generate_gstr9c(fy_start_year=2026, location_id=1)
        self.assertTrue(payload['applicable'])

    def test_variance_computed_when_audited_provided(self):
        GSTR1Entry.objects.create(
            period='2026-04', location_id=1, invoice_no='INV-1',
            invoice_date=date(2026, 4, 5), customer_gstin='27AAAAA1111A1Z5',
            invoice_type='B2B', taxable_value=Decimal('60000000'),
            source_type='b2b', source_id=1,
        )
        payload = generate_gstr9c(
            fy_start_year=2026, location_id=1,
            audited_turnover=Decimal('62000000'),  # ₹2L more than books
        )
        self.assertEqual(payload['table_5_turnover_recon']['unreconciled'],
                         '2000000.00')


class EWayBillTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def test_create_eway_bill(self):
        ewb = EWayBill.objects.create(
            reference_type='B2BSalesOrder', reference_id=1,
            invoice_no='INV-100', invoice_date=date(2026, 4, 5),
            from_gstin='27AAAAA1111A1Z5', from_name='Seefmed Pharma',
            from_state_code='27',
            to_gstin='29BBBBB2222B1Z5', to_name='Karnataka Buyer',
            to_state_code='29',
            taxable_value=Decimal('100000'),
            igst_rate=Decimal('18'),
            total_value=Decimal('118000'),
            transport_mode='1', distance_km=900,
            location_id=1,
        )
        self.assertTrue(ewb.is_inter_state)

    def test_intra_state_flag(self):
        ewb = EWayBill(
            reference_type='B2BSalesOrder',
            invoice_no='INV-101', invoice_date=date(2026, 4, 5),
            from_gstin='27A', from_name='Self', from_state_code='27',
            to_gstin='27B', to_name='Other', to_state_code='27',
            taxable_value=Decimal('1000'), total_value=Decimal('1180'),
        )
        self.assertFalse(ewb.is_inter_state)

    def test_nic_payload_shape(self):
        ewb = EWayBill.objects.create(
            reference_type='B2BSalesOrder',
            invoice_no='INV-200', invoice_date=date(2026, 4, 5),
            from_gstin='27AAAAA1111A1Z5', from_name='Self', from_state_code='27',
            to_gstin='29BBBBB2222B1Z5', to_name='Buyer', to_state_code='29',
            taxable_value=Decimal('100000'), igst_rate=Decimal('18'),
            total_value=Decimal('118000'),
            transport_mode='1', distance_km=900,
            quantity=Decimal('100'), hsn_code='30049099',
            product_name='Paracetamol 500mg',
        )
        payload = ewb.to_nic_payload()
        # Spot-check required portal fields
        for key in ('supplyType', 'docType', 'docNo', 'fromGstin',
                    'toGstin', 'fromStateCode', 'toStateCode',
                    'transMode', 'transDistance', 'itemList'):
            self.assertIn(key, payload)
        self.assertEqual(payload['supplyType'], 'O')
        self.assertEqual(payload['fromStateCode'], 27)
        self.assertEqual(payload['toStateCode'], 29)
        self.assertEqual(len(payload['itemList']), 1)

"""Tests for GSTR-9, late-fee calc, IRN generation."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from gst_returns.annual_return import (
    fy_period_list, generate_gstr9, gstr_late_fee_and_interest,
)
from gst_returns.einvoice import compute_irn, fy_from_date, generate_irn_for_entry
from gst_returns.models import GSTR1Entry


class GSTR9Tests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def test_fy_period_list_has_12_months(self):
        periods = fy_period_list(2026)
        self.assertEqual(len(periods), 12)
        self.assertEqual(periods[0], '2026-04')
        self.assertEqual(periods[-1], '2027-03')

    def test_generate_gstr9_aggregates_b2b(self):
        GSTR1Entry.objects.create(
            period='2026-04', location_id=1, invoice_no='INV-1',
            invoice_date=date(2026, 4, 5), customer_gstin='27AAAAA1111A1Z5',
            invoice_type='B2B', taxable_value=Decimal('10000'),
            cgst=Decimal('900'), sgst=Decimal('900'),
            source_type='b2b', source_id=1,
        )
        payload = generate_gstr9(fy_start_year=2026, location_id=1)
        self.assertEqual(payload['fy'], '2026-27')
        self.assertEqual(Decimal(payload['table_4_outward_taxable']['b2b']['taxable_value']),
                         Decimal('10000'))
        self.assertFalse(payload['must_file_gstr_9c'])  # below 5cr


class LateFeeTests(TestCase):
    def test_no_late_fee_when_paid_on_time(self):
        r = gstr_late_fee_and_interest(
            due_date=date(2026, 4, 20), payment_date=date(2026, 4, 18),
            tax_amount=Decimal('10000'),
        )
        self.assertEqual(r['days_late'], 0)
        self.assertEqual(r['late_fee'], '0.00')

    def test_late_fee_capped_at_5000(self):
        # 200 days late × ₹50 = ₹10,000 → capped at ₹5,000
        r = gstr_late_fee_and_interest(
            due_date=date(2025, 1, 20), payment_date=date(2025, 8, 8),
            tax_amount=Decimal('10000'),
        )
        self.assertEqual(r['late_fee'], '5000.00')

    def test_interest_at_18_pct(self):
        # 365 days × 18% interest on ₹10,000 = ₹1,800
        r = gstr_late_fee_and_interest(
            due_date=date(2025, 4, 20), payment_date=date(2026, 4, 20),
            tax_amount=Decimal('10000'),
        )
        self.assertEqual(r['interest'], '1800.00')

    def test_nil_return_lower_cap(self):
        r = gstr_late_fee_and_interest(
            due_date=date(2025, 1, 20), payment_date=date(2025, 8, 8),
            tax_amount=Decimal('0'),
        )
        # ₹20/day × 200 = ₹4,000 → capped at ₹500
        self.assertEqual(r['late_fee'], '500.00')


class IRNTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings(gstin='27AABCT1234A1Z5')

    def test_fy_from_date(self):
        self.assertEqual(fy_from_date(date(2026, 5, 1)), '2026-27')
        self.assertEqual(fy_from_date(date(2026, 3, 1)), '2025-26')

    def test_irn_is_64_hex(self):
        irn = compute_irn(supplier_gstin='27AABCT1234A1Z5',
                          doc_no='INV-001', doc_date=date(2026, 4, 5))
        self.assertEqual(len(irn), 64)
        self.assertTrue(all(c in '0123456789abcdef' for c in irn))

    def test_irn_deterministic(self):
        i1 = compute_irn(supplier_gstin='27AABCT1234A1Z5',
                         doc_no='INV-001', doc_date=date(2026, 4, 5))
        i2 = compute_irn(supplier_gstin='27AABCT1234A1Z5',
                         doc_no='INV-001', doc_date=date(2026, 4, 5))
        self.assertEqual(i1, i2)

    def test_generate_for_entry_persists_irn(self):
        e = GSTR1Entry.objects.create(
            period='2026-04', location_id=1, invoice_no='INV-100',
            invoice_date=date(2026, 4, 5), customer_gstin='29AAAAA9999A1Z5',
            invoice_type='B2B', taxable_value=Decimal('1000'),
            cgst=Decimal('0'), sgst=Decimal('0'), igst=Decimal('180'),
            source_type='b2b', source_id=1,
        )
        generate_irn_for_entry(e)
        e.refresh_from_db()
        self.assertEqual(len(e.irn), 64)
        self.assertEqual(e.e_invoice_status, 'generated')

    def test_idempotent_on_existing_irn(self):
        e = GSTR1Entry.objects.create(
            period='2026-04', location_id=1, invoice_no='INV-101',
            invoice_date=date(2026, 4, 5), customer_gstin='29AAAAA9999A1Z5',
            invoice_type='B2B', taxable_value=Decimal('1000'),
            source_type='b2b', source_id=2,
        )
        generate_irn_for_entry(e)
        first = e.irn
        generate_irn_for_entry(e)  # second call
        e.refresh_from_db()
        self.assertEqual(e.irn, first)

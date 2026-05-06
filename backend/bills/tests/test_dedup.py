"""Tests: duplicate (vendor + bill_no) is rejected."""
from datetime import date
from decimal import Decimal

from django.db import IntegrityError
from django.test import TestCase

from bills.models import Bill
from core.tests.utils import make_settings, seed_chart_and_mappings


class BillDuplicateGuardTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def test_same_vendor_and_bill_no_rejected(self):
        Bill.objects.create(
            bill_no='V-100', bill_date=date(2026, 4, 5),
            vendor_id=1, vendor_name='Acme', total_amount=Decimal('1000'),
        )
        with self.assertRaises(IntegrityError):
            Bill.objects.create(
                bill_no='V-100', bill_date=date(2026, 4, 6),
                vendor_id=1, vendor_name='Acme', total_amount=Decimal('1500'),
            )

    def test_different_vendor_same_bill_no_allowed(self):
        Bill.objects.create(
            bill_no='V-100', bill_date=date(2026, 4, 5),
            vendor_id=1, vendor_name='Acme', total_amount=Decimal('1000'),
        )
        # Different vendor with the same invoice number is fine
        Bill.objects.create(
            bill_no='V-100', bill_date=date(2026, 4, 5),
            vendor_id=2, vendor_name='Other', total_amount=Decimal('500'),
        )
        self.assertEqual(Bill.objects.count(), 2)

    def test_blank_bill_no_can_repeat(self):
        # Utility receipts often have no invoice number — multiple should be OK
        for _ in range(3):
            Bill.objects.create(
                bill_no='', bill_date=date(2026, 4, 5),
                vendor_id=1, vendor_name='Telco', total_amount=Decimal('500'),
            )
        self.assertEqual(Bill.objects.count(), 3)

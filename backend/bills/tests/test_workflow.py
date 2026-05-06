"""Tests for bill posting + payment lifecycle."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from bills.models import Bill, BillLine, BillPayment
from bills.services import post_bill, record_payment
from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings


class BillLifecycleTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.rent = ChartOfAccount.objects.get(account_code='5410')
        self.bill = Bill.objects.create(
            bill_no='V-100', bill_date=date(2026, 4, 5),
            due_date=date(2026, 5, 5), vendor_name='Landlord',
            subtotal=Decimal('50000'), tax_cgst=Decimal('4500'),
            tax_sgst=Decimal('4500'), total_amount=Decimal('59000'),
            location_id=1,
        )
        BillLine.objects.create(bill=self.bill, account=self.rent,
                                amount=Decimal('50000'), description='April rent')

    def test_post_bill_creates_je_and_marks_open(self):
        post_bill(self.bill)
        self.bill.refresh_from_db()
        self.assertIsNotNone(self.bill.journal_entry)
        self.assertTrue(self.bill.journal_entry.is_posted)
        self.assertEqual(self.bill.status, 'open')

    def test_record_payment_partial(self):
        post_bill(self.bill)
        record_payment(self.bill, date=date(2026, 4, 20),
                       amount=Decimal('20000'), mode='bank',
                       reference='UTR-1')
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.amount_paid, Decimal('20000'))
        self.assertEqual(self.bill.status, 'partially_paid')

    def test_record_payment_full(self):
        post_bill(self.bill)
        record_payment(self.bill, date=date(2026, 4, 20),
                       amount=Decimal('59000'), mode='bank')
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, 'paid')

    def test_record_overpayment_rejected(self):
        from django.core.exceptions import ValidationError
        post_bill(self.bill)
        with self.assertRaises(ValidationError):
            record_payment(self.bill, date=date(2026, 4, 20),
                           amount=Decimal('100000'), mode='bank')

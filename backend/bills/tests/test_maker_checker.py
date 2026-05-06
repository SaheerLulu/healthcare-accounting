"""Tests for maker-checker bill approval workflow."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from bills.models import Bill, BillLine
from bills.services import post_bill
from core.models import AccountingSettings, ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings


class MakerCheckerTests(TestCase):
    def setUp(self):
        coa = seed_chart_and_mappings()
        make_settings()
        self.rent = ChartOfAccount.objects.get(account_code='5410')

    def _make_bill(self, total):
        bill = Bill.objects.create(
            bill_no=f'V-{int(total)}', bill_date=date(2026, 4, 5),
            vendor_id=1, vendor_name='Acme', total_amount=Decimal(str(total)),
            location_id=1,
        )
        BillLine.objects.create(bill=bill, account=self.rent,
                                amount=Decimal(str(total)))
        return bill

    def test_no_threshold_means_no_approval_required(self):
        # Default threshold = 0 → any bill posts directly
        bill = self._make_bill(100000)
        post_bill(bill)
        bill.refresh_from_db()
        self.assertEqual(bill.status, 'open')

    def test_below_threshold_posts_directly(self):
        s = AccountingSettings.get_settings()
        s.bill_approval_threshold = Decimal('50000')
        s.save()
        bill = self._make_bill(20000)
        post_bill(bill)
        bill.refresh_from_db()
        self.assertEqual(bill.status, 'open')

    def test_above_threshold_blocks_until_approved(self):
        from django.core.exceptions import ValidationError
        s = AccountingSettings.get_settings()
        s.bill_approval_threshold = Decimal('50000')
        s.save()
        bill = self._make_bill(75000)
        with self.assertRaises(ValidationError):
            post_bill(bill)
        # After approval, posting succeeds
        bill.approval_status = 'approved'
        bill.save()
        post_bill(bill)
        bill.refresh_from_db()
        self.assertEqual(bill.status, 'open')

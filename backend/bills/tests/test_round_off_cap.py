"""Regression test for L3: a vendor bill whose total doesn't tie to lines+tax
must be rejected, not silently dumped into ROUND_OFF (which inflates/deflates
Trade Payables). Sub-rupee rounding is still absorbed.
"""
from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from bills.models import Bill, BillLine
from bills.services import post_bill
from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings


class BillRoundOffCapTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.exp = ChartOfAccount.objects.get(account_code='5410')

    def _bill(self, total, line_amt, bill_no):
        # vendor_id None → generic Trade Payables control (no party-ledger setup).
        bill = Bill.objects.create(
            vendor_name='Utility Co', bill_no=bill_no,
            bill_date=date(2026, 4, 1), due_date=date(2026, 5, 1),
            subtotal=Decimal(line_amt), total_amount=Decimal(total), location_id=1)
        BillLine.objects.create(bill=bill, account=self.exp, amount=Decimal(line_amt),
                                description='service')
        return bill

    def test_large_total_mismatch_rejected(self):
        bill = self._bill(total='1500', line_amt='1000', bill_no='B-1')  # off by 500
        with self.assertRaises(ValidationError):
            post_bill(bill)

    def test_sub_rupee_rounding_absorbed(self):
        bill = self._bill(total='1000.50', line_amt='1000', bill_no='B-2')  # off by 0.50
        je = post_bill(bill)
        self.assertTrue(je.is_posted)
        self.assertIn('6100', {l.account.account_code for l in je.lines.all()})

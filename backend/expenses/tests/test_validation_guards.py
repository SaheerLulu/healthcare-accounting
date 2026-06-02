"""Regression tests for two expense defects:

  M13 — the expense total was trusted from the client and any mismatch vs
        items+tax was silently dumped into ROUND_OFF (6100); it's now capped.
  M14 — GST input credit was claimed with no identified supplier; it now needs
        a vendor + invoice reference (the model has no GSTIN field).
"""
from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from expenses.models import Expense, ExpenseItem
from expenses.serializers import ExpenseWriteSerializer
from expenses.services import record_expense


class ExpenseRoundOffCapTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.bank = ChartOfAccount.objects.get(account_code='1120')
        self.rent = ChartOfAccount.objects.get(account_code='5410')

    def _expense(self, total, item_amt):
        exp = Expense.objects.create(
            expense_date=date(2026, 4, 1), paid_through_account=self.bank,
            total_amount=Decimal(total), location_id=1, vendor_name='Acme')
        ExpenseItem.objects.create(
            expense=exp, account=self.rent, amount=Decimal(item_amt), description='svc')
        return exp

    def test_large_total_mismatch_rejected(self):
        exp = self._expense(total='1500', item_amt='1000')  # off by 500
        with self.assertRaises(ValidationError):
            record_expense(exp)

    def test_sub_rupee_rounding_absorbed(self):
        exp = self._expense(total='1000.50', item_amt='1000')  # off by 0.50
        je = record_expense(exp)
        self.assertTrue(je.is_posted)
        self.assertIn('6100', {l.account.account_code for l in je.lines.all()})


class ExpenseITCGuardTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.bank = ChartOfAccount.objects.get(account_code='1120')
        self.rent = ChartOfAccount.objects.get(account_code='5410')

    def _ser(self, **over):
        data = {
            'expense_date': '2026-04-01', 'paid_through_account': self.bank.id,
            'total_amount': '1180', 'location_id': 1,
            'items': [{'account': self.rent.id, 'description': 'x', 'amount': '1000'}],
        }
        data.update(over)
        return ExpenseWriteSerializer(data=data)

    def test_gst_without_supplier_rejected(self):
        ser = self._ser(tax_cgst='90', tax_sgst='90')
        self.assertFalse(ser.is_valid())

    def test_gst_without_reference_rejected(self):
        ser = self._ser(tax_cgst='90', tax_sgst='90', vendor_name='Acme Ltd')
        self.assertFalse(ser.is_valid())

    def test_gst_with_supplier_and_reference_ok(self):
        ser = self._ser(tax_cgst='90', tax_sgst='90', vendor_name='Acme Ltd', reference='INV-9')
        self.assertTrue(ser.is_valid(), ser.errors)

    def test_no_gst_needs_no_supplier(self):
        ser = self._ser(total_amount='1000')  # no tax fields
        self.assertTrue(ser.is_valid(), ser.errors)

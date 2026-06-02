"""Regression tests for the systemic serializer/exception-handler fixes:

  RC3 — custom DRF exception handler maps Django ValidationError → 400.
  RC2 — server-side validation the UI used to be the only thing enforcing:
        expense line must be EXPENSE / paid-through must be Bank-Cash (H4),
        account mapping must point at a leaf+active account (H22),
        loan GLs must be the right type (H19), asset cost sane (H8),
        financial-year-start month in 1..12 (H20).
"""
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.test import TestCase

from core.exception_handler import custom_exception_handler
from core.models import ChartOfAccount
from core.serializers import AccountingSettingsSerializer, AccountMappingSerializer
from core.tests.utils import make_settings, seed_chart_and_mappings


class ExceptionHandlerTests(TestCase):
    def test_django_validation_error_becomes_400(self):
        resp = custom_exception_handler(
            DjangoValidationError('Period 2025-04 is locked.'), {})
        self.assertIsNotNone(resp)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Period 2025-04 is locked.')

    def test_validation_error_dict_preserved(self):
        resp = custom_exception_handler(
            DjangoValidationError({'date': ['locked']}), {})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('date', resp.data['detail'])

    def test_unknown_exception_not_swallowed(self):
        # A genuine bug must stay a 500 (handler returns None → default 500).
        self.assertIsNone(custom_exception_handler(KeyError('boom'), {}))


class SerializerGuardTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()

    # ── H22: account mappings must point at a postable leaf ──
    def test_mapping_to_group_account_rejected(self):
        group = ChartOfAccount.objects.get(account_code='5700')  # Indirect Expenses (non-leaf)
        ser = AccountMappingSerializer(data={'key': 'SALARY_EXPENSE', 'account': group.id})
        self.assertFalse(ser.is_valid())
        self.assertIn('account', ser.errors)

    def test_mapping_to_leaf_account_ok(self):
        leaf = ChartOfAccount.objects.get(account_code='5410')
        ser = AccountMappingSerializer(data={'key': 'RENT_EXPENSE', 'account': leaf.id})
        self.assertTrue(ser.is_valid(), ser.errors)

    # ── H20: FY-start month range ──
    def test_fy_start_month_out_of_range_rejected(self):
        ser = AccountingSettingsSerializer(data={'financial_year_start': 13}, partial=True)
        self.assertFalse(ser.is_valid())
        self.assertIn('financial_year_start', ser.errors)

    def test_fy_start_month_valid(self):
        ser = AccountingSettingsSerializer(data={'financial_year_start': 4}, partial=True)
        self.assertTrue(ser.is_valid(), ser.errors)


class ExpenseSerializerGuardTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()

    def _payload(self, item_code, paid_code, **over):
        data = {
            'expense_date': '2026-04-10',
            'paid_through_account': ChartOfAccount.objects.get(account_code=paid_code).id,
            'total_amount': '100.00', 'location_id': 1,
            'items': [{'account': ChartOfAccount.objects.get(account_code=item_code).id,
                       'description': 'x', 'amount': '100.00'}],
        }
        data.update(over)
        from expenses.serializers import ExpenseWriteSerializer
        return ExpenseWriteSerializer(data=data)

    def test_expense_line_to_non_expense_account_rejected(self):
        # 2110 Trade Payables is a LIABILITY, not an expense — must reject (H4).
        ser = self._payload(item_code='2110', paid_code='1120')
        self.assertFalse(ser.is_valid())

    def test_paid_through_must_be_bank_or_cash(self):
        # Paid-through 5410 (Rent, EXPENSE) is not Bank/Cash — must reject.
        ser = self._payload(item_code='5410', paid_code='5410')
        self.assertFalse(ser.is_valid())

    def test_valid_expense_ok(self):
        ser = self._payload(item_code='5410', paid_code='1120')  # Rent via Bank
        self.assertTrue(ser.is_valid(), ser.errors)


class LoanSerializerGuardTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()

    def _payload(self, liability_code, interest_code):
        from loans.serializers import LoanSerializer
        return LoanSerializer(data={
            'loan_no': 'LN-X', 'lender_name': 'HDFC', 'loan_type': 'term',
            'principal_amount': '100000', 'interest_rate_pct': '10',
            'tenure_months': 12, 'start_date': '2026-04-01', 'emi_day': 5,
            'liability_account': ChartOfAccount.objects.get(account_code=liability_code).id,
            'interest_expense_account': ChartOfAccount.objects.get(account_code=interest_code).id,
        })

    def test_liability_account_wrong_type_rejected(self):
        # 5410 (EXPENSE) as the loan liability — must reject (H19).
        ser = self._payload(liability_code='5410', interest_code='5410')
        self.assertFalse(ser.is_valid())
        self.assertIn('liability_account', ser.errors)

    def test_interest_account_wrong_type_rejected(self):
        # 2110 (LIABILITY) as interest expense — must reject.
        ser = self._payload(liability_code='2110', interest_code='2110')
        self.assertFalse(ser.is_valid())
        self.assertIn('interest_expense_account', ser.errors)

    def test_valid_loan_accounts_ok(self):
        ser = self._payload(liability_code='2110', interest_code='5410')
        self.assertTrue(ser.is_valid(), ser.errors)


class FixedAssetSerializerGuardTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def test_negative_cost_rejected(self):
        from fixed_assets.serializers import FixedAssetSerializer
        ser = FixedAssetSerializer(data={'acquisition_cost': '-5000'}, partial=True)
        self.assertFalse(ser.is_valid())
        self.assertIn('acquisition_cost', ser.errors)

    def test_salvage_above_cost_rejected(self):
        from fixed_assets.serializers import FixedAssetSerializer
        ser = FixedAssetSerializer(
            data={'acquisition_cost': '1000', 'salvage_value': '2000'}, partial=True)
        self.assertFalse(ser.is_valid())
        self.assertIn('salvage_value', ser.errors)

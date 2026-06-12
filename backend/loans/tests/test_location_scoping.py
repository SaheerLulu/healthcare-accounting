"""Cross-store guard on EMI payment (security audit 2026-06-12).

EMIPayView used to resolve any EMI by pk and post the payment JE into the
loan's store without checking the caller may act on that location.
"""
from datetime import date
from decimal import Decimal
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from core.models import ChartOfAccount
from core.tests.utils import (
    make_admin, make_settings, make_user, seed_chart_and_mappings,
)
from loans.models import Loan
from loans.services import generate_schedule, post_disbursement


def _make_loan(loan_no, location_id):
    liab, _ = ChartOfAccount.objects.get_or_create(
        account_code='2300',
        defaults=dict(account_name='HDFC Term Loan', account_type='LIABILITY',
                      account_subtype='Payable', is_leaf=True),
    )
    interest = ChartOfAccount.objects.get(account_code='5451')
    loan = Loan.objects.create(
        loan_no=loan_no, lender_name='HDFC', loan_type='term',
        principal_amount=Decimal('120000'),
        interest_rate_pct=Decimal('12'),
        tenure_months=12,
        start_date=date(2026, 4, 1), end_date=date(2027, 4, 5),
        emi_day=5, emi_amount=Decimal('10661.85'),
        location_id=location_id,
        liability_account=liab, interest_expense_account=interest,
    )
    generate_schedule(loan)
    post_disbursement(loan)
    return loan


class EMIPayLocationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_chart_and_mappings()
        make_settings()
        cls.admin = make_admin()

    def setUp(self):
        self.client = APIClient()

    def _pay(self, emi):
        return self.client.post('/api/loans/emi/', {'emi_id': emi.id},
                                format='json')

    def test_store_a_user_cannot_pay_store_b_emi(self):
        loan = _make_loan('LN-S2', location_id=2)
        emi = loan.emi_schedule.order_by('installment_no').first()
        self.client.force_authenticate(make_user(username='clerk1'))
        # clerk1 is assigned to store 1 only.
        with mock.patch('core.mixins.user_can_access_location',
                        lambda user, loc: int(loc) == 1):
            resp = self._pay(emi)
        self.assertEqual(resp.status_code, 403, resp.data)
        emi.refresh_from_db()
        self.assertEqual(emi.status, 'pending')

    def test_store_a_user_can_pay_own_store_emi(self):
        loan = _make_loan('LN-S1', location_id=1)
        emi = loan.emi_schedule.order_by('installment_no').first()
        self.client.force_authenticate(make_user(username='clerk2'))
        with mock.patch('core.mixins.user_can_access_location',
                        lambda user, loc: int(loc) == 1):
            resp = self._pay(emi)
        self.assertEqual(resp.status_code, 200, resp.data)
        emi.refresh_from_db()
        self.assertEqual(emi.status, 'paid')

    def test_admin_can_pay_any_store(self):
        loan = _make_loan('LN-S3', location_id=2)
        emi = loan.emi_schedule.order_by('installment_no').first()
        self.client.force_authenticate(self.admin)
        resp = self._pay(emi)
        self.assertEqual(resp.status_code, 200, resp.data)

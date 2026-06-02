"""Regression test for CRITICAL C5: creating a loan 500'd on every attempt.

emi_amount and end_date are NOT NULL with no DB default and read-only on the
serializer, so they were absent from validated_data. The view called
serializer.save() BEFORE computing them, so the INSERT put NULL into those
columns → IntegrityError → HTTP 500 for every loan create (feature unusable).
The fix computes them first and passes them into save().
"""
import json
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.models import ChartOfAccount
from core.tests.utils import make_admin, make_settings, seed_chart_and_mappings
from loans.models import Loan
from loans.views import LoanViewSet


class LoanCreateAPITests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _create(self, **overrides):
        liability = ChartOfAccount.objects.get(account_code='2110')   # LIABILITY leaf
        interest = ChartOfAccount.objects.get(account_code='5410')    # EXPENSE leaf
        payload = {
            'loan_no': 'LN-API-1', 'lender_name': 'HDFC Bank', 'loan_type': 'term',
            'principal_amount': '1000000', 'interest_rate_pct': '12',
            'tenure_months': 36, 'start_date': '2026-04-01', 'emi_day': 5,
            'liability_account': liability.id,
            'interest_expense_account': interest.id,
        }
        payload.update(overrides)
        request = self.factory.post(
            '/api/loans/loans/', data=json.dumps(payload), content_type='application/json',
        )
        force_authenticate(request, self.admin)
        return LoanViewSet.as_view({'post': 'create'})(request)

    def test_create_returns_201_and_computes_emi_and_schedule(self):
        resp = self._create()
        self.assertEqual(resp.status_code, 201, getattr(resp, 'data', None))

        loan = Loan.objects.get(loan_no='LN-API-1')
        # ₹10,00,000 @ 12% / 36m → EMI ≈ 33,214.31 (matches test_emi).
        self.assertEqual(loan.emi_amount, Decimal('33214.31'))
        # end_date = start + 36 months, on emi_day → 2029-04-05.
        self.assertEqual(loan.end_date, date(2029, 4, 5))
        # Amortization schedule generated immediately.
        self.assertEqual(loan.emi_schedule.count(), 36)
        last = loan.emi_schedule.order_by('-installment_no').first()
        self.assertEqual(last.balance_principal, Decimal('0.00'))

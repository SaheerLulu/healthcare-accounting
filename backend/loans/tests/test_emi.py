"""Tests for EMI calculation, schedule generation, and payment posting."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from loans.models import Loan
from loans.services import (
    compute_emi, generate_schedule, pay_emi, post_disbursement,
)


class EMIComputationTests(TestCase):
    def test_emi_basic(self):
        # ₹10,00,000 @ 12% for 36 months → EMI ≈ 33,214
        emi = compute_emi(Decimal('1000000'), Decimal('12'), 36)
        self.assertEqual(emi, Decimal('33214.31'))

    def test_emi_zero_interest(self):
        # ₹120000 / 12 → 10000
        emi = compute_emi(Decimal('120000'), Decimal('0'), 12)
        self.assertEqual(emi, Decimal('10000.00'))

    def test_emi_zero_tenure_raises(self):
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            compute_emi(Decimal('100000'), Decimal('10'), 0)


def _seed_loan_accounts(coa):
    """Add the lender-specific liability account a loan needs. The canonical
    CoA (seeded by migration 0016) already provides 5451 'Interest on Loans'
    as a leaf with the INTEREST_EXPENSE mapping — reuse it rather than
    creating a duplicate code that shadows the parent 5500 'Direct Expenses'.
    """
    ChartOfAccount.objects.get_or_create(
        account_code='2300',
        defaults=dict(account_name='HDFC Term Loan', account_type='LIABILITY',
                      account_subtype='Payable', is_leaf=True),
    )


class LoanLifecycleTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        coa = {a.account_code: a for a in ChartOfAccount.objects.all()}
        _seed_loan_accounts(coa)
        coa = {a.account_code: a for a in ChartOfAccount.objects.all()}
        self.loan = Loan.objects.create(
            loan_no='LN-001', lender_name='HDFC',
            loan_type='term',
            principal_amount=Decimal('1000000'),
            interest_rate_pct=Decimal('12'),
            tenure_months=36,
            start_date=date(2026, 4, 1),
            end_date=date(2029, 4, 1),
            emi_day=5,
            emi_amount=Decimal('33214.31'),
            location_id=1,
            liability_account=coa['2300'],
            interest_expense_account=coa['5451'],
        )

    def test_generate_schedule_creates_36_rows(self):
        n = generate_schedule(self.loan)
        self.assertEqual(n, 36)
        self.assertEqual(self.loan.emi_schedule.count(), 36)

    def test_schedule_balance_zero_at_end(self):
        generate_schedule(self.loan)
        last = self.loan.emi_schedule.order_by('-installment_no').first()
        self.assertEqual(last.balance_principal, Decimal('0.00'))

    def test_disbursement_je(self):
        je = post_disbursement(self.loan)
        self.assertTrue(je.is_posted)
        self.loan.refresh_from_db()
        self.assertEqual(self.loan.disbursement_journal_entry_id, je.id)

    def test_pay_emi_splits_principal_and_interest(self):
        generate_schedule(self.loan)
        post_disbursement(self.loan)
        first_emi = self.loan.emi_schedule.order_by('installment_no').first()
        # First EMI: interest ≈ 1000000 * 0.01 = 10000, principal ≈ 23214
        self.assertEqual(first_emi.interest, Decimal('10000.00'))
        je = pay_emi(first_emi)
        first_emi.refresh_from_db()
        self.assertEqual(first_emi.status, 'paid')
        self.assertIsNotNone(first_emi.journal_entry)

    def test_loan_auto_closes_after_last_emi(self):
        generate_schedule(self.loan)
        post_disbursement(self.loan)
        for emi in self.loan.emi_schedule.order_by('installment_no'):
            pay_emi(emi)
        self.loan.refresh_from_db()
        self.assertEqual(self.loan.status, 'closed')

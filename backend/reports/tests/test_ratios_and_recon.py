"""Tests for the ratio-analysis report and bank reconciliation summary."""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from banking.models import BankAccount, BankTransaction, Cheque
from core.models import ChartOfAccount
from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from reports.views import BankReconciliationSummaryView, FinancialRatiosView


class RatioReportTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        cash = ChartOfAccount.objects.get(account_code='1110')
        sales = ChartOfAccount.objects.get(account_code='4100')
        purchases = ChartOfAccount.objects.get(account_code='5100')
        payables = ChartOfAccount.objects.get(account_code='2110')
        recv = ChartOfAccount.objects.get(account_code='1130')
        # Revenue ₹10L, Purchases ₹6L, AR ₹2L, AP ₹3L
        make_journal_entry(d=date(2025, 6, 1), lines=[
            (cash, Decimal('1000000'), Decimal('0')),
            (sales, Decimal('0'), Decimal('1000000')),
        ])
        make_journal_entry(d=date(2025, 7, 1), lines=[
            (purchases, Decimal('600000'), Decimal('0')),
            (payables, Decimal('0'), Decimal('600000')),
        ])
        make_journal_entry(d=date(2025, 8, 1), lines=[
            (recv, Decimal('200000'), Decimal('0'),  # Customer party tagged
              ),
            (sales, Decimal('0'), Decimal('200000')),
        ])

    def test_ratio_report_returns_structure(self):
        factory = APIRequestFactory()
        req = factory.get('/api/reports/financial-ratios/?start_date=2025-04-01&end_date=2026-03-31')
        force_authenticate(req, user=self.admin)
        response = FinancialRatiosView.as_view()(req)
        self.assertEqual(response.status_code, 200)
        for section in ('profitability', 'liquidity', 'activity_days', 'leverage', 'figures'):
            self.assertIn(section, response.data)

    def test_gp_pct_calculation(self):
        factory = APIRequestFactory()
        req = factory.get('/api/reports/financial-ratios/?start_date=2025-04-01&end_date=2026-03-31')
        force_authenticate(req, user=self.admin)
        response = FinancialRatiosView.as_view()(req)
        # Revenue 1.2M (1M cash + 200K AR sale), Purchases 600K → GP% = 600K/1.2M = 50%
        self.assertEqual(response.data['profitability']['gross_profit_pct'], 50.0)

    def test_zero_division_safe(self):
        factory = APIRequestFactory()
        # Empty period
        req = factory.get('/api/reports/financial-ratios/?start_date=2030-04-01&end_date=2030-04-30')
        force_authenticate(req, user=self.admin)
        response = FinancialRatiosView.as_view()(req)
        self.assertEqual(response.status_code, 200)
        # No revenue → GP% should be None, not crash
        self.assertIsNone(response.data['profitability']['gross_profit_pct'])


class BankReconSummaryTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        bank_acct = ChartOfAccount.objects.get(account_code='1120')
        self.account = BankAccount.objects.create(
            name='HDFC Current', account_number='12345',
            ifsc='HDFC0000001', chart_account=bank_acct, location_id=1,
        )
        # Book a payment that's still un-cleared
        cash = ChartOfAccount.objects.get(account_code='1120')
        payable = ChartOfAccount.objects.get(account_code='2110')
        je = make_journal_entry(d=date(2026, 4, 1), lines=[
            (payable, Decimal('5000'), Decimal('0')),
            (cash, Decimal('0'), Decimal('5000')),
        ])
        Cheque.objects.create(
            cheque_no='000100', kind='issued', bank_account=self.account,
            cheque_date=date(2026, 4, 1), amount=Decimal('5000'),
            party_type='Supplier', party_id=1, party_name='Vendor',
            journal_entry=je, status='pending',
        )

    def test_uncleared_cheque_in_summary(self):
        factory = APIRequestFactory()
        req = factory.get('/api/reports/bank-recon-summary/')
        force_authenticate(req, user=self.admin)
        response = BankReconciliationSummaryView.as_view()(req)
        self.assertEqual(response.status_code, 200)
        row = response.data['rows'][0]
        self.assertEqual(row['uncleared_cheques_issued'], '5000')

    def test_clean_when_no_unmatched(self):
        factory = APIRequestFactory()
        req = factory.get('/api/reports/bank-recon-summary/')
        force_authenticate(req, user=self.admin)
        response = BankReconciliationSummaryView.as_view()(req)
        # No bank transactions imported, so unmatched count = 0
        row = response.data['rows'][0]
        self.assertEqual(row['unmatched_bank_txns'], '0')

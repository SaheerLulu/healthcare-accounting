"""Smoke tests for the new MSME compliance + Cash Flow Statement reports."""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.models import ChartOfAccount
from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from parties.models import PartyMetadata
from reports.views import CashFlowStatementView, MSMEComplianceReportView


class MSMEReportTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        # Mark supplier 7 as MSME-Micro
        PartyMetadata.objects.create(
            party_type='Supplier', party_id=7,
            msme_category='micro', msme_udyam_no='UDYAM-MH-12-0000007',
            msme_credit_period_days=45,
        )
        # Create a payable JE 90 days old → 45 days overdue
        payable = ChartOfAccount.objects.get(account_code='2110')
        cash = ChartOfAccount.objects.get(account_code='1110')
        make_journal_entry(d=date(2026, 1, 5), lines=[
            (cash, Decimal('100000'), Decimal('0')),
            (payable, Decimal('0'), Decimal('100000')),
        ], voucher_type='PURCHASE')
        # Tag the credit line with party_id=7
        from journals.models import JournalEntryLine
        line = JournalEntryLine.objects.filter(account=payable, credit__gt=0).last()
        line.party_type = 'Supplier'
        line.party_id = 7
        line.save()

    def test_msme_report_returns_overdue_supplier(self):
        factory = APIRequestFactory()
        request = factory.get('/api/reports/msme-compliance/?as_of=2026-04-05')
        force_authenticate(request, user=self.admin)
        response = MSMEComplianceReportView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        row = response.data['rows'][0]
        self.assertEqual(row['supplier_id'], 7)
        # 90 days outstanding - 45 credit days = 45 days interest @ 19.5% on 100000
        # = 100000 * 0.195 * 45 / 365 ≈ 2404
        self.assertGreater(Decimal(row['interest_payable_s16']), Decimal('2000'))


class CashFlowReportTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        # Net profit setup: revenue 50000, expense 20000 → NP 30000
        cash = ChartOfAccount.objects.get(account_code='1110')
        sales = ChartOfAccount.objects.get(account_code='4100')
        rent = ChartOfAccount.objects.get(account_code='5410')
        make_journal_entry(d=date(2025, 6, 1), lines=[
            (cash, Decimal('50000'), Decimal('0')),
            (sales, Decimal('0'), Decimal('50000')),
        ])
        make_journal_entry(d=date(2025, 7, 1), lines=[
            (rent, Decimal('20000'), Decimal('0')),
            (cash, Decimal('0'), Decimal('20000')),
        ])

    def test_cash_flow_smoke(self):
        factory = APIRequestFactory()
        request = factory.get('/api/reports/cash-flow/?start_date=2025-04-01&end_date=2026-03-31')
        force_authenticate(request, user=self.admin)
        response = CashFlowStatementView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertIn('operating', response.data)
        self.assertIn('investing', response.data)
        self.assertIn('financing', response.data)
        # Operating subtotal includes net profit 30000 (no WC changes here)
        self.assertEqual(Decimal(response.data['operating']['net_profit']),
                         Decimal('30000'))

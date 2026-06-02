"""Regression tests for two reporting defects:

  H28 — the ledger drill-down (called without a page param) forced Opening
        Balance to 0, understating every running/closing balance for any account
        with prior-period activity.
  H29 — aging buckets used gross invoice amounts and never netted partial
        payments, so they overstated overdue and didn't sum to outstanding.
"""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.models import ChartOfAccount
from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from journals.models import JournalEntry, JournalEntryLine
from reports.views import LedgerView, PartyOutstandingView, _age_open_invoices


class LedgerOpeningBalanceTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def test_opening_balance_applied_without_page_param(self):
        cash, sales = self.coa['1110'], self.coa['4100']
        # Prior-period activity (before the window start).
        make_journal_entry(d=date(2026, 3, 15), lines=[
            (cash, Decimal('1000'), Decimal('0')),
            (sales, Decimal('0'), Decimal('1000')),
        ])
        # In-window activity.
        make_journal_entry(d=date(2026, 4, 10), lines=[
            (cash, Decimal('500'), Decimal('0')),
            (sales, Decimal('0'), Decimal('500')),
        ])
        request = self.factory.get('/api/reports/ledger/', {
            'account_code': '1110', 'start_date': '2026-04-01', 'end_date': '2026-04-30',
        })
        force_authenticate(request, self.admin)
        resp = LedgerView.as_view()(request)

        self.assertEqual(Decimal(resp.data['opening_balance']), Decimal('1000.00'))
        self.assertEqual(Decimal(resp.data['closing_balance']), Decimal('1500.00'))
        self.assertEqual(len(resp.data['transactions']), 1)  # only the in-window line


class AgingHelperTests(TestCase):
    def test_fifo_nets_payment_against_oldest_invoice(self):
        as_of = date(2026, 4, 15)
        # Old ₹6,000 (≈120d) + new ₹4,000 (10d); a ₹6,000 payment clears the old.
        invoices = [
            (date(2025, 12, 16), Decimal('6000')),
            (date(2026, 4, 5), Decimal('4000')),
        ]
        buckets = _age_open_invoices(invoices, Decimal('6000'), as_of)
        self.assertEqual(buckets['90_plus'], Decimal('0'))   # old invoice settled
        self.assertEqual(buckets['0_30'], Decimal('4000'))   # new invoice still open
        self.assertEqual(sum(buckets.values()), Decimal('4000'))

    def test_partial_payment_reduces_oldest_first(self):
        as_of = date(2026, 4, 15)
        invoices = [(date(2025, 12, 16), Decimal('10000'))]
        buckets = _age_open_invoices(invoices, Decimal('6000'), as_of)
        self.assertEqual(buckets['90_plus'], Decimal('4000'))  # 10000 - 6000


class PartyOutstandingAgingTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _invoice_then_receipt(self):
        recv, sales, cash = self.coa['1130'], self.coa['4100'], self.coa['1110']
        inv = JournalEntry.objects.create(
            date=date(2026, 1, 1), voucher_type='SALE',
            reference_type='Manual', location_id=1)
        JournalEntryLine.objects.create(
            entry=inv, account=recv, debit=Decimal('10000'),
            party_type='Customer', party_id=1)
        JournalEntryLine.objects.create(entry=inv, account=sales, credit=Decimal('10000'))
        inv.post()

        rcpt = JournalEntry.objects.create(
            date=date(2026, 4, 1), voucher_type='RECEIPT',
            reference_type='Manual', location_id=1)
        JournalEntryLine.objects.create(entry=rcpt, account=cash, debit=Decimal('6000'))
        JournalEntryLine.objects.create(
            entry=rcpt, account=recv, credit=Decimal('6000'),
            party_type='Customer', party_id=1)
        rcpt.post()

    def test_buckets_net_partial_payment_and_sum_to_outstanding(self):
        self._invoice_then_receipt()
        request = self.factory.get('/api/reports/party-outstanding/', {
            'party_type': 'Customer', 'date': '2026-04-15',
        })
        force_authenticate(request, self.admin)
        with patch('inventory_reader.models.CustomerRO') as MockCust:
            MockCust.objects.get.return_value = SimpleNamespace(customer_name='Acme')
            resp = PartyOutstandingView.as_view()(request)

        rows = resp.data['rows']
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(Decimal(row['closing_balance']), Decimal('4000'))
        buckets = sum(
            Decimal(row[k]) for k in
            ('aging_0_30', 'aging_31_60', 'aging_61_90', 'aging_90_plus')
        )
        self.assertEqual(buckets, Decimal('4000'))            # net, NOT the gross 10000
        # Invoice dated 2026-01-01, as-of 2026-04-15 → >90 days.
        self.assertEqual(Decimal(row['aging_90_plus']), Decimal('4000'))

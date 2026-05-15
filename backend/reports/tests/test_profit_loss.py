"""End-to-end P&L verification for single-mode perpetual inventory.

Posts a deterministic set of journal entries (purchase → 1190; sale → Sales
credit + COGS debit / 1190 credit) and asserts /api/reports/profit-loss/
returns the expected numbers. The assertions break if anything reintroduces
the periodic-mode codepath that crediting 5100 Purchases used to inflate
net profit through.
"""
from datetime import date
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from core.tests.utils import make_settings, seed_chart_and_mappings, make_user
from journals.models import JournalEntry, JournalEntryLine
from core.models import ChartOfAccount


def _post(entry_date, voucher_type, lines, *, ref_type='Manual', ref_id=None,
          location_id=1):
    """Create + post a balanced JE from a list of (code, debit, credit)."""
    entry = JournalEntry.objects.create(
        date=entry_date, voucher_type=voucher_type, reference_type=ref_type,
        reference_id=ref_id, location_id=location_id,
    )
    for code, dr, cr in lines:
        acct = ChartOfAccount.objects.get(account_code=code)
        JournalEntryLine.objects.create(entry=entry, account=acct,
                                        debit=dr, credit=cr)
    entry.post()
    return entry


class ProfitLossPerpetualTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        user = make_user()

        self.client = APIClient()
        self.client.force_authenticate(user=user)

        # Purchase: Dr 1190 Closing Stock 1000 / Cr 2110 Trade Payables 1000.
        _post(date(2026, 4, 5), 'PURCHASE', [
            ('1190', Decimal('1000.00'), Decimal('0')),
            ('2110', Decimal('0'), Decimal('1000.00')),
        ])

        # Sale: Dr 1130 Receivables 1500 / Cr 4100 Sales POS 1500;
        # plus COGS leg Dr 5560 700 / Cr 1190 700.
        _post(date(2026, 4, 15), 'SALE', [
            ('1130', Decimal('1500.00'), Decimal('0')),
            ('4100', Decimal('0'), Decimal('1500.00')),
            ('5560', Decimal('700.00'), Decimal('0')),
            ('1190', Decimal('0'), Decimal('700.00')),
        ])

    def test_net_profit_equals_revenue_minus_cogs(self):
        res = self.client.get('/api/reports/profit-loss/',
                              {'start_date': '2026-04-01', 'end_date': '2026-04-30'})
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()

        self.assertEqual(Decimal(data['revenue']['total']), Decimal('1500.00'),
                         'Total revenue = sale price')
        self.assertEqual(Decimal(data['expenses']['total']), Decimal('700.00'),
                         'Total expenses = COGS only')
        self.assertEqual(Decimal(data['net_profit']), Decimal('800.00'),
                         'Net profit = revenue (1500) − COGS (700) = 800')

    def test_5100_purchases_absent_from_pl(self):
        res = self.client.get('/api/reports/profit-loss/',
                              {'start_date': '2026-04-01', 'end_date': '2026-04-30'})
        data = res.json()
        codes = [item['account_code'] for item in data['expenses']['items']]
        self.assertNotIn('5100', codes,
                         '5100 Purchases must not appear in P&L — perpetual posts go to 1190')

    def test_balance_sheet_ties_with_pl(self):
        res = self.client.get('/api/reports/balance-sheet/',
                              {'date': '2026-04-30'})
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()

        # Net income on BS should match net profit on P&L.
        equity_items = data['equity']['items']
        cy = next((i for i in equity_items
                   if 'Current Year' in i.get('account_name', '')), None)
        self.assertIsNotNone(cy, 'Current Year Profit/(Loss) row must appear in equity')
        self.assertEqual(Decimal(cy['balance']), Decimal('800.00'),
                         'BS net income must match P&L net profit')

        # The accounting equation must hold.
        self.assertTrue(data['is_balanced'], 'Balance Sheet must be balanced')

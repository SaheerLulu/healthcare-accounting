"""Tests for inventory adjustment, drug expiry write-off, and stock transfer."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine
from journals.services import JournalAutoGenerationService


def _seed_extra_accounts():
    for code, (name, atype, sub) in [
        ('1190', ('Closing Stock', 'ASSET', 'Cash')),
        ('1191', ('Stock In Transit', 'ASSET', 'Cash')),
        ('5510', ('Inventory Loss', 'EXPENSE', 'Other_Expense')),
        ('5520', ('Expired Stock Write-off', 'EXPENSE', 'Other_Expense')),
    ]:
        ChartOfAccount.objects.get_or_create(
            account_code=code,
            defaults=dict(account_name=name, account_type=atype,
                          account_subtype=sub, is_leaf=True),
        )
    from core.models import AccountMapping
    for key, code in [('CLOSING_STOCK', '1190'),
                      ('STOCK_TRANSFER_TRANSIT', '1191'),
                      ('INVENTORY_LOSS', '5510'),
                      ('EXPIRY_LOSS', '5520')]:
        AccountMapping.objects.update_or_create(
            key=key,
            defaults={'account': ChartOfAccount.objects.get(account_code=code)},
        )


class InventoryAdjustmentTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        _seed_extra_accounts()
        self.svc = JournalAutoGenerationService()

    def test_shrinkage_with_itc_reversal_balances(self):
        je = self.svc.post_inventory_adjustment(
            date=date(2026, 4, 15), location_id=1,
            value=Decimal('10000'),
            adjustment_type='shrinkage',
            itc_to_reverse=Decimal('1800'),
        )
        from django.db.models import Sum
        agg = JournalEntryLine.objects.filter(entry=je).aggregate(
            d=Sum('debit'), c=Sum('credit'))
        self.assertEqual(agg['d'], agg['c'])

    def test_drug_expiry_writeoff_balances(self):
        je = self.svc.post_drug_expiry_writeoff(
            date=date(2026, 4, 15), location_id=1,
            value_at_cost=Decimal('5000'),
            itc_to_reverse=Decimal('900'),
        )
        from django.db.models import Sum
        agg = JournalEntryLine.objects.filter(entry=je).aggregate(
            d=Sum('debit'), c=Sum('credit'))
        self.assertEqual(agg['d'], agg['c'])
        # Expense account (5520) was debited
        self.assertTrue(JournalEntryLine.objects.filter(
            entry=je, account__account_code='5520').exists())

    def test_stock_transfer_creates_two_balanced_jes(self):
        result = self.svc.post_stock_transfer(
            date=date(2026, 4, 15), value=Decimal('20000'),
            from_location_id=1, to_location_id=2,
        )
        self.assertNotEqual(result['out_entry'].id, result['in_entry'].id)
        # In-transit account nets to zero across the pair
        from django.db.models import Sum
        from core.models import AccountMapping
        transit = AccountMapping.get_account('STOCK_TRANSFER_TRANSIT')
        net = JournalEntryLine.objects.filter(account=transit).aggregate(
            d=Sum('debit'), c=Sum('credit'))
        self.assertEqual(net['d'], net['c'])

    def test_stock_transfer_same_location_rejected(self):
        with self.assertRaises(ValueError):
            self.svc.post_stock_transfer(
                date=date(2026, 4, 15), value=Decimal('20000'),
                from_location_id=1, to_location_id=1,
            )

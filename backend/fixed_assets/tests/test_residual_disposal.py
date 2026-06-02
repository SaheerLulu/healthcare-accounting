"""Regression tests for two depreciation defects:

  M23 — the Schedule II residual (AssetClass.salvage_value_pct, default 5%) was
        never applied, so SLM/WDV depreciated assets all the way to zero.
  M25 — disposal gain/loss was posted into the depreciation-expense account,
        polluting depreciation totals; it now hits a dedicated Profit/Loss on
        Sale of Asset GL (4950 / 5482).
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from fixed_assets.models import DepreciationEntry
from fixed_assets.services import (
    compute_monthly_depreciation, dispose_asset, post_acquisition,
)
from fixed_assets.tests.test_depreciation import _make_asset, _make_asset_class


class _Base(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        for code, (name, atype, sub) in [
            ('1190', ('Closing Stock', 'ASSET', 'Cash')),
            ('2210', ('TCS Payable', 'LIABILITY', 'Payable')),
        ]:
            ChartOfAccount.objects.get_or_create(
                account_code=code,
                defaults=dict(account_name=name, account_type=atype,
                              account_subtype=sub, is_leaf=True))
        coa = {a.account_code: a for a in ChartOfAccount.objects.all()}
        self.cls = _make_asset_class(coa)        # salvage_value_pct = 5
        self.asset = _make_asset(self.cls)       # cost 60000, salvage_value 0


class ResidualFloorTests(_Base):
    def test_effective_salvage_falls_back_to_class_pct(self):
        self.assertEqual(self.asset.effective_salvage_value, Decimal('3000.00'))
        self.assertEqual(self.asset.depreciable_base, Decimal('57000.00'))

    def test_explicit_salvage_overrides_class_pct(self):
        asset = _make_asset(self.cls, asset_no='COMP-002', salvage_value=Decimal('10000'))
        self.assertEqual(asset.effective_salvage_value, Decimal('10000.00'))

    def test_depreciation_capped_at_residual(self):
        post_acquisition(self.asset)
        # Near-full depreciation: NBV 3300, residual 3000 → next charge ≤ 300.
        DepreciationEntry.objects.create(
            fixed_asset=self.asset, period='2025-04',
            amount=Decimal('56700'), method='SLM')
        amt = compute_monthly_depreciation(self.asset, period='2025-05')
        self.assertEqual(amt, Decimal('300.00'))


class DisposalAccountTests(_Base):
    def _seed_disposal_accounts(self):
        ChartOfAccount.objects.get_or_create(
            account_code='4950', defaults=dict(
                account_name='Profit on Sale of Asset', account_type='REVENUE',
                account_subtype='Other_Income', is_leaf=True))
        ChartOfAccount.objects.get_or_create(
            account_code='5482', defaults=dict(
                account_name='Loss on Sale of Asset', account_type='EXPENSE',
                account_subtype='Other_Expense', is_leaf=True))

    def test_gain_posts_to_profit_on_sale_not_depreciation(self):
        self._seed_disposal_accounts()
        post_acquisition(self.asset)
        je = dispose_asset(self.asset, disposal_date=date(2025, 5, 1),
                           proceeds=Decimal('70000'), mode='bank')  # gain 10000
        codes = {l.account.account_code: (l.debit, l.credit) for l in je.lines.all()}
        self.assertEqual(codes['4950'][1], Decimal('10000.00'))   # gain credited here
        self.assertNotIn('5410', codes)                            # NOT depreciation expense

    def test_loss_posts_to_loss_on_sale_not_depreciation(self):
        self._seed_disposal_accounts()
        post_acquisition(self.asset)
        je = dispose_asset(self.asset, disposal_date=date(2025, 5, 1),
                           proceeds=Decimal('50000'), mode='bank')  # loss 10000
        codes = {l.account.account_code: (l.debit, l.credit) for l in je.lines.all()}
        self.assertEqual(codes['5482'][0], Decimal('10000.00'))   # loss debited here
        self.assertNotIn('5410', codes)

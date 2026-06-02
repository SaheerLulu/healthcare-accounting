"""Tests for fixed-asset acquisition, monthly depreciation, and disposal."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from fixed_assets.models import AssetClass, DepreciationEntry, FixedAsset
from fixed_assets.services import (
    compute_monthly_depreciation, dispose_asset, post_acquisition,
    post_monthly_depreciation,
)


def _make_asset_class(coa, dep_method='SLM', life_years=5, wdv_rate=0):
    return AssetClass.objects.create(
        code='COMP', name='Computers', dep_method=dep_method,
        useful_life_years=life_years, wdv_rate_pct=Decimal(str(wdv_rate)),
        salvage_value_pct=Decimal('5'),
        asset_account=coa['1190'],         # using Closing Stock as asset proxy
        accum_dep_account=coa['2210'],     # TCS Payable proxy as contra
        dep_expense_account=coa['5410'],   # Rent expense proxy as expense
    )


def _make_asset(asset_class, **kw):
    defaults = dict(
        asset_no='COMP-001', name='Dell Laptop',
        asset_class=asset_class, location_id=1,
        acquisition_date=date(2025, 4, 1),
        acquisition_cost=Decimal('60000'),
        salvage_value=Decimal('0'),
    )
    defaults.update(kw)
    return FixedAsset.objects.create(**defaults)


class DepreciationComputationTests(TestCase):
    def setUp(self):
        coa = seed_chart_and_mappings()
        make_settings()
        # Seed the new chart codes that asset classes reference
        from core.models import AccountMapping
        for code, (name, atype, sub) in [
            ('1190', ('Closing Stock', 'ASSET', 'Cash')),
            ('2210', ('TCS Payable', 'LIABILITY', 'Payable')),
        ]:
            ChartOfAccount.objects.get_or_create(
                account_code=code,
                defaults=dict(account_name=name, account_type=atype,
                              account_subtype=sub, is_leaf=True),
            )
        coa = {a.account_code: a for a in ChartOfAccount.objects.all()}
        self.coa = coa
        self.cls = _make_asset_class(coa)
        self.asset = _make_asset(self.cls)

    def test_slm_monthly_amount(self):
        # Depreciable base nets the Schedule II 5% residual: (60000 - 3000) / 60
        # = 950/month (was naively 1000 before the residual floor was applied).
        amt = compute_monthly_depreciation(self.asset, period='2025-04')
        self.assertEqual(amt, Decimal('950.00'))

    def test_no_depreciation_before_acquisition(self):
        amt = compute_monthly_depreciation(self.asset, period='2025-03')
        self.assertEqual(amt, Decimal('0.00'))

    def test_wdv_decreases_over_time(self):
        wdv_class = AssetClass.objects.create(
            code='WDV', name='Test', dep_method='WDV',
            useful_life_years=5, wdv_rate_pct=Decimal('40'),
            asset_account=self.coa['1190'],
            accum_dep_account=self.coa['2210'],
            dep_expense_account=self.coa['5410'],
        )
        asset = _make_asset(wdv_class, asset_no='WDV-001')
        # First month on (NBV - 5% residual): (60000 - 3000) * 40 / 100 / 12 = 1900
        m1 = compute_monthly_depreciation(asset, period='2025-04')
        self.assertEqual(m1, Decimal('1900.00'))


class AcquisitionAndPostTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        from core.models import ChartOfAccount
        for code, (name, atype, sub) in [
            ('1190', ('Closing Stock', 'ASSET', 'Cash')),
            ('2210', ('TCS Payable', 'LIABILITY', 'Payable')),
        ]:
            ChartOfAccount.objects.get_or_create(
                account_code=code,
                defaults=dict(account_name=name, account_type=atype,
                              account_subtype=sub, is_leaf=True),
            )
        coa = {a.account_code: a for a in ChartOfAccount.objects.all()}
        self.coa = coa
        self.cls = _make_asset_class(coa)
        self.asset = _make_asset(self.cls)

    def test_post_acquisition_creates_balanced_je(self):
        je = post_acquisition(self.asset, payment_mode='bank')
        self.asset.refresh_from_db()
        self.assertEqual(self.asset.acquisition_journal_entry_id, je.id)
        self.assertTrue(je.is_posted)
        # Verify balance
        from journals.models import JournalEntryLine
        from django.db.models import Sum
        agg = JournalEntryLine.objects.filter(entry=je).aggregate(
            d=Sum('debit'), c=Sum('credit'))
        self.assertEqual(agg['d'], agg['c'])

    def test_double_acquisition_blocked(self):
        post_acquisition(self.asset, payment_mode='bank')
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            post_acquisition(self.asset, payment_mode='bank')

    def test_monthly_depreciation_run(self):
        post_acquisition(self.asset)
        result = post_monthly_depreciation('2025-04')
        self.assertEqual(len(result['posted']), 1)
        self.assertEqual(DepreciationEntry.objects.count(), 1)
        # Re-running same period is idempotent
        result2 = post_monthly_depreciation('2025-04')
        self.assertEqual(len(result2['posted']), 0)

    def test_disposal_books_gain(self):
        post_acquisition(self.asset)
        post_monthly_depreciation('2025-04')
        post_monthly_depreciation('2025-05')
        # NBV after 2 months: 60000 - (950 × 2) = 58100; sell at 60000 → gain 1900
        je = dispose_asset(self.asset, disposal_date=date(2025, 6, 1),
                           proceeds=Decimal('60000'), mode='bank')
        self.asset.refresh_from_db()
        self.assertEqual(self.asset.status, 'disposed')
        self.assertEqual(self.asset.gain_loss_on_disposal, Decimal('1900'))

    def test_disposal_books_loss(self):
        post_acquisition(self.asset)
        post_monthly_depreciation('2025-04')
        # NBV: 60000 - 950 = 59050; sell for 50000 → loss 9050
        je = dispose_asset(self.asset, disposal_date=date(2025, 5, 1),
                           proceeds=Decimal('50000'), mode='bank')
        self.asset.refresh_from_db()
        self.assertEqual(self.asset.gain_loss_on_disposal, Decimal('-9050'))

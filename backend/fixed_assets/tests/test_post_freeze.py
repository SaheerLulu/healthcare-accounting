"""Regression test for H6: an asset's cost/class/life must be frozen once its
acquisition JE is posted (immutable) or depreciation has run — otherwise the
register silently desyncs from the GL and every future charge is mis-computed.
"""
from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from fixed_assets.serializers import FixedAssetSerializer
from fixed_assets.services import dispose_asset, post_acquisition
from fixed_assets.tests.test_depreciation import _make_asset, _make_asset_class


class AssetFreezeTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        coa = {a.account_code: a for a in ChartOfAccount.objects.all()}
        self.asset = _make_asset(_make_asset_class(coa))

    def test_cost_change_allowed_before_acquisition(self):
        ser = FixedAssetSerializer(
            instance=self.asset, data={'acquisition_cost': '70000'}, partial=True)
        self.assertTrue(ser.is_valid(), ser.errors)

    def test_cost_change_blocked_after_acquisition_posted(self):
        post_acquisition(self.asset, payment_mode='bank')
        self.asset.refresh_from_db()
        ser = FixedAssetSerializer(
            instance=self.asset, data={'acquisition_cost': '90000'}, partial=True)
        self.assertFalse(ser.is_valid())
        self.assertIn('acquisition_cost', ser.errors)

    def test_unrelated_field_still_editable_after_acquisition(self):
        post_acquisition(self.asset, payment_mode='bank')
        self.asset.refresh_from_db()
        ser = FixedAssetSerializer(
            instance=self.asset, data={'notes': 'serviced under warranty'}, partial=True)
        self.assertTrue(ser.is_valid(), ser.errors)

    def test_resaving_same_cost_after_acquisition_is_fine(self):
        post_acquisition(self.asset, payment_mode='bank')
        self.asset.refresh_from_db()
        ser = FixedAssetSerializer(
            instance=self.asset,
            data={'acquisition_cost': str(self.asset.acquisition_cost)}, partial=True)
        self.assertTrue(ser.is_valid(), ser.errors)


class DisposalGuardTests(TestCase):
    """H7: disposal must be blocked until the acquisition JE is posted, so the
    asset-GL credit always offsets a real prior debit."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        coa = {a.account_code: a for a in ChartOfAccount.objects.all()}
        self.asset = _make_asset(_make_asset_class(coa))

    def test_dispose_without_acquisition_raises(self):
        with self.assertRaises(ValidationError):
            dispose_asset(self.asset, disposal_date=date(2026, 4, 1),
                          proceeds=Decimal('5000'), mode='bank')

    def test_dispose_after_acquisition_succeeds(self):
        post_acquisition(self.asset, payment_mode='bank')
        self.asset.refresh_from_db()
        je = dispose_asset(self.asset, disposal_date=date(2026, 4, 1),
                           proceeds=Decimal('5000'), mode='bank')
        self.assertTrue(je.is_posted)

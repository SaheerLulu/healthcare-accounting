"""Tests for the lower-deduction-certificate (s.197) flow."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from parties.models import PartyMetadata
from tds.services import TDSService


class LowerDeductionCertificateTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = TDSService()

    def test_ldc_overrides_default_rate(self):
        PartyMetadata.objects.create(
            party_type='Supplier', party_id=42,
            has_lower_deduction_cert=True,
            lower_tds_rate_pct=Decimal('0.5'),
            lower_cert_valid_from=date(2026, 4, 1),
            lower_cert_valid_to=date(2027, 3, 31),
        )
        rate, threshold = self.svc._get_rate_config(
            '194Q', 'Company', date(2026, 5, 1),
            party_type='Supplier', party_id=42,
        )
        self.assertEqual(rate, Decimal('0.5'))
        # Threshold from statutory config (5L for 194Q in fallback rates)
        self.assertEqual(threshold, Decimal('5000000'))

    def test_ldc_outside_validity_ignored(self):
        PartyMetadata.objects.create(
            party_type='Supplier', party_id=43,
            has_lower_deduction_cert=True,
            lower_tds_rate_pct=Decimal('0.5'),
            lower_cert_valid_from=date(2025, 4, 1),
            lower_cert_valid_to=date(2026, 3, 31),  # expired
        )
        rate, _ = self.svc._get_rate_config(
            '194Q', 'Company', date(2026, 5, 1),
            party_type='Supplier', party_id=43,
        )
        self.assertEqual(rate, Decimal('0.1'))  # back to fallback

    def test_no_metadata_returns_default(self):
        rate, _ = self.svc._get_rate_config(
            '194Q', 'Company', date(2026, 5, 1),
            party_type='Supplier', party_id=999,
        )
        self.assertEqual(rate, Decimal('0.1'))


class Form26ASTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def test_create_form_26as_entry(self):
        from tds.models import Form26ASEntry
        e = Form26ASEntry.objects.create(
            fy_label='2026-27', deductor_tan='ABCD12345E',
            deductor_name='Customer Inc', section='194C',
            transaction_date=date(2026, 5, 15),
            gross_amount=Decimal('100000'), tds_amount=Decimal('2000'),
        )
        self.assertEqual(e.match_status, 'unmatched')

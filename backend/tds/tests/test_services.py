"""Tests for TDS service: rates, deductions, 26Q export, Form-16A."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from tds.models import TDSChallan, TDSDeduction, TDSRateConfig
from tds.services import FALLBACK_RATES, FVU_SEP, TDSService


class RateConfigTests(TestCase):
    def test_falls_back_to_hardcoded_rates(self):
        svc = TDSService()
        rate, threshold = svc._get_rate_config('194Q', 'Company', date(2026, 4, 1))
        self.assertEqual(rate, Decimal('0.1'))
        self.assertEqual(threshold, Decimal('5000000'))

    def test_db_config_overrides_fallback(self):
        TDSRateConfig.objects.create(
            section='194Q', deductee_type='Company',
            rate=Decimal('0.2'), threshold=Decimal('1000000'),
            fy_start=date(2025, 4, 1), fy_end=date(2026, 3, 31),
            is_active=True,
        )
        svc = TDSService()
        rate, _ = svc._get_rate_config('194Q', 'Company', date(2025, 6, 1))
        self.assertEqual(rate, Decimal('0.2'))


class ChallanGenerationTests(TestCase):
    def setUp(self):
        TDSDeduction.objects.create(
            deductee_name='Vendor A', deductee_pan='ABCDE1234F',
            section='194C', nature_of_payment='Contract',
            transaction_date=date(2026, 4, 5),
            gross_amount=Decimal('100000'), tds_rate=Decimal('2'),
            tds_amount=Decimal('2000'), location_id=1,
        )
        TDSDeduction.objects.create(
            deductee_name='Vendor B', deductee_pan='XYZAB1234F',
            section='194C', nature_of_payment='Contract',
            transaction_date=date(2026, 4, 12),
            gross_amount=Decimal('50000'), tds_rate=Decimal('2'),
            tds_amount=Decimal('1000'), location_id=1,
        )

    def test_auto_generate_challan_groups_pending(self):
        svc = TDSService()
        challan = svc.auto_generate_challan('194C', '2026-04')
        self.assertEqual(challan.total_tds_amount, Decimal('3000.00'))
        self.assertEqual(challan.deductions.count(), 2)

    def test_pending_marked_paid(self):
        svc = TDSService()
        svc.auto_generate_challan('194C', '2026-04')
        for d in TDSDeduction.objects.filter(section='194C'):
            self.assertEqual(d.status, 'challan_paid')

    def test_no_pending_returns_none(self):
        svc = TDSService()
        self.assertIsNone(svc.auto_generate_challan('194J', '2026-04'))


class QuarterlyExportTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        # Q1 = Apr/May/Jun
        TDSDeduction.objects.create(
            deductee_name='Vendor A', deductee_pan='ABCDE1234F',
            section='194C', nature_of_payment='Contract',
            transaction_date=date(2026, 5, 5),
            gross_amount=Decimal('100000'), tds_rate=Decimal('2'),
            tds_amount=Decimal('2000'), location_id=1,
            status='challan_paid', challan_no='CHL-2026-04-0001',
            challan_date=date(2026, 5, 7), bsr_code='0123456',
        )

    def test_summary_filters_by_quarter_and_location(self):
        svc = TDSService()
        s = svc.get_quarterly_summary('2026-Q1', 1)
        self.assertEqual(len(s['deductions']), 1)
        self.assertEqual(s['total_tds'], '2000.00')

    def test_fvu_export_has_all_record_types(self):
        svc = TDSService()
        out = svc.export_26q_fvu('2026-Q1', 1)
        lines = out.strip().split('\n')
        record_types = [l.split(FVU_SEP)[0] for l in lines]
        self.assertIn('FH', record_types)
        self.assertIn('BH', record_types)
        self.assertIn('CH', record_types)
        self.assertIn('DD', record_types)

    def test_form_16a_data_aggregates_per_deductee(self):
        svc = TDSService()
        d = svc.form_16a_data('2026-Q1', 1, deductee_pan='ABCDE1234F')
        self.assertIsNotNone(d)
        self.assertEqual(d['total_tds'], Decimal('2000.00'))
        self.assertEqual(d['deductee']['pan'], 'ABCDE1234F')

    def test_form_16a_returns_none_for_unknown_pan(self):
        svc = TDSService()
        d = svc.form_16a_data('2026-Q1', 1, deductee_pan='NOPE99999X')
        self.assertIsNone(d)

"""Tests for Form 27Q (non-resident TDS) export."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from tds.models import TDSDeduction
from tds.services import FVU_SEP, TDSService


class Form27QTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

        # Mix: one 195 (non-resident, in scope) + one 194C (resident, NOT in scope)
        TDSDeduction.objects.create(
            deductee_name='Foreign Vendor LLC', deductee_pan='AAAAA0000A',
            section='195', nature_of_payment='Royalty',
            transaction_date=date(2026, 5, 5),
            gross_amount=Decimal('100000'), tds_rate=Decimal('20'),
            tds_amount=Decimal('20000'), location_id=1,
            status='challan_paid', challan_no='CHL-2026-04-0001',
            challan_date=date(2026, 5, 7), bsr_code='0123456',
        )
        TDSDeduction.objects.create(
            deductee_name='Local Contractor', deductee_pan='BBBBB1111B',
            section='194C', nature_of_payment='Contract',
            transaction_date=date(2026, 5, 6),
            gross_amount=Decimal('50000'), tds_rate=Decimal('2'),
            tds_amount=Decimal('1000'), location_id=1,
        )

    def test_27q_includes_only_non_resident_sections(self):
        out = TDSService().export_27q_fvu('2026-Q1', 1)
        # The 195 deduction should appear; 194C should not
        self.assertIn('Foreign Vendor', out)
        self.assertNotIn('Local Contractor', out)

    def test_27q_uses_ns3_marker(self):
        out = TDSService().export_27q_fvu('2026-Q1', 1)
        # First record (FH) should have the NS3 form-type token
        first_line = out.strip().split('\n')[0]
        tokens = first_line.split(FVU_SEP)
        self.assertEqual(tokens[2], 'NS3')

    def test_27q_dd_records_have_country_code(self):
        out = TDSService().export_27q_fvu('2026-Q1', 1)
        dd_lines = [l for l in out.strip().split('\n') if l.startswith('DD')]
        self.assertEqual(len(dd_lines), 1)
        self.assertEqual(dd_lines[0].split(FVU_SEP)[-1], 'IN')

    def test_27q_empty_quarter(self):
        # No 195 records in Q4
        out = TDSService().export_27q_fvu('2026-Q4', 1)
        # File header still emitted, no BH/CH/DD
        lines = out.strip().split('\n')
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith('FH'))

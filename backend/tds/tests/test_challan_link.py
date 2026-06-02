"""Regression test for H12: manually linking deductions to a TDS challan must
mark them challan_paid (and recompute the total from them), so the Auto-Generate
path — which only picks status='pending' — can't re-pick the same deductions
into a SECOND challan and double-count the deposited TDS.
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from tds.models import TDSDeduction
from tds.serializers import TDSChallanSerializer
from tds.services import TDSService


class ChallanLinkTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def _deduction(self, amount):
        return TDSDeduction.objects.create(
            deductee_name='Acme Contractors', section='194C',
            nature_of_payment='Contract', transaction_date=date(2026, 6, 5),
            gross_amount=Decimal('100000'), tds_rate=Decimal('1'),
            tds_amount=Decimal(amount), status='pending',
        )

    def test_manual_challan_marks_paid_and_recomputes_total(self):
        d1, d2 = self._deduction('1000'), self._deduction('2000')
        ser = TDSChallanSerializer(data={
            'challan_no': 'CHL-2026-06-0001', 'bsr_code': '0510308',
            'deposit_date': '2026-07-07', 'period': '2026-06', 'section': '194C',
            'total_tds_amount': '0',                    # client lies; must be recomputed
            'deduction_ids': [d1.id, d2.id],
        })
        self.assertTrue(ser.is_valid(), ser.errors)
        challan = ser.save()

        d1.refresh_from_db()
        d2.refresh_from_db()
        self.assertEqual(d1.status, 'challan_paid')
        self.assertEqual(d2.status, 'challan_paid')
        self.assertEqual(d1.challan_no, 'CHL-2026-06-0001')
        self.assertEqual(d1.challan_date, date(2026, 7, 7))
        # Total recomputed from the linked deductions, not trusted from input.
        self.assertEqual(challan.total_tds_amount, Decimal('3000.00'))

    def test_auto_generate_cannot_repick_linked_deductions(self):
        d1, d2 = self._deduction('1000'), self._deduction('2000')
        ser = TDSChallanSerializer(data={
            'challan_no': 'CHL-2026-06-0001', 'bsr_code': '0510308',
            'deposit_date': '2026-07-07', 'period': '2026-06', 'section': '194C',
            'total_tds_amount': '3000', 'deduction_ids': [d1.id, d2.id],
        })
        self.assertTrue(ser.is_valid(), ser.errors)
        ser.save()

        # No pending deductions remain → auto-generate must not make a 2nd challan.
        result = TDSService().auto_generate_challan('194C', '2026-06')
        self.assertIsNone(result)

"""Tests for the GST set-off priority calculator (Sec 49(2)(b) + Rule 88A)."""
from decimal import Decimal

from django.test import TestCase

from core.gst_setoff import compute_gst_setoff


class GSTSetoffTests(TestCase):
    def test_igst_credit_exhausted_first_against_igst(self):
        r = compute_gst_setoff(
            itc_igst=Decimal('1000'), itc_cgst=0, itc_sgst=0,
            out_igst=Decimal('1000'), out_cgst=0, out_sgst=0,
        )
        self.assertEqual(r['used']['IGST']['IGST'], Decimal('1000'))
        self.assertEqual(r['remaining_payable']['TOTAL'], Decimal('0'))

    def test_igst_overflow_to_cgst_then_sgst(self):
        # ITC IGST 1000, output: IGST 200, CGST 500, SGST 500
        r = compute_gst_setoff(
            itc_igst=Decimal('1000'), itc_cgst=0, itc_sgst=0,
            out_igst=Decimal('200'), out_cgst=Decimal('500'), out_sgst=Decimal('500'),
        )
        self.assertEqual(r['used']['IGST']['IGST'], Decimal('200'))
        self.assertEqual(r['used']['IGST']['CGST'], Decimal('500'))
        self.assertEqual(r['used']['IGST']['SGST'], Decimal('300'))
        # SGST liability still has 200 to pay (1000 ITC - 200 - 500 = 300 → SGST gets 300)
        self.assertEqual(r['remaining_payable']['SGST'], Decimal('200'))

    def test_cgst_credit_cannot_pay_sgst(self):
        # CGST credit may NOT settle SGST liability (and vice versa)
        r = compute_gst_setoff(
            itc_igst=0, itc_cgst=Decimal('500'), itc_sgst=0,
            out_igst=0, out_cgst=0, out_sgst=Decimal('500'),
        )
        self.assertEqual(r['used']['CGST']['CGST'], Decimal('0'))
        self.assertEqual(r['remaining_payable']['SGST'], Decimal('500'))
        self.assertEqual(r['remaining_itc']['CGST'], Decimal('500'))

    def test_cgst_then_sgst_against_remaining_igst(self):
        r = compute_gst_setoff(
            itc_igst=0, itc_cgst=Decimal('300'), itc_sgst=Decimal('200'),
            out_igst=Decimal('200'), out_cgst=Decimal('100'), out_sgst=Decimal('100'),
        )
        # CGST: covers 100 CGST + 200 IGST → remaining ITC 0
        # SGST: covers 100 SGST → remaining ITC 100
        self.assertEqual(r['used']['CGST']['CGST'], Decimal('100'))
        self.assertEqual(r['used']['CGST']['IGST'], Decimal('200'))
        self.assertEqual(r['used']['SGST']['SGST'], Decimal('100'))
        self.assertEqual(r['remaining_payable']['TOTAL'], Decimal('0'))

    def test_zero_itc_returns_full_payable(self):
        r = compute_gst_setoff(
            itc_igst=0, itc_cgst=0, itc_sgst=0,
            out_igst=Decimal('100'), out_cgst=Decimal('200'), out_sgst=Decimal('200'),
        )
        self.assertEqual(r['remaining_payable']['TOTAL'], Decimal('500'))

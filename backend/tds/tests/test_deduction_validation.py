"""L1 — TDSDeductionSerializer amount/rate sanity validation."""
from django.test import TestCase

from tds.serializers import TDSDeductionSerializer


def _payload(**overrides):
    data = {
        'deductee_name': 'Acme Contractors',
        'section': '194C',
        'nature_of_payment': 'Contract work',
        'transaction_date': '2026-05-15',
        'gross_amount': '10000.00',
        'tds_rate': '1.00',
        'tds_amount': '100.00',
        'deductee_type': 'Company',
    }
    data.update(overrides)
    return data


class TDSDeductionValidationTests(TestCase):
    def test_valid_deduction_accepted(self):
        ser = TDSDeductionSerializer(data=_payload())
        self.assertTrue(ser.is_valid(), ser.errors)

    def test_zero_or_negative_gross_rejected(self):
        for gross in ('0.00', '-5000.00'):
            ser = TDSDeductionSerializer(data=_payload(gross_amount=gross))
            self.assertFalse(ser.is_valid(), gross)
            self.assertIn('gross_amount', ser.errors)

    def test_negative_tds_amount_rejected(self):
        ser = TDSDeductionSerializer(data=_payload(tds_amount='-10.00'))
        self.assertFalse(ser.is_valid())
        self.assertIn('tds_amount', ser.errors)

    def test_tds_above_gross_rejected(self):
        ser = TDSDeductionSerializer(data=_payload(tds_amount='10001.00'))
        self.assertFalse(ser.is_valid())
        self.assertIn('tds_amount', ser.errors)

    def test_rate_out_of_bounds_rejected(self):
        for rate in ('-1.00', '101.00'):
            ser = TDSDeductionSerializer(data=_payload(tds_rate=rate))
            self.assertFalse(ser.is_valid(), rate)
            self.assertIn('tds_rate', ser.errors)

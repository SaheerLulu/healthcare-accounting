"""Store-scoping of TDS challans (AUDIT finding H11)."""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from core.tests.utils import fake_active_location, make_admin
from tds.models import TDSChallan, TDSDeduction
from tds.services import TDSService


def _deduction(name, location_id, amount='1000.00'):
    gross = Decimal(amount)
    return TDSDeduction.objects.create(
        deductee_name=name,
        section='194C',
        nature_of_payment='Contract',
        transaction_date=date(2026, 5, 15),
        gross_amount=gross,
        tds_rate=Decimal('1.00'),
        tds_amount=gross / 100,
        location_id=location_id,
    )


def _rows(resp):
    data = resp.data
    return data['results'] if isinstance(data, dict) and 'results' in data else data


class AutoGenerateChallanLocationTests(TestCase):
    def test_sweeps_only_the_given_store_and_stamps_it(self):
        _deduction('S1 vendor A', 1)
        _deduction('S1 vendor B', 1)
        other = _deduction('S2 vendor', 2)

        challan = TDSService().auto_generate_challan('194C', '2026-05',
                                                     location_id=1)

        self.assertIsNotNone(challan)
        self.assertEqual(challan.location_id, 1)
        self.assertEqual(challan.deductions.count(), 2)
        self.assertEqual(challan.total_tds_amount, Decimal('20.00'))
        other.refresh_from_db()
        self.assertEqual(other.status, 'pending')  # Store 2 left untouched

    def test_no_location_keeps_company_wide_sweep(self):
        _deduction('S1 vendor', 1)
        _deduction('S2 vendor', 2)
        challan = TDSService().auto_generate_challan('194C', '2026-05')
        self.assertEqual(challan.deductions.count(), 2)
        self.assertIsNone(challan.location_id)


class ChallanAPILocationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = make_admin()

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _challan(self, no, location_id):
        return TDSChallan.objects.create(
            challan_no=no, bsr_code='', deposit_date=date(2026, 5, 31),
            period='2026-05', section='194C',
            total_tds_amount=Decimal('10.00'), location_id=location_id)

    def test_list_scoped_by_header(self):
        self._challan('CHL-1', 1)
        self._challan('CHL-2', 2)
        with fake_active_location():
            resp = self.client.get('/api/tds/challans/', HTTP_X_LOCATION_ID='1')
        self.assertEqual([r['challan_no'] for r in _rows(resp)], ['CHL-1'])

    def test_admin_without_header_sees_all(self):
        self._challan('CHL-1', 1)
        self._challan('CHL-2', 2)
        with fake_active_location():
            resp = self.client.get('/api/tds/challans/')
        self.assertEqual(len(_rows(resp)), 2)

    def test_auto_generate_uses_active_store(self):
        _deduction('S1 vendor', 1)
        _deduction('S2 vendor', 2)
        with fake_active_location():
            resp = self.client.post('/api/tds/challans/auto-generate/',
                                    {'section': '194C', 'period': '2026-05'},
                                    format='json', HTTP_X_LOCATION_ID='1')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['location_id'], 1)
        challan = TDSChallan.objects.get(pk=resp.data['id'])
        self.assertEqual(
            [d.deductee_name for d in challan.deductions.all()], ['S1 vendor'])

"""Store-scoping of payroll runs (AUDIT finding H15)."""
from datetime import date
from decimal import Decimal
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from core.tests.utils import fake_active_location, make_admin, make_user
from payroll.models import Employee, PayrollRun


def _employee(code, location_id):
    return Employee.objects.create(
        employee_code=code, name=f'Emp {code}',
        date_of_joining=date(2025, 4, 1), location_id=location_id)


def _run(emp, period='2026-05'):
    return PayrollRun.objects.create(
        period=period, employee=emp,
        gross_salary=Decimal('30000'), basic=Decimal('20000'),
        net_salary=Decimal('27000'), status='processed',
        location_id=emp.location_id)


def _rows(resp):
    data = resp.data
    return data['results'] if isinstance(data, dict) and 'results' in data else data


class PayrollRunLocationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = make_admin()
        cls.run1 = _run(_employee('E1', 1))
        cls.run2 = _run(_employee('E2', 2))

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_runs_list_scoped_by_header(self):
        with fake_active_location():
            resp = self.client.get('/api/payroll/runs/', HTTP_X_LOCATION_ID='1')
        rows = _rows(resp)
        self.assertEqual([r['id'] for r in rows], [self.run1.id])

    def test_admin_without_header_sees_all(self):
        with fake_active_location():
            resp = self.client.get('/api/payroll/runs/')
        self.assertEqual(len(_rows(resp)), 2)

    def test_regular_user_without_header_sees_nothing(self):
        self.client.force_authenticate(make_user(username='clerk'))
        with fake_active_location(all_access=False):
            resp = self.client.get('/api/payroll/runs/')
        self.assertEqual(len(_rows(resp)), 0)

    def test_process_defaults_to_active_store(self):
        with mock.patch('payroll.views.PayrollService') as svc:
            svc.return_value.process_payroll.return_value = []
            with fake_active_location():
                resp = self.client.post('/api/payroll/runs/process/',
                                        {'period': '2026-06'}, format='json',
                                        HTTP_X_LOCATION_ID='2')
        self.assertEqual(resp.status_code, 201, resp.data)
        svc.return_value.process_payroll.assert_called_once_with('2026-06', 2)

    def test_explicit_location_in_body_wins_over_header(self):
        with mock.patch('payroll.views.PayrollService') as svc:
            svc.return_value.process_payroll.return_value = []
            with fake_active_location():
                self.client.post('/api/payroll/runs/process/',
                                 {'period': '2026-06', 'location_id': 5},
                                 format='json', HTTP_X_LOCATION_ID='2')
        svc.return_value.process_payroll.assert_called_once_with('2026-06', 5)

    def test_payslip_of_another_store_is_404(self):
        with fake_active_location():
            resp = self.client.get(
                f'/api/payroll/runs/{self.run2.id}/payslip/',
                HTTP_X_LOCATION_ID='1')
        self.assertEqual(resp.status_code, 404)

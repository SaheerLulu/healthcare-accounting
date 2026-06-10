"""Store-scoping of budgets (X-Location-Id)."""
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from budgets.models import Budget
from core.models import ChartOfAccount
from core.tests.utils import fake_active_location, make_admin


class BudgetLocationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = make_admin()
        cls.acct = ChartOfAccount.objects.create(
            account_code='9820', account_name='Marketing',
            account_type='EXPENSE', is_leaf=True, is_active=True)
        Budget.objects.create(period='2026-05', account=cls.acct,
                              amount=Decimal('1000'), location_id=1)
        Budget.objects.create(period='2026-05', account=cls.acct,
                              amount=Decimal('2000'), location_id=2)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_list_scoped_by_header(self):
        with fake_active_location():
            resp = self.client.get('/api/budgets/budgets/',
                                   HTTP_X_LOCATION_ID='1')
        self.assertEqual([b['amount'] for b in resp.data], ['1000.00'])

    def test_admin_without_header_sees_all(self):
        with fake_active_location():
            resp = self.client.get('/api/budgets/budgets/')
        self.assertEqual(len(resp.data), 2)

    def test_create_stamps_active_store(self):
        with fake_active_location():
            resp = self.client.post(
                '/api/budgets/budgets/',
                {'period': '2026-06', 'account': self.acct.id,
                 'amount': '500.00', 'cost_center': ''},
                format='json', HTTP_X_LOCATION_ID='3')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Budget.objects.get(period='2026-06').location_id, 3)

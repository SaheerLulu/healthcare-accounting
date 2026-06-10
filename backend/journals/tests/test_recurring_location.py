"""Store-scoping of recurring journal templates (X-Location-Id)."""
from django.test import TestCase
from rest_framework.test import APIClient

from core.models import ChartOfAccount
from core.tests.utils import fake_active_location, make_admin, make_user
from journals.models import RecurringJournal


def _make_rj(name, location_id):
    return RecurringJournal.objects.create(
        profile_name=name,
        start_date='2026-04-01',
        next_run_date='2026-04-01',
        location_id=location_id,
    )


def _rows(resp):
    data = resp.data
    return data['results'] if isinstance(data, dict) and 'results' in data else data


class RecurringJournalLocationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = make_admin()
        _make_rj('Store-1 depreciation', 1)
        _make_rj('Store-2 depreciation', 2)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_header_scopes_list_to_one_store(self):
        with fake_active_location():
            resp = self.client.get('/api/journals/recurring/',
                                   HTTP_X_LOCATION_ID='1')
        self.assertEqual(resp.status_code, 200)
        names = [r['profile_name'] for r in _rows(resp)]
        self.assertEqual(names, ['Store-1 depreciation'])

    def test_admin_without_header_sees_all_stores(self):
        with fake_active_location():
            resp = self.client.get('/api/journals/recurring/')
        self.assertEqual(len(_rows(resp)), 2)

    def test_regular_user_without_header_sees_nothing(self):
        self.client.force_authenticate(make_user(username='clerk'))
        with fake_active_location(all_access=False):
            resp = self.client.get('/api/journals/recurring/')
        self.assertEqual(len(_rows(resp)), 0)

    def test_create_stamps_active_store(self):
        expense = ChartOfAccount.objects.create(
            account_code='9810', account_name='Test Expense',
            account_type='EXPENSE', is_leaf=True, is_active=True)
        accrual = ChartOfAccount.objects.create(
            account_code='9811', account_name='Test Accrual',
            account_type='LIABILITY', is_leaf=True, is_active=True)
        payload = {
            'profile_name': 'Rent accrual',
            'frequency': 'monthly',
            'start_date': '2026-04-01',
            'lines': [
                {'account': expense.id, 'debit': '100.00', 'credit': '0.00'},
                {'account': accrual.id, 'debit': '0.00', 'credit': '100.00'},
            ],
        }
        with fake_active_location():
            resp = self.client.post('/api/journals/recurring/', payload,
                                    format='json', HTTP_X_LOCATION_ID='1')
        self.assertEqual(resp.status_code, 201, resp.data)
        rj = RecurringJournal.objects.get(profile_name='Rent accrual')
        self.assertEqual(rj.location_id, 1)

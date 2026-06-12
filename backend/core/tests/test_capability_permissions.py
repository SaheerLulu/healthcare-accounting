"""Function-level RBAC: AccountingRole capability flags gate mutating endpoints.

The JWT SECRET_KEY is shared with the inventory system, so any authenticated
inventory user (e.g. a cashier) can reach this API. These tests pin down that
capability-less users get 403 on post/reverse/close-FY/lock/settings/mapping
writes, while role holders and superusers stay allowed and reads stay open.
"""
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from core.models import AccountMapping, ChartOfAccount
from core.period_lock import LockedPeriod
from core.tests.utils import (
    fake_active_location, grant_capabilities, make_admin, make_journal_entry,
    make_settings, make_user, seed_chart_and_mappings,
)


class CapabilityPermissionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_chart_and_mappings()
        make_settings()
        cls.admin = make_admin()

    def setUp(self):
        self.client = APIClient()

    def _login(self, username, *capabilities):
        user = make_user(username=username)
        if capabilities:
            grant_capabilities(user, *capabilities)
        self.client.force_authenticate(user)
        return user

    # ─── Journal post / reverse ──────────────────────────────────────────────

    def test_post_entry_denied_without_capability(self):
        entry = make_journal_entry(post=False)
        self._login('cashier')
        with fake_active_location(all_access=True):
            resp = self.client.post(f'/api/journals/entries/{entry.id}/post/')
        self.assertEqual(resp.status_code, 403)
        entry.refresh_from_db()
        self.assertFalse(entry.is_posted)

    def test_post_entry_allowed_with_capability(self):
        entry = make_journal_entry(post=False)
        self._login('bookkeeper2', 'can_post_journals')
        with fake_active_location(all_access=True):
            resp = self.client.post(f'/api/journals/entries/{entry.id}/post/')
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertTrue(entry.is_posted)

    def test_reverse_entry_denied_without_capability(self):
        entry = make_journal_entry(post=True)
        self._login('cashier')
        with fake_active_location(all_access=True):
            resp = self.client.post(f'/api/journals/entries/{entry.id}/reverse/')
        self.assertEqual(resp.status_code, 403)

    def test_reverse_entry_allowed_with_capability(self):
        entry = make_journal_entry(post=True)
        self._login('senior', 'can_reverse_journals')
        with fake_active_location(all_access=True):
            resp = self.client.post(f'/api/journals/entries/{entry.id}/reverse/')
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_post_entry_allowed_for_superuser(self):
        entry = make_journal_entry(post=False)
        self.client.force_authenticate(self.admin)
        with fake_active_location():
            resp = self.client.post(f'/api/journals/entries/{entry.id}/post/')
        self.assertEqual(resp.status_code, 200, resp.data)

    # ─── Close fiscal year ───────────────────────────────────────────────────

    def test_close_fy_denied_without_capability(self):
        self._login('cashier')
        resp = self.client.post('/api/accounts/fy-close/',
                                {'fy_start_year': 2025}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_close_fy_allowed_with_capability(self):
        self._login('cfo2', 'can_close_fy')
        with fake_active_location(all_access=True), \
                mock.patch('core.year_end.close_fiscal_year',
                           return_value={'fy': '2025-26'}) as closer:
            resp = self.client.post('/api/accounts/fy-close/',
                                    {'fy_start_year': 2025}, format='json',
                                    HTTP_X_LOCATION_ID='1')
        self.assertEqual(resp.status_code, 200, resp.data)
        closer.assert_called_once()

    # ─── Period locks ────────────────────────────────────────────────────────

    def test_lock_period_denied_without_capability(self):
        self._login('cashier')
        resp = self.client.post('/api/accounts/locked-periods/',
                                {'period': '2026-04'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(LockedPeriod.objects.count(), 0)

    def test_unlock_period_denied_without_capability(self):
        lock = LockedPeriod.objects.create(period='2026-04')
        self._login('cashier')
        resp = self.client.delete(f'/api/accounts/locked-periods/{lock.id}/')
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(LockedPeriod.objects.filter(pk=lock.pk).exists())

    def test_lock_period_allowed_with_capability(self):
        self._login('cfo3', 'can_lock_period')
        resp = self.client.post('/api/accounts/locked-periods/',
                                {'period': '2026-04'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        lock_id = resp.data['id']
        resp = self.client.delete(f'/api/accounts/locked-periods/{lock_id}/')
        self.assertEqual(resp.status_code, 204)

    def test_locked_periods_list_stays_open(self):
        LockedPeriod.objects.create(period='2026-04')
        self._login('cashier')
        resp = self.client.get('/api/accounts/locked-periods/')
        self.assertEqual(resp.status_code, 200)

    # ─── Accounting settings ─────────────────────────────────────────────────

    def test_settings_write_denied_without_capability(self):
        self._login('cashier')
        resp = self.client.patch('/api/accounts/settings/',
                                 {'company_name': 'Hacked Co'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_settings_read_stays_open(self):
        self._login('cashier')
        resp = self.client.get('/api/accounts/settings/')
        self.assertEqual(resp.status_code, 200)

    def test_settings_write_allowed_with_capability(self):
        self._login('cfo4', 'can_manage_settings')
        resp = self.client.patch('/api/accounts/settings/',
                                 {'company_name': 'Proper Co'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['company_name'], 'Proper Co')

    # ─── Account mappings ────────────────────────────────────────────────────

    def test_mapping_write_denied_without_capability(self):
        mapping = AccountMapping.objects.filter(key='CASH').first()
        bank = ChartOfAccount.objects.get(account_code='1120')
        self._login('cashier')
        resp = self.client.patch(f'/api/accounts/account-mappings/{mapping.id}/',
                                 {'account': bank.id}, format='json')
        self.assertEqual(resp.status_code, 403)
        resp = self.client.post('/api/accounts/account-mappings/reset/',
                                {}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_mapping_read_stays_open(self):
        self._login('cashier')
        resp = self.client.get('/api/accounts/account-mappings/all-keys/')
        self.assertEqual(resp.status_code, 200)

    def test_mapping_write_allowed_with_capability(self):
        mapping = AccountMapping.objects.filter(key='CASH').first()
        cash = ChartOfAccount.objects.get(account_code='1110')
        self._login('senior2', 'can_manage_masters')
        resp = self.client.patch(f'/api/accounts/account-mappings/{mapping.id}/',
                                 {'account': cash.id}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

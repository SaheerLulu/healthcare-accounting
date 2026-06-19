"""Chart-of-Accounts store/shared scoping + admin-only shared-account gating.

Covers the per-store COA cleanup work:
  * scope=store returns ONLY the active store's own accounts (no templates),
  * scope=store_shared also surfaces admin-created shared accounts,
  * an admin can create a deliberate shared account (no location, visible in
    every store), while a non-admin always gets a store-scoped account and may
    not create a shared one.
"""
from decimal import Decimal
from unittest import mock

from django.core.management import call_command
from rest_framework.test import APIClient
from django.test import TestCase

from core.location_coa import bootstrap_location
from core.models import AccountMapping, ChartOfAccount
from core.tests.utils import (
    fake_active_location, make_admin, make_user, make_journal_entry,
    make_settings, seed_chart_and_mappings,
)

COA_URL = '/api/accounts/chart-of-accounts/'


class COAScopeAndSharedTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        # Store 1 gets its operational clones; store 2 stays empty.
        bootstrap_location(1, 'Main Store', 'MN')

    # ── scoping ──────────────────────────────────────────────────────────
    def test_store_scope_returns_only_store_accounts(self):
        client = APIClient()
        client.force_authenticate(make_admin())
        with fake_active_location():
            resp = client.get(COA_URL, {'location_scope': 'store'},
                               HTTP_X_LOCATION_ID='1')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(len(resp.data) > 0)
        # Every row belongs to store 1 — no NULL-location templates leak in.
        self.assertTrue(all(r['location_id'] == 1 for r in resp.data),
                        'store scope must not include templates/shared rows')

    # ── admin creates a shared account, visible everywhere ───────────────
    def test_admin_creates_shared_account_visible_in_every_store(self):
        client = APIClient()
        client.force_authenticate(make_admin())
        payload = {
            'account_code': '9100', 'account_name': 'Group Marketing (Shared)',
            'account_type': 'EXPENSE', 'account_subtype': 'Other_Expense',
            'is_shared': True,
        }
        with fake_active_location():
            created = client.post(COA_URL, payload, format='json',
                                  HTTP_X_LOCATION_ID='1')
        self.assertEqual(created.status_code, 201, getattr(created, 'data', None))
        self.assertIsNone(created.data['location_id'])
        self.assertTrue(created.data['is_shared'])

        # Visible from a DIFFERENT store under store_shared…
        with fake_active_location():
            shared = client.get(COA_URL, {'location_scope': 'store_shared'},
                                HTTP_X_LOCATION_ID='2')
            store = client.get(COA_URL, {'location_scope': 'store'},
                               HTTP_X_LOCATION_ID='2')
        codes_shared = {r['account_code'] for r in shared.data}
        codes_store = {r['account_code'] for r in store.data}
        self.assertIn('9100', codes_shared, 'shared account must show in every store')
        self.assertNotIn('9100', codes_store, 'store-only scope must hide shared accounts')

    # ── non-admin gating ─────────────────────────────────────────────────
    def test_non_admin_cannot_create_shared_account(self):
        client = APIClient()
        client.force_authenticate(make_user())
        payload = {
            'account_code': '9101', 'account_name': 'Sneaky Shared',
            'account_type': 'EXPENSE', 'is_shared': True,
        }
        with fake_active_location(), \
                mock.patch('core.views._has_all_location_access', return_value=False):
            resp = client.post(COA_URL, payload, format='json',
                               HTTP_X_LOCATION_ID='1')
        self.assertEqual(resp.status_code, 403, getattr(resp, 'data', None))
        self.assertFalse(ChartOfAccount.objects.filter(account_code='9101').exists())

    def test_non_admin_account_is_scoped_to_active_store(self):
        client = APIClient()
        client.force_authenticate(make_user())
        # Even if the client tries to pin another location, the server forces
        # the active store and is_shared=False.
        payload = {
            'account_code': '9200', 'account_name': 'Local Sundry Expense',
            'account_type': 'EXPENSE', 'account_subtype': 'Other_Expense',
            'location_id': 999, 'is_shared': True,
        }
        with fake_active_location(), \
                mock.patch('core.views._has_all_location_access', return_value=False):
            resp = client.post(COA_URL, payload, format='json',
                               HTTP_X_LOCATION_ID='1')
            # is_shared=True from a non-admin is rejected outright.
            self.assertEqual(resp.status_code, 403, getattr(resp, 'data', None))

            payload['is_shared'] = False
            ok = client.post(COA_URL, payload, format='json',
                             HTTP_X_LOCATION_ID='1')
        self.assertEqual(ok.status_code, 201, getattr(ok, 'data', None))
        self.assertEqual(ok.data['location_id'], 1)
        self.assertFalse(ok.data['is_shared'])

    def test_store_account_requires_active_location(self):
        client = APIClient()
        client.force_authenticate(make_user())
        payload = {
            'account_code': '9300', 'account_name': 'No Store Expense',
            'account_type': 'EXPENSE',
        }
        # No X-Location-Id header → no active store → cannot create a store account.
        with fake_active_location(), \
                mock.patch('core.views._has_all_location_access', return_value=False):
            resp = client.post(COA_URL, payload, format='json')
        self.assertEqual(resp.status_code, 400, getattr(resp, 'data', None))


class PruneStoreCOATests(TestCase):
    """prune_store_coa removes leftover non-operational per-store clones but
    keeps operational ones and anything actually referenced."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        bootstrap_location(1, 'Main Store', 'MN')

    def _make_clone(self, template_code, suffix='MN'):
        tpl = ChartOfAccount.objects.get(account_code=template_code, location_id__isnull=True)
        clone = ChartOfAccount.objects.create(
            account_code=f'{template_code}-{suffix}',
            account_name=f'{tpl.account_name} - Main',
            account_type=tpl.account_type, account_subtype=tpl.account_subtype,
            parent=tpl, location_id=1, is_leaf=True, is_active=True,
        )
        if tpl.is_leaf:
            tpl.is_leaf = False
            tpl.save(update_fields=['is_leaf'])
        return tpl, clone

    def test_prunes_unused_non_operational_clone(self):
        # 5400 SALARY_EXPENSE is non-operational; manufacture a leftover clone.
        tpl, clone = self._make_clone('5400')
        AccountMapping.objects.create(key='SALARY_EXPENSE', location_id=1, account=clone)

        call_command('prune_store_coa', apply=True)

        self.assertFalse(ChartOfAccount.objects.filter(id=clone.id).exists(),
                         'unused non-operational clone should be deleted')
        self.assertFalse(AccountMapping.objects.filter(key='SALARY_EXPENSE', location_id=1).exists(),
                         'its per-store mapping override should be removed')
        tpl.refresh_from_db()
        self.assertTrue(tpl.is_leaf, 'childless template should become a postable leaf again')
        # Operational clone untouched.
        self.assertTrue(ChartOfAccount.objects.filter(account_code='1110-MN', location_id=1).exists())

    def test_keeps_clone_with_journal_lines(self):
        _, clone = self._make_clone('5410')  # Rent — non-operational
        cash = ChartOfAccount.objects.get(account_code='1110-MN', location_id=1)
        make_journal_entry(location_id=1, lines=[
            (clone, Decimal('100.00'), Decimal('0.00')),
            (cash, Decimal('0.00'), Decimal('100.00')),
        ])
        call_command('prune_store_coa', apply=True)
        self.assertTrue(ChartOfAccount.objects.filter(id=clone.id).exists(),
                        'a clone with postings must be skipped, not deleted')

    def test_dry_run_changes_nothing(self):
        _, clone = self._make_clone('5400')
        call_command('prune_store_coa')  # no --apply
        self.assertTrue(ChartOfAccount.objects.filter(id=clone.id).exists())

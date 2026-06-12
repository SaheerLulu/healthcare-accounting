"""Cross-store guard on the depreciation run (security audit 2026-06-12).

DepreciationRunView used to take location_id straight from the body (or run
every store when omitted) without checking the caller may act on it.
"""
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from core.tests.utils import (
    fake_active_location, make_admin, make_settings, make_user,
    seed_chart_and_mappings,
)


class DepreciationRunLocationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_chart_and_mappings()
        make_settings()
        cls.admin = make_admin()

    def setUp(self):
        self.client = APIClient()

    def _run(self, payload, **extra):
        return self.client.post('/api/fixed-assets/depreciation/', payload,
                                format='json', **extra)

    def test_store_a_user_cannot_run_store_b_depreciation(self):
        self.client.force_authenticate(make_user(username='clerk3'))
        with mock.patch('core.mixins.user_can_access_location',
                        lambda user, loc: int(loc) == 1):
            resp = self._run({'period': '2026-05', 'location_id': 2})
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_unscoped_run_requires_all_store_access(self):
        self.client.force_authenticate(make_user(username='clerk4'))
        with fake_active_location(all_access=False), \
                mock.patch('fixed_assets.views._has_all_location_access',
                           lambda user: False):
            resp = self._run({'period': '2026-05'})
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_store_user_can_run_own_store(self):
        self.client.force_authenticate(make_user(username='clerk5'))
        with mock.patch('core.mixins.user_can_access_location',
                        lambda user, loc: int(loc) == 1):
            resp = self._run({'period': '2026-05', 'location_id': 1})
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['posted'], [])

    def test_admin_unscoped_run_allowed(self):
        self.client.force_authenticate(self.admin)
        resp = self._run({'period': '2026-05'})
        self.assertEqual(resp.status_code, 200, resp.data)

"""AccountMapping API exposes location-scoped reads + per-key reset so the
Settings UI can manage per-store overrides without trampling shared rows."""
from rest_framework.test import APITestCase

from core.models import AccountMapping, ChartOfAccount
from core.tests.utils import seed_chart_and_mappings, make_admin


class AccountMappingAPITests(APITestCase):
    def setUp(self):
        seed_chart_and_mappings()
        self.user = make_admin()
        self.client.force_authenticate(user=self.user)
        self.cash_template = ChartOfAccount.objects.get(
            account_code='1110', location_id__isnull=True,
        )
        # Create a per-store CASH override at location 7 pointing at a clone.
        cash_clone = ChartOfAccount.objects.create(
            account_code='1110-MUM', account_name='Cash - Mumbai',
            account_type='ASSET', location_id=7,
            account_subtype='Cash', parent=self.cash_template, is_leaf=True,
        )
        AccountMapping.objects.create(
            key='CASH', location_id=7, account=cash_clone,
        )

    def test_list_filters_by_location_null(self):
        """location_id=null returns only shared defaults, never per-store rows."""
        res = self.client.get('/api/accounts/account-mappings/?location_id=null')
        self.assertEqual(res.status_code, 200)
        for row in res.data:
            self.assertIsNone(row['location_id'])

    def test_list_filters_by_specific_location(self):
        """location_id=7 returns only that store's overrides."""
        res = self.client.get('/api/accounts/account-mappings/?location_id=7')
        self.assertEqual(res.status_code, 200)
        loc_ids = {r['location_id'] for r in res.data}
        self.assertEqual(loc_ids, {7})

    def test_all_keys_reports_override_for_location(self):
        """all-keys with location_id=7 reports has_override on the CASH key."""
        res = self.client.get('/api/accounts/account-mappings/all-keys/?location_id=7')
        cash_row = next(r for r in res.data if r['key'] == 'CASH')
        self.assertTrue(cash_row['has_override'])
        self.assertIsNotNone(cash_row['override_id'])
        self.assertEqual(cash_row['account_code'], '1110-MUM')

        # OUTPUT_CGST is shared-only so no override even at loc 7.
        gst_row = next(r for r in res.data if r['key'] == 'OUTPUT_CGST')
        self.assertFalse(gst_row['has_override'])
        self.assertTrue(gst_row['is_shared_key'])

    def test_all_keys_with_no_location_returns_shared(self):
        res = self.client.get('/api/accounts/account-mappings/all-keys/')
        cash_row = next(r for r in res.data if r['key'] == 'CASH')
        # Shared scope — no override flag, account is the template.
        self.assertFalse(cash_row['has_override'])
        self.assertEqual(cash_row['account_code'], '1110')

    def test_reset_with_keys_only_touches_those(self):
        """POSTing reset with a `keys` list should not affect omitted keys."""
        # Knock CASH off (delete the shared default) so reset can recreate it.
        AccountMapping.objects.filter(key='CASH', location_id__isnull=True).delete()
        AccountMapping.objects.filter(key='BANK', location_id__isnull=True).delete()
        res = self.client.post(
            '/api/accounts/account-mappings/reset/',
            data={'keys': ['CASH']}, format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(
            AccountMapping.objects.filter(key='CASH', location_id__isnull=True).exists()
        )
        # BANK was left missing because it wasn't in the keys list.
        self.assertFalse(
            AccountMapping.objects.filter(key='BANK', location_id__isnull=True).exists()
        )

    def test_reset_leaves_per_store_overrides_alone(self):
        """Reset only touches NULL-location rows; overrides are sacred."""
        before_override = AccountMapping.objects.get(key='CASH', location_id=7)
        self.client.post('/api/accounts/account-mappings/reset/')
        after_override = AccountMapping.objects.get(key='CASH', location_id=7)
        self.assertEqual(before_override.pk, after_override.pk)
        self.assertEqual(after_override.account.account_code, '1110-MUM')

"""Tests for core models — CoA, AccountingSettings, AccountMapping, AccountingRole."""
from django.test import TestCase

from core.models import (
    AccountingRole, AccountingSettings, AccountMapping, ChartOfAccount,
)
from core.tests.utils import make_admin, make_settings, seed_chart_and_mappings


class AccountingSettingsTests(TestCase):
    def test_singleton_get_or_create(self):
        s1 = AccountingSettings.get_settings()
        s2 = AccountingSettings.get_settings()
        self.assertEqual(s1.pk, s2.pk)
        self.assertEqual(AccountingSettings.objects.count(), 1)

    def test_save_blocks_second_instance(self):
        AccountingSettings.get_settings()
        with self.assertRaises(ValueError):
            AccountingSettings(company_name='Other').save()

    def test_default_values(self):
        s = AccountingSettings.get_settings()
        self.assertEqual(s.financial_year_start, 4)  # April
        self.assertFalse(s.is_fy_closed)


class ChartOfAccountTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()

    def test_seeded_minimum_set(self):
        # Spot-check: cash + payables + retained earnings exist
        for code in ('1110', '2110', '3200', '5100'):
            self.assertTrue(ChartOfAccount.objects.filter(account_code=code).exists(),
                            f'Missing seeded account {code}')

    def test_account_code_unique(self):
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            ChartOfAccount.objects.create(
                account_code='1110', account_name='Dup', account_type='ASSET',
            )

    def test_get_balance_no_lines(self):
        acct = ChartOfAccount.objects.get(account_code='1110')
        self.assertEqual(acct.get_balance(), 0)


class AccountMappingTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()

    def test_get_account_lookup(self):
        a = AccountMapping.get_account('PURCHASES')
        self.assertEqual(a.account_code, '5100')

    def test_get_account_missing_raises(self):
        AccountMapping.objects.filter(key='PURCHASES').delete()
        with self.assertRaises(ValueError):
            AccountMapping.get_account('PURCHASES')

    def test_get_all_mappings(self):
        m = AccountMapping.get_all_mappings()
        self.assertIn('PURCHASES', m)
        self.assertIn('CASH', m)


class AccountingRoleTests(TestCase):
    def test_seed_creates_five_roles(self):
        from django.core.management import call_command
        call_command('seed_roles', verbosity=0)
        self.assertEqual(AccountingRole.objects.count(), 5)

    def test_role_capability_flags(self):
        from django.core.management import call_command
        call_command('seed_roles', verbosity=0)
        cfo = AccountingRole.objects.get(code='CFO')
        self.assertTrue(cfo.can_close_fy)
        self.assertTrue(cfo.can_post_journals)
        bk = AccountingRole.objects.get(code='BOOKKEEPER')
        self.assertFalse(bk.can_post_journals)
        self.assertTrue(bk.can_create_journals)

    def test_has_capability_superuser_always_true(self):
        admin = make_admin()
        self.assertTrue(AccountingRole.has_capability(admin, 'can_post_journals'))

    def test_has_capability_role_check(self):
        from django.core.management import call_command
        from django.contrib.auth.models import User
        call_command('seed_roles', verbosity=0)
        u = User.objects.create_user('bob', password='x')
        bk = AccountingRole.objects.get(code='BOOKKEEPER')
        bk.users.add(u)
        self.assertTrue(AccountingRole.has_capability(u, 'can_create_journals'))
        self.assertFalse(AccountingRole.has_capability(u, 'can_post_journals'))

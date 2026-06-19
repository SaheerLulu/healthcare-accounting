"""Per-location COA bootstrap: only the OPERATIONAL template accounts (the
ones the inventory sync / fee collection post to) get a per-store clone with a
suffixed code, parented to the template so consolidated reports roll up via
parent. Non-operational heads (retained earnings, payroll, TDS, manual expense
heads) stay as the shared NULL-location template and resolve via fallback.
AccountMapping defaults are overridden per location for operational keys.

Bootstrap is idempotent — re-running for the same location is a no-op."""
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from core.models import AccountMapping, ChartOfAccount
from core.management.commands.bootstrap_location_coa import derive_location_code
from core.tests.utils import seed_chart_and_mappings


class DeriveLocationCodeTests(TestCase):
    def test_simple_name(self):
        self.assertEqual(derive_location_code('Mumbai'), 'MUM')

    def test_multi_word_takes_alpha_prefix(self):
        self.assertEqual(derive_location_code('Delhi NCR'), 'DEL')

    def test_trailing_digits_preserved(self):
        # 'Pune-2' becomes 'PUN' alpha + '2' digit suffix = 'PUN2'.
        # Re-confirms that a second Pune store gets a distinct code.
        self.assertEqual(derive_location_code('Pune2'), 'PUN2')

    def test_empty_falls_back(self):
        self.assertEqual(derive_location_code(''), 'LOC')
        self.assertEqual(derive_location_code('---'), 'LOC')


class _FakeLocation:
    """SimpleNamespace-ish stand-in for inventory_reader.LocationRO."""
    def __init__(self, id, name):
        self.id = id
        self.name = name


class BootstrapLocationCOATests(TestCase):
    def setUp(self):
        # Seeds NULL-location template CoA + AccountMapping defaults.
        seed_chart_and_mappings()

    def _run(self, loc_id=7, loc_name='Mumbai Branch', dry_run=False):
        loc = _FakeLocation(loc_id, loc_name)
        with patch('inventory_reader.models.LocationRO') as MockLoc:
            MockLoc.objects.get.return_value = loc
            MockLoc.objects.all.return_value.order_by.return_value = [loc]
            kw = {'location_id': loc_id}
            if dry_run:
                kw['dry_run'] = True
            call_command('bootstrap_location_coa', **kw)

    def test_creates_clone_with_suffixed_code(self):
        self._run()
        clone = ChartOfAccount.objects.filter(
            account_code='1110-MUM', location_id=7,
        ).first()
        self.assertIsNotNone(clone, 'expected 1110-MUM clone')
        # Whatever the template's name is, the clone gets " - <loc>" suffix.
        template = ChartOfAccount.objects.get(account_code='1110', location_id__isnull=True)
        self.assertEqual(clone.account_name, f'{template.account_name} - Mumbai Branch')
        # Parent is the template so consolidated reports roll up.
        self.assertEqual(clone.parent.account_code, '1110')
        self.assertIsNone(clone.parent.location_id)

    def test_clones_only_operational_accounts_per_store(self):
        # Only operational keys get per-store clones. GST output (2120),
        # cash (1110), POS sales (4100) and COGS (5560) are operational;
        # retained earnings (3200), salary (5400) and TDS receivable (1170)
        # are not and must stay shared (resolve via the NULL template).
        self._run()
        for code in ('1110-MUM', '2120-MUM', '4100-MUM', '5560-MUM'):
            self.assertTrue(
                ChartOfAccount.objects.filter(account_code=code, location_id=7).exists(),
                f'{code} is operational and should be cloned per store',
            )
        for code in ('3200-MUM', '5400-MUM', '1170-MUM'):
            self.assertFalse(
                ChartOfAccount.objects.filter(account_code=code, location_id=7).exists(),
                f'{code} is non-operational and should NOT be cloned',
            )

    def test_non_operational_key_resolves_to_shared_template(self):
        # A non-operational key (no per-store clone) still resolves for posting
        # via AccountMapping.get_account()'s NULL-location fallback.
        self._run()
        resolved = AccountMapping.get_account('RETAINED_EARNINGS', location_id=7)
        self.assertEqual(resolved.account_code, '3200')
        self.assertIsNone(resolved.location_id)

    def test_creates_per_location_mapping_override(self):
        self._run()
        cash_clone = ChartOfAccount.objects.get(account_code='1110-MUM', location_id=7)
        mapping = AccountMapping.objects.get(key='CASH', location_id=7)
        self.assertEqual(mapping.account, cash_clone)

        # Per-location resolution returns the clone, not the template.
        resolved = AccountMapping.get_account('CASH', location_id=7)
        self.assertEqual(resolved, cash_clone)

        # Other locations still hit the NULL default.
        template_cash = ChartOfAccount.objects.get(
            account_code='1110', location_id__isnull=True,
        )
        self.assertEqual(AccountMapping.get_account('CASH', location_id=99), template_cash)

    def test_gst_head_now_resolves_per_store(self):
        """With nothing shared, OUTPUT_CGST for loc 7 resolves to its per-store
        clone (2120-MUM), not the shared template."""
        self._run()
        resolved = AccountMapping.get_account('OUTPUT_CGST', location_id=7)
        self.assertEqual(resolved.account_code, '2120-MUM')
        self.assertEqual(resolved.location_id, 7)

    def test_idempotent(self):
        self._run()
        first_count = ChartOfAccount.objects.filter(location_id=7).count()
        first_mappings = AccountMapping.objects.filter(location_id=7).count()
        # Second run must add zero rows.
        self._run()
        self.assertEqual(ChartOfAccount.objects.filter(location_id=7).count(), first_count)
        self.assertEqual(AccountMapping.objects.filter(location_id=7).count(), first_mappings)

    def test_dry_run_writes_nothing(self):
        self._run(loc_id=8, loc_name='Delhi', dry_run=True)
        self.assertEqual(ChartOfAccount.objects.filter(location_id=8).count(), 0)
        self.assertEqual(AccountMapping.objects.filter(location_id=8).count(), 0)


class EnsureLocationsBootstrappedTests(TestCase):
    """The sync hook auto-bootstraps only stores that have no clones yet."""

    def setUp(self):
        seed_chart_and_mappings()

    def _ensure(self, locations):
        from core import location_coa
        with patch('inventory_reader.models.LocationRO') as MockLoc:
            MockLoc.objects.all.return_value.order_by.return_value = locations
            return location_coa.ensure_locations_bootstrapped()

    def test_bootstraps_new_store(self):
        summary = self._ensure([_FakeLocation(7, 'Mumbai Branch')])
        self.assertEqual(summary['locations'], 1)
        self.assertTrue(summary['accounts'] > 0)
        self.assertTrue(
            ChartOfAccount.objects.filter(account_code='1110-MUM', location_id=7).exists()
        )

    def test_skips_already_bootstrapped_store(self):
        loc = _FakeLocation(7, 'Mumbai Branch')
        self._ensure([loc])               # first run creates clones
        summary = self._ensure([loc])     # second run must be a no-op
        self.assertEqual(summary['locations'], 0)
        self.assertEqual(summary['accounts'], 0)
        self.assertEqual(summary['mappings'], 0)

    def test_only_new_store_among_existing(self):
        mum, delhi = _FakeLocation(7, 'Mumbai'), _FakeLocation(8, 'Delhi')
        self._ensure([mum])                       # Mumbai done
        summary = self._ensure([mum, delhi])      # only Delhi is new
        self.assertEqual(summary['locations'], 1)
        self.assertTrue(
            ChartOfAccount.objects.filter(account_code='1110-DEL', location_id=8).exists()
        )

"""Per-store GST registration: each store files under its own GSTIN.

Covers the LocationTaxProfile model/resolver, that GST returns and e-invoice
IRNs use the store's own GSTIN/state (not a single company-wide one), and the
per-location-tax-profile API.
"""
from datetime import date
from decimal import Decimal
from unittest import mock

from django.test import TestCase
from rest_framework.test import APITestCase

from core.models import AccountingSettings, LocationTaxProfile
from core.tests.utils import make_settings, make_admin, make_user, grant_capabilities
from gst_returns.einvoice import compute_irn, generate_irn_for_entry, DOC_TYPE_MAP
from gst_returns.models import GSTR1Entry
from gst_returns.services import GSTR1Generator

# Maharashtra (27) company default vs a Karnataka (29) store.
MH_GSTIN = '27AABCT1234A1Z5'
KA_GSTIN = '29AABCT1234A1Z5'


class ResolverTests(TestCase):
    def setUp(self):
        make_settings(gstin=MH_GSTIN, state_code='27', company_name='Test Co')

    def test_fallback_to_company_when_no_profile(self):
        ti = LocationTaxProfile.resolve(1)
        self.assertEqual(ti.gstin, MH_GSTIN)
        self.assertEqual(ti.state_code, '27')
        self.assertEqual(ti.legal_name, 'Test Co')

    def test_none_location_is_company_identity(self):
        ti = LocationTaxProfile.resolve(None)
        self.assertEqual(ti.gstin, MH_GSTIN)
        self.assertEqual(ti.state_code, '27')

    def test_profile_overrides_company(self):
        LocationTaxProfile.objects.create(location_id=2, gstin=KA_GSTIN)
        ti = LocationTaxProfile.resolve(2)
        self.assertEqual(ti.gstin, KA_GSTIN)
        # state derived from GSTIN[:2] on save()
        self.assertEqual(ti.state_code, '29')

    def test_save_autoderives_state_code(self):
        p = LocationTaxProfile.objects.create(location_id=3, gstin='33AABCT1234A1Z5')
        self.assertEqual(p.state_code, '33')

    def test_explicit_state_code_preserved(self):
        p = LocationTaxProfile.objects.create(
            location_id=4, gstin=MH_GSTIN, state_code='99',
        )
        self.assertEqual(p.state_code, '99')
        self.assertEqual(LocationTaxProfile.resolve(4).state_code, '99')

    def test_legal_name_override_and_fallback(self):
        LocationTaxProfile.objects.create(
            location_id=5, gstin=KA_GSTIN, legal_name='Branch KA',
        )
        self.assertEqual(LocationTaxProfile.resolve(5).legal_name, 'Branch KA')
        # blank legal_name → company name
        LocationTaxProfile.objects.create(location_id=6, gstin='07AABCT1234A1Z5')
        self.assertEqual(LocationTaxProfile.resolve(6).legal_name, 'Test Co')

    def test_blank_gstin_profile_falls_back_to_company_gstin(self):
        # A profile row with only a state set (no GSTIN) still bills under the
        # company GSTIN, but its state override applies.
        LocationTaxProfile.objects.create(location_id=8, state_code='07')
        ti = LocationTaxProfile.resolve(8)
        self.assertEqual(ti.gstin, MH_GSTIN)
        self.assertEqual(ti.state_code, '07')


class EInvoiceIdentityTests(TestCase):
    def setUp(self):
        make_settings(gstin=MH_GSTIN, state_code='27')

    def _entry(self, location_id, invoice_no='INV-1'):
        return GSTR1Entry.objects.create(
            period='2026-04', location_id=location_id, invoice_no=invoice_no,
            invoice_date=date(2026, 4, 5), customer_gstin=KA_GSTIN,
            invoice_type='B2B', taxable_value=Decimal('1000'),
            cgst=Decimal('0'), sgst=Decimal('0'), igst=Decimal('180'),
            source_type='b2b', source_id=location_id,
        )

    def test_irn_uses_store_gstin_not_company(self):
        LocationTaxProfile.objects.create(location_id=9, gstin=KA_GSTIN)
        e = self._entry(9)
        generate_irn_for_entry(e)
        e.refresh_from_db()
        expected = compute_irn(
            supplier_gstin=KA_GSTIN, doc_no='INV-1',
            doc_date=date(2026, 4, 5), doc_type=DOC_TYPE_MAP['B2B'],
        )
        self.assertEqual(e.irn, expected)
        # Must NOT equal the IRN computed from the company GSTIN.
        company_irn = compute_irn(
            supplier_gstin=MH_GSTIN, doc_no='INV-1',
            doc_date=date(2026, 4, 5), doc_type=DOC_TYPE_MAP['B2B'],
        )
        self.assertNotEqual(e.irn, company_irn)

    def test_irn_falls_back_to_company_gstin_when_no_profile(self):
        e = self._entry(10, invoice_no='INV-2')
        generate_irn_for_entry(e)
        e.refresh_from_db()
        expected = compute_irn(
            supplier_gstin=MH_GSTIN, doc_no='INV-2',
            doc_date=date(2026, 4, 5), doc_type=DOC_TYPE_MAP['B2B'],
        )
        self.assertEqual(e.irn, expected)


class SupplyTypeIdentityTests(TestCase):
    """The CGST/SGST-vs-IGST classification must follow the STORE's state."""

    def setUp(self):
        make_settings(gstin=MH_GSTIN, state_code='27')  # company = Maharashtra

    def test_same_customer_classified_per_store_state(self):
        LocationTaxProfile.objects.create(location_id=11, gstin=KA_GSTIN)  # store = KA
        gen = GSTR1Generator()
        customer_ka = '29ZZZZZ0000Z1Z5'

        # KA store selling to a KA customer → intra-state.
        gen._biz = LocationTaxProfile.resolve(11)
        self.assertEqual(gen._get_supply_type(customer_ka), 'intra_state')

        # Company default (MH) selling to the same KA customer → inter-state.
        gen._biz = LocationTaxProfile.resolve(None)
        self.assertEqual(gen._get_supply_type(customer_ka), 'inter_state')


class JournalGLSupplyTypeTests(TestCase):
    """The auto-generated JOURNAL ENTRIES must split CGST/SGST vs IGST by the
    SELLING STORE's state — otherwise the GL diverges from the filed return."""

    def setUp(self):
        make_settings(gstin=MH_GSTIN, state_code='27')  # company = Maharashtra

    def test_je_supply_type_follows_store_state(self):
        from journals.services import JournalAutoGenerationService
        LocationTaxProfile.objects.create(location_id=20, gstin=KA_GSTIN)  # KA store
        svc = JournalAutoGenerationService()
        customer_ka = '29ZZZZZ0000Z1Z5'
        # KA store selling to a KA customer → intra-state (CGST+SGST on the GL).
        self.assertEqual(svc._get_supply_type(customer_ka, location_id=20), 'intra_state')
        # The company-default (MH) anchor on the same customer → inter-state (IGST).
        self.assertEqual(svc._get_supply_type(customer_ka, location_id=None), 'inter_state')
        # Cached resolution stays consistent on repeat calls.
        self.assertEqual(svc._get_supply_type(customer_ka, location_id=20), 'intra_state')


class LocationTaxProfileAPITests(APITestCase):
    def setUp(self):
        make_settings(gstin=MH_GSTIN, state_code='27', company_name='Test Co')
        self.admin = make_admin()

    def test_put_creates_profile_and_derives_state(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.put(
            '/api/accounts/location-tax-profiles/',
            {'location_id': 12, 'gstin': KA_GSTIN}, format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['gstin'], KA_GSTIN)
        self.assertEqual(res.data['state_code'], '29')
        prof = LocationTaxProfile.objects.get(location_id=12)
        self.assertEqual(prof.gstin, KA_GSTIN)

    def test_put_updates_existing_profile(self):
        self.client.force_authenticate(user=self.admin)
        LocationTaxProfile.objects.create(location_id=13, gstin=KA_GSTIN)
        res = self.client.put(
            '/api/accounts/location-tax-profiles/',
            {'location_id': 13, 'legal_name': 'KA Branch'}, format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['legal_name'], 'KA Branch')
        # One row per location, not a duplicate.
        self.assertEqual(LocationTaxProfile.objects.filter(location_id=13).count(), 1)

    def test_put_rejects_bad_gstin_length(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.put(
            '/api/accounts/location-tax-profiles/',
            {'location_id': 14, 'gstin': 'TOOSHORT'}, format='json',
        )
        self.assertEqual(res.status_code, 400)

    def test_get_lists_locations_with_effective_fallback(self):
        self.client.force_authenticate(user=self.admin)
        LocationTaxProfile.objects.create(location_id=15, gstin=KA_GSTIN)
        fake_locs = [
            {'id': 15, 'name': 'KA Store', 'complete_name': 'KA Store'},
            {'id': 16, 'name': 'MH Store', 'complete_name': 'MH Store'},
        ]
        with mock.patch(
            'core.views.LocationTaxProfilesView._accessible_locations',
            return_value=fake_locs,
        ):
            res = self.client.get('/api/accounts/location-tax-profiles/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['company_gstin'], MH_GSTIN)
        by_id = {r['location_id']: r for r in res.data['profiles']}
        # Configured store shows its own GSTIN.
        self.assertEqual(by_id[15]['gstin'], KA_GSTIN)
        self.assertTrue(by_id[15]['has_profile'])
        # Unconfigured store falls back to the company GSTIN as "effective".
        self.assertEqual(by_id[16]['gstin'], '')
        self.assertFalse(by_id[16]['has_profile'])
        self.assertEqual(by_id[16]['effective_gstin'], MH_GSTIN)

    def test_put_denied_without_capability(self):
        regular = make_user(username='nobody')
        self.client.force_authenticate(user=regular)
        res = self.client.put(
            '/api/accounts/location-tax-profiles/',
            {'location_id': 17, 'gstin': KA_GSTIN}, format='json',
        )
        self.assertEqual(res.status_code, 403)
        self.assertFalse(LocationTaxProfile.objects.filter(location_id=17).exists())

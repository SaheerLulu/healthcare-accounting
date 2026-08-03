"""#710 — the Banking module could not create cheques or petty-cash floats.

Two location-scoping defects, both of which present to the user as a create
that fails with no usable reason:

  * A bank account with no location is company-wide as far as the write guard
    (_assert_bank_account_access) is concerned, but LocationFilterMixin's read
    filter excluded NULL — so the cheque form's bank picker was empty for every
    store, and there was nothing to select.
  * PettyCashFloatViewSet.perform_create overrode the mixin with a bare save(),
    so it never stamped the active store onto the float.
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from banking.models import BankAccount, PettyCashFloat
from core.models import ChartOfAccount
from core.tests.utils import (
    fake_active_location, make_admin, make_settings, seed_chart_and_mappings,
)


class BankAccountVisibilityTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        bank_gl = ChartOfAccount.objects.get(account_code='1120')
        # No location: the company's single shared bank account.
        self.shared = BankAccount.objects.create(
            name='HDFC Current', account_number='1', ifsc='HDFC0000001',
            chart_account=bank_gl, location_id=None,
        )
        # Tagged to store 2, and must stay invisible from store 1.
        self.other_store = BankAccount.objects.create(
            name='Branch B Account', account_number='2', ifsc='HDFC0000002',
            chart_account=bank_gl, location_id=2,
        )

    def test_shared_bank_account_is_visible_from_a_store(self):
        """The cheque form's bank picker reads this endpoint; when it comes
        back empty there is nothing to select and the cheque cannot be saved."""
        with fake_active_location(all_access=True):
            resp = self.client.get('/api/banking/accounts/', HTTP_X_LOCATION_ID='1')
        self.assertEqual(resp.status_code, 200)
        names = [a['name'] for a in resp.data]
        self.assertIn('HDFC Current', names)

    def test_another_stores_bank_account_stays_hidden(self):
        with fake_active_location(all_access=True):
            resp = self.client.get('/api/banking/accounts/', HTTP_X_LOCATION_ID='1')
        names = [a['name'] for a in resp.data]
        self.assertNotIn('Branch B Account', names)


class ChequeCreateTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        bank_gl = ChartOfAccount.objects.get(account_code='1120')
        self.store_account = BankAccount.objects.create(
            name='Branch A Account', account_number='1', ifsc='HDFC0000001',
            chart_account=bank_gl, location_id=1,
        )
        self.shared_account = BankAccount.objects.create(
            name='Shared', account_number='2', ifsc='HDFC0000002',
            chart_account=bank_gl, location_id=None,
        )

    def payload(self, account, cheque_no='000123'):
        return {
            'cheque_no': cheque_no, 'kind': 'issued',
            'bank_account': account.id, 'cheque_date': '2026-04-01',
            'amount': '5000.00', 'party_type': 'Supplier', 'party_id': 1,
            'party_name': 'Acme Distributors',
        }

    def test_cheque_saves_against_the_active_store(self):
        with fake_active_location(all_access=True):
            resp = self.client.post('/api/banking/cheques/',
                                    self.payload(self.store_account),
                                    format='json', HTTP_X_LOCATION_ID='1')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['location_id'], 1)

    def test_cheque_without_active_store_inherits_the_bank_accounts_store(self):
        """Saved in All-Stores mode, a cheque used to be stored unscoped and
        then vanished from the register as soon as a store was selected."""
        with fake_active_location(all_access=True):
            resp = self.client.post('/api/banking/cheques/',
                                    self.payload(self.store_account),
                                    format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['location_id'], 1)

    def test_unscopable_cheque_is_refused_with_a_reason(self):
        """No active store and a company-wide bank account: there is no store
        to file the cheque under, and the user must be told which."""
        with fake_active_location(all_access=True):
            resp = self.client.post('/api/banking/cheques/',
                                    self.payload(self.shared_account),
                                    format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        body = str(resp.data).lower()
        self.assertIn('store', body)


class PettyCashFloatCreateTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_float_is_stamped_with_the_active_store(self):
        cash_gl = ChartOfAccount.objects.get(account_code='1110')
        with fake_active_location(all_access=True):
            resp = self.client.post('/api/banking/petty-cash/', {
                'chart_account': cash_gl.id,
                'imprest_amount': '2000.00',
                'replenishment_threshold': '500.00',
                'location_name': 'Branch A',
            }, format='json', HTTP_X_LOCATION_ID='1')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(PettyCashFloat.objects.get(pk=resp.data['id']).location_id, 1)

    def test_float_without_a_store_is_refused_with_a_reason(self):
        cash_gl = ChartOfAccount.objects.get(account_code='1110')
        with fake_active_location(all_access=True):
            resp = self.client.post('/api/banking/petty-cash/', {
                'chart_account': cash_gl.id,
                'imprest_amount': '2000.00',
                'replenishment_threshold': '500.00',
            }, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('store', str(resp.data).lower())

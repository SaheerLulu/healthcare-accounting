"""The supplier/customer pickers behind payment, receipt and bill vouchers
must not offer the pharmacy's internal store counterparties (is_internal):
inter-store transfers post as stock relocations with no payable or
receivable, so there is nothing to settle against 'Store: <name>'."""
from types import SimpleNamespace
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import fake_active_location, make_admin
from core.views import CustomersListView, SuppliersListView
from parties.tests.test_balances import _FakePartyQS

STORE_A = 1


class _PickerQS(_FakePartyQS):
    """The pickers also .values() the rows; hand back dicts like Django would."""

    def values(self, *fields):
        return [{f: getattr(r, f) for f in fields} for r in self.rows]


def _supplier(pk, name, *, internal=False, location_id=STORE_A):
    return SimpleNamespace(id=pk, company_name=name, is_internal=internal,
                           location_id=location_id)


def _customer(pk, name, *, internal=False, location_id=STORE_A):
    return SimpleNamespace(id=pk, customer_name=name, is_internal=internal,
                           location_id=location_id)


class InternalStoresAreNotPickableTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _get(self, view, path):
        request = self.factory.get(path, HTTP_X_LOCATION_ID=str(STORE_A))
        force_authenticate(request, self.admin)
        with fake_active_location(all_access=True):
            return view.as_view()(request).data

    def test_supplier_picker_hides_the_store_rows(self):
        rows = _PickerQS([
            _supplier(20, 'Store A Distributor'),
            _supplier(90, 'Store: Branch A', internal=True, location_id=None),
        ])
        with mock.patch('core.views.SupplierRO', SimpleNamespace(objects=rows)):
            data = self._get(SuppliersListView, '/api/accounts/suppliers/')
        self.assertEqual([r['name'] for r in data], ['Store A Distributor'])

    def test_customer_picker_hides_the_store_rows(self):
        rows = _PickerQS([
            _customer(4, 'Delta Traders'),
            _customer(91, 'TEST STORE MEDIMART', internal=True, location_id=None),
        ])
        with mock.patch('core.views.CustomerRO', SimpleNamespace(objects=rows)):
            data = self._get(CustomersListView, '/api/accounts/customers/')
        self.assertEqual([r['name'] for r in data], ['Delta Traders'])

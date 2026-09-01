"""What the Parties list shows, and what it can be narrowed to.

Two reported defects:

  * A party master row whose `location` is NULL vanished from the list as soon
    as a store was picked. Those NULL rows are exactly the shared
    counterparties the pharmacy auto-creates — the live DB ships
    'Unregistered Supplier' (location NULL, gst_no 'UNREG') — so a supplier
    that HAD an outstanding balance in the active store had no row to show it
    on, and no way to reach a payment from. The balance aggregate scopes by
    the ENTRY's location, so the money was always counted; only the row that
    displays it was missing.
  * Customers could not be filtered by customer type at all.
"""
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import (
    fake_active_location, make_admin, make_settings, seed_chart_and_mappings,
)
from journals.models import JournalEntry, JournalEntryLine
from parties import services
from parties.tests.test_balances import _FakePartyQS
from parties.views import CustomersListView, SuppliersListView

STORE_A = 1
STORE_B = 2
UNREG_SUPPLIER = 13


def _fake_supplier(pk, name, location_id):
    return SimpleNamespace(
        id=pk, company_name=name, gst_no='', phone='', email='',
        city='', state='', status='Active', location_id=location_id,
    )


def _fake_customer(pk, name, location_id, customer_type='Retail'):
    return SimpleNamespace(
        id=pk, customer_name=name, gst_no='', phone='', email='',
        city='', state='', status='Active', location_id=location_id,
        customer_type=customer_type,
    )


def _patch(model_name, *rows):
    return mock.patch(f'inventory_reader.models.{model_name}',
                      SimpleNamespace(objects=_FakePartyQS(rows)))


def _bill(payable, stock, supplier_id, amount, *, location_id):
    entry = JournalEntry.objects.create(
        date='2026-04-10', narration='bill', voucher_type='PURCHASE',
        reference_type='Manual', location_id=location_id,
    )
    JournalEntryLine.objects.create(entry=entry, account=stock,
                                    debit=Decimal(amount), credit=Decimal('0'))
    JournalEntryLine.objects.create(
        entry=entry, account=payable, debit=Decimal('0'), credit=Decimal(amount),
        party_type='Supplier', party_id=supplier_id)
    entry.post()
    return entry


class StorelessPartyIsListedTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()

    def test_storeless_supplier_appears_in_a_store_list(self):
        with _patch('SupplierRO',
                    _fake_supplier(UNREG_SUPPLIER, 'Unregistered Supplier', None),
                    _fake_supplier(20, 'Store A Distributor', STORE_A),
                    _fake_supplier(30, 'Store B Distributor', STORE_B)):
            names = [r['name'] for r in
                     services.list_parties('Supplier', location_id=STORE_A)]
        self.assertIn('Unregistered Supplier', names)
        self.assertIn('Store A Distributor', names)
        # The widening is only about NULL — another store's rows stay out.
        self.assertNotIn('Store B Distributor', names)

    def test_the_storeless_row_carries_the_balance_owed_in_this_store(self):
        """The point of listing it: it is owed money, and the payable was
        already being aggregated for it."""
        _bill(self.coa['2110'], self.coa['1190'], UNREG_SUPPLIER, '694.40',
              location_id=STORE_A)
        with _patch('SupplierRO',
                    _fake_supplier(UNREG_SUPPLIER, 'Unregistered Supplier', None)):
            rows = services.list_parties('Supplier', location_id=STORE_A)
        self.assertEqual(len(rows), 1)
        self.assertEqual(Decimal(rows[0]['outstanding']), Decimal('694.40'))

    def test_a_storeless_partys_balance_stays_scoped_to_the_entrys_store(self):
        # Listing the row everywhere must not leak another store's debt onto it.
        _bill(self.coa['2110'], self.coa['1190'], UNREG_SUPPLIER, '694.40',
              location_id=STORE_A)
        with _patch('SupplierRO',
                    _fake_supplier(UNREG_SUPPLIER, 'Unregistered Supplier', None)):
            rows_b = services.list_parties('Supplier', location_id=STORE_B)
            rows_all = services.list_parties('Supplier')
        self.assertEqual(Decimal(rows_b[0]['outstanding']), Decimal('0.00'))
        self.assertEqual(Decimal(rows_all[0]['outstanding']), Decimal('694.40'))

    def test_storeless_customer_appears_too(self):
        with _patch('CustomerRO',
                    _fake_customer(50, 'Walk-in Account', None),
                    _fake_customer(51, 'Store A Clinic', STORE_A)):
            names = {r['name'] for r in
                     services.list_parties('Customer', location_id=STORE_A)}
        # A set: the fake queryset's order_by is a stand-in that sorts by id,
        # so asserting a sequence here would pin the double, not the service.
        self.assertEqual(names, {'Store A Clinic', 'Walk-in Account'})


class CustomerTypeFilterTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.rows = (
            _fake_customer(1, 'Anand Retail', STORE_A, 'Retail'),
            _fake_customer(2, 'Bharat Hospital', STORE_A, 'Hospital'),
            _fake_customer(3, 'City Clinic', STORE_A, 'Clinic'),
            _fake_customer(4, 'Delta Traders', STORE_A, 'B2B'),
        )

    def _names(self, **kw):
        with _patch('CustomerRO', *self.rows):
            return [r['name'] for r in services.list_parties('Customer', **kw)]

    def test_no_filter_lists_every_type(self):
        self.assertEqual(len(self._names()), 4)

    def test_single_type(self):
        self.assertEqual(self._names(customer_type='Hospital'),
                         ['Bharat Hospital'])

    def test_comma_separated_types(self):
        # Same shape the pharmacy customer API accepts (?customer_type=A,B).
        self.assertEqual(self._names(customer_type='Hospital,B2B'),
                         ['Bharat Hospital', 'Delta Traders'])

    def test_whitespace_and_empty_segments_are_ignored(self):
        self.assertEqual(self._names(customer_type=' Clinic , '),
                         ['City Clinic'])

    def test_blank_filter_is_not_a_filter(self):
        self.assertEqual(len(self._names(customer_type='')), 4)
        self.assertEqual(len(self._names(customer_type=' , ')), 4)

    def test_unknown_type_matches_nothing(self):
        self.assertEqual(self._names(customer_type='Wholesale'), [])


class PartyListApiTests(TestCase):
    """The query parameter is actually wired to the view."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _get(self, view, path, params=None, location_id=STORE_A):
        request = self.factory.get(path, params or {},
                                   HTTP_X_LOCATION_ID=str(location_id))
        force_authenticate(request, self.admin)
        with fake_active_location(all_access=True):
            return view.as_view()(request).data

    def test_customer_type_query_param_filters(self):
        with _patch('CustomerRO',
                    _fake_customer(1, 'Anand Retail', STORE_A, 'Retail'),
                    _fake_customer(2, 'Bharat Hospital', STORE_A, 'Hospital')):
            data = self._get(CustomersListView, '/api/parties/customers/',
                             {'customer_type': 'Hospital'})
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['rows'][0]['name'], 'Bharat Hospital')

    def test_supplier_list_includes_the_storeless_row(self):
        with _patch('SupplierRO',
                    _fake_supplier(UNREG_SUPPLIER, 'Unregistered Supplier', None)):
            data = self._get(SuppliersListView, '/api/parties/suppliers/')
        self.assertEqual([r['name'] for r in data['rows']],
                         ['Unregistered Supplier'])

"""Open supplier/customer invoices must state a due date.

Reported: a credit purchase from a supplier configured with 21 credit days
showed its amount on Payables but no Due Date. Neither the purchase order nor
the journal entry carries a due date, so the only source is the party master's
`credit_days` — which the report was never reading.
"""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import make_admin, make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine
from reports.views import OpenCustomerInvoicesView, OpenSupplierInvoicesView

CIPLA = 4
CLINIC = 8
STORE = 1
BILL_DATE = date.today() - timedelta(days=5)


def _jv(lines, *, voucher_type):
    """Balanced, posted JE from (account, debit, credit, party) tuples, where
    `party` is (party_type, party_id) or None."""
    entry = JournalEntry.objects.create(
        date=BILL_DATE, narration='test', voucher_type=voucher_type,
        reference_type='Manual', location_id=STORE,
    )
    for acct, dr, cr, party in lines:
        JournalEntryLine.objects.create(
            entry=entry, account=acct, debit=Decimal(dr), credit=Decimal(cr),
            party_type=party[0] if party else 'None',
            party_id=party[1] if party else None,
        )
    entry.post()
    return entry


class _FakeRO:
    """Stand-in for SupplierRO.objects / CustomerRO.objects — the inventory
    proxy tables are managed=False and absent from the test DB."""

    def __init__(self, rows):
        self.rows = rows

    def filter(self, **kw):
        ids = kw.get('id__in')
        return _FakeRO([r for r in self.rows if ids is None or r['id'] in ids])

    def values(self, *fields):
        return [{f: r.get(f) for f in fields} for r in self.rows]


def _patch_master(model_name, rows):
    return mock.patch(f'inventory_reader.models.{model_name}',
                      SimpleNamespace(objects=_FakeRO(rows)))


class SupplierInvoiceDueDateTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        # A ₹694.40 credit purchase from Cipla — the reported shape.
        _jv([(self.coa['1190'], '694.40', '0', None),
             (self.coa['2110'], '0', '694.40', ('Supplier', CIPLA))],
            voucher_type='PURCHASE')

    def _rows(self, master_rows):
        request = self.factory.get('/api/reports/open-supplier-invoices/')
        force_authenticate(request, self.admin)
        with _patch_master('SupplierRO', master_rows):
            return OpenSupplierInvoicesView.as_view()(request).data['rows']

    def test_due_date_is_bill_date_plus_credit_days(self):
        rows = self._rows([{'id': CIPLA, 'company_name': 'Cipla',
                            'credit_days': 21}])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['party_name'], 'Cipla')
        self.assertEqual(rows[0]['credit_days'], 21)
        self.assertEqual(rows[0]['due_date'],
                         (BILL_DATE + timedelta(days=21)).isoformat())

    def test_zero_credit_days_is_due_on_the_bill_date(self):
        """0 is 'due on presentation', not 'terms unknown' — it still gets a
        date, or a cash-terms supplier would look like it had no due date."""
        rows = self._rows([{'id': CIPLA, 'company_name': 'Cash Vendor',
                            'credit_days': 0}])
        self.assertEqual(rows[0]['due_date'], BILL_DATE.isoformat())

    def test_null_credit_days_is_treated_as_zero(self):
        rows = self._rows([{'id': CIPLA, 'company_name': 'Cipla',
                            'credit_days': None}])
        self.assertEqual(rows[0]['credit_days'], 0)
        self.assertEqual(rows[0]['due_date'], BILL_DATE.isoformat())

    def test_unknown_supplier_master_leaves_the_due_date_blank(self):
        # Nothing to compute terms from — better an empty cell than a made-up
        # date somebody might pay against.
        rows = self._rows([])
        self.assertIsNone(rows[0]['due_date'])
        self.assertIsNone(rows[0]['credit_days'])


class UntaggedInvoiceDueDateTests(TestCase):
    """An untagged payable has no party, so it has no terms and no due date."""

    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        _jv([(self.coa['1190'], '500', '0', None),
             (self.coa['2110'], '0', '500', None)], voucher_type='PURCHASE')

    def test_untagged_row_has_no_due_date(self):
        request = self.factory.get('/api/reports/open-supplier-invoices/')
        force_authenticate(request, self.admin)
        with _patch_master('SupplierRO', []):
            rows = OpenSupplierInvoicesView.as_view()(request).data['rows']
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]['party_id'])
        self.assertIsNone(rows[0]['due_date'])


class CustomerInvoiceDueDateTests(TestCase):
    """The receivables side reads the same way — CustomerRO.credit_days."""

    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        _jv([(self.coa['1130'], '1000', '0', ('Customer', CLINIC)),
             (self.coa['4100'], '0', '1000', None)], voucher_type='SALE')

    def test_due_date_is_invoice_date_plus_credit_days(self):
        request = self.factory.get('/api/reports/open-customer-invoices/')
        force_authenticate(request, self.admin)
        with _patch_master('CustomerRO', [{'id': CLINIC,
                                           'customer_name': 'City Clinic',
                                           'credit_days': 30}]):
            rows = OpenCustomerInvoicesView.as_view()(request).data['rows']
        self.assertEqual(rows[0]['credit_days'], 30)
        self.assertEqual(rows[0]['due_date'],
                         (BILL_DATE + timedelta(days=30)).isoformat())

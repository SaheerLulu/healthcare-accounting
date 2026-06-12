"""Per-invoice (bill-wise) payment allocation: the open-supplier-invoices
endpoint, the over-allocation guard, and reversal releasing allocations."""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from bills.models import Bill
from core.models import ChartOfAccount
from core.tests.utils import make_admin, make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine, BillReference
from journals.serializers import BillReferenceSerializer
from journals.views import BillReferenceViewSet, JournalEntryViewSet
from reports.views import OpenSupplierInvoicesView


def _purchase_invoice(supplier_id, amount, d=date(2026, 4, 10)):
    """Posted purchase invoice: Dr Closing Stock / Cr Trade Payables (party-tagged)."""
    payable = ChartOfAccount.objects.get(account_code='2110')
    stock = ChartOfAccount.objects.get(account_code='1190')
    e = JournalEntry.objects.create(
        date=d, voucher_type='PURCHASE', reference_type='PurchaseOrder',
        reference_id=supplier_id * 100, location_id=1,
        narration=f'Purchase Invoice: PI-{supplier_id}')
    JournalEntryLine.objects.create(entry=e, account=stock, debit=Decimal(amount))
    JournalEntryLine.objects.create(entry=e, account=payable, credit=Decimal(amount),
                                    party_type='Supplier', party_id=supplier_id)
    e.post()
    return e


def _payment(supplier_id, amount, *, against=None, d=date(2026, 4, 20)):
    """Posted payment: Dr Trade Payables (party-tagged) / Cr Bank, with an
    optional AGAINST allocation to `against` (a purchase-invoice entry)."""
    payable = ChartOfAccount.objects.get(account_code='2110')
    bank = ChartOfAccount.objects.get(account_code='1120')
    e = JournalEntry.objects.create(
        date=d, voucher_type='PAYMENT', reference_type='Manual', location_id=1)
    pline = JournalEntryLine.objects.create(
        entry=e, account=payable, debit=Decimal(amount),
        party_type='Supplier', party_id=supplier_id)
    JournalEntryLine.objects.create(entry=e, account=bank, credit=Decimal(amount))
    e.post()
    if against is not None:
        BillReference.objects.create(line=pline, kind='AGAINST',
                                     ref_no=against.entry_no, amount=Decimal(amount))
    return e, pline


class OpenSupplierInvoicesTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()

    def _rows(self, supplier_id=None):
        f = APIRequestFactory()
        req = f.get('/api/reports/open-supplier-invoices/?date=2026-12-31')
        force_authenticate(req, user=self.admin)
        resp = OpenSupplierInvoicesView.as_view()(req)
        self.assertEqual(resp.status_code, 200)
        rows = resp.data['rows']
        return [r for r in rows if supplier_id is None or r['party_id'] == supplier_id]

    def test_lists_open_purchase_invoice(self):
        e = _purchase_invoice(5, '1000.00')
        rows = self._rows(5)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['invoice_no'], e.entry_no)
        self.assertEqual(rows[0]['amount'], '1000.00')
        self.assertEqual(rows[0]['outstanding_amount'], '1000.00')
        self.assertEqual(rows[0]['paid_amount'], '0.00')

    def test_fully_paid_supplier_drops_out(self):
        _purchase_invoice(6, '500.00')
        _payment(6, '500.00')  # plain debit, no AGAINST — net 0 at party level
        self.assertEqual(self._rows(6), [])

    def test_against_allocation_nets_outstanding(self):
        e = _purchase_invoice(7, '1000.00')
        _payment(7, '400.00', against=e)
        rows = self._rows(7)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['paid_amount'], '400.00')
        self.assertEqual(rows[0]['outstanding_amount'], '600.00')


class OverAllocationGuardTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def _payment_line(self, supplier_id, amount):
        _, pline = _payment(supplier_id, amount)
        return pline

    def test_rejects_allocation_beyond_invoice_balance(self):
        e = _purchase_invoice(8, '1000.00')
        pline = self._payment_line(8, '1500.00')
        ser = BillReferenceSerializer(data={
            'line': pline.id, 'kind': 'AGAINST', 'ref_no': e.entry_no, 'amount': '1500.00'})
        self.assertFalse(ser.is_valid())

    def test_allows_allocation_within_balance(self):
        e = _purchase_invoice(9, '1000.00')
        pline = self._payment_line(9, '800.00')
        ser = BillReferenceSerializer(data={
            'line': pline.id, 'kind': 'AGAINST', 'ref_no': e.entry_no, 'amount': '800.00'})
        self.assertTrue(ser.is_valid(), ser.errors)

    def test_rejects_cumulative_over_allocation(self):
        e = _purchase_invoice(10, '1000.00')
        _, p1 = _payment(10, '700.00', against=e)  # 700 already AGAINST
        _, p2 = _payment(10, '700.00')
        ser = BillReferenceSerializer(data={
            'line': p2.id, 'kind': 'AGAINST', 'ref_no': e.entry_no, 'amount': '700.00'})
        self.assertFalse(ser.is_valid())  # 700 + 700 > 1000


class BillLinkedAllocationTests(TestCase):
    """H32 — AGAINST allocations carrying a bills-app bill_id must be capped
    at the bill's balance due, settle the bill on create, and roll back on
    JE reversal / reference delete / draft-voucher delete."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        # An 'open' posted bill for ₹1000 (recalc_status needs a linked JE).
        je = _purchase_invoice(20, '1000.00')
        self.bill = Bill.objects.create(
            bill_no='UB-100', bill_date=date(2026, 4, 1),
            vendor_id=20, vendor_name='Utility Co',
            subtotal=Decimal('1000.00'), total_amount=Decimal('1000.00'),
            location_id=1, journal_entry=je, status='open',
        )

    def _post_ref(self, line, amount, bill=None):
        req = self.factory.post('/api/journals/bill-references/', {
            'line': line.id, 'kind': 'AGAINST',
            'ref_no': (bill or self.bill).bill_no, 'amount': str(amount),
            'bill_id': (bill or self.bill).id,
        }, format='json')
        force_authenticate(req, user=self.admin)
        return BillReferenceViewSet.as_view({'post': 'create'})(req)

    def test_over_allocation_against_bill_rejected(self):
        _, pline = _payment(20, '1500.00')
        resp = self._post_ref(pline, '1500.00')
        self.assertEqual(resp.status_code, 400, getattr(resp, 'data', None))
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.amount_paid, Decimal('0.00'))

    def test_allocation_applies_to_bill_and_caps_cumulative(self):
        _, pline = _payment(20, '400.00')
        resp = self._post_ref(pline, '400.00')
        self.assertEqual(resp.status_code, 201, getattr(resp, 'data', None))
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.amount_paid, Decimal('400.00'))
        self.assertEqual(self.bill.status, 'partially_paid')

        # Only ₹600 left — a ₹700 second allocation must be refused.
        _, pline2 = _payment(20, '700.00')
        resp = self._post_ref(pline2, '700.00')
        self.assertEqual(resp.status_code, 400)

        resp = self._post_ref(pline2, '600.00')
        self.assertEqual(resp.status_code, 201, getattr(resp, 'data', None))
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.amount_paid, Decimal('1000.00'))
        self.assertEqual(self.bill.status, 'paid')

    def test_reversal_rolls_allocation_back(self):
        pe, pline = _payment(20, '1000.00')
        self._post_ref(pline, '1000.00')
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, 'paid')

        req = self.factory.post(f'/api/journals/entries/{pe.id}/reverse/',
                                {}, format='json')
        force_authenticate(req, user=self.admin)
        resp = JournalEntryViewSet.as_view({'post': 'reverse_entry'})(req, pk=pe.id)
        self.assertEqual(resp.status_code, 201, getattr(resp, 'data', None))

        self.bill.refresh_from_db()
        self.assertEqual(self.bill.amount_paid, Decimal('0.00'))
        self.assertEqual(self.bill.status, 'open')

    def test_deleting_reference_rolls_allocation_back(self):
        _, pline = _payment(20, '300.00')
        resp = self._post_ref(pline, '300.00')
        ref_id = resp.data['id']
        req = self.factory.delete(f'/api/journals/bill-references/{ref_id}/')
        force_authenticate(req, user=self.admin)
        resp = BillReferenceViewSet.as_view({'delete': 'destroy'})(req, pk=ref_id)
        self.assertEqual(resp.status_code, 204)
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.amount_paid, Decimal('0.00'))
        self.assertEqual(self.bill.status, 'open')

    def test_deleting_draft_voucher_rolls_allocation_back(self):
        # Draft payment voucher (not posted) with an applied allocation.
        payable = ChartOfAccount.objects.get(account_code='2110')
        bank = ChartOfAccount.objects.get(account_code='1120')
        draft = JournalEntry.objects.create(
            date=date(2026, 4, 21), voucher_type='PAYMENT',
            reference_type='Manual', location_id=1)
        dline = JournalEntryLine.objects.create(
            entry=draft, account=payable, debit=Decimal('250.00'),
            party_type='Supplier', party_id=20)
        JournalEntryLine.objects.create(
            entry=draft, account=bank, credit=Decimal('250.00'))
        self._post_ref(dline, '250.00')
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.amount_paid, Decimal('250.00'))

        req = self.factory.delete(f'/api/journals/entries/{draft.id}/')
        force_authenticate(req, user=self.admin)
        resp = JournalEntryViewSet.as_view({'delete': 'destroy'})(req, pk=draft.id)
        self.assertEqual(resp.status_code, 204, getattr(resp, 'data', None))
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.amount_paid, Decimal('0.00'))


class ReversalReleasesAllocationsTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()

    def test_reversing_payment_deletes_against_and_reopens_invoice(self):
        e = _purchase_invoice(11, '1000.00')
        pe, pline = _payment(11, '1000.00', against=e)
        self.assertEqual(BillReference.objects.filter(line__entry=pe).count(), 1)

        factory = APIRequestFactory()
        req = factory.post(f'/api/journals/entries/{pe.id}/reverse/', {}, format='json')
        force_authenticate(req, user=self.admin)
        resp = JournalEntryViewSet.as_view({'post': 'reverse_entry'})(req, pk=pe.id)
        self.assertEqual(resp.status_code, 201, getattr(resp, 'data', None))

        # Allocation released → invoice re-opens.
        self.assertEqual(BillReference.objects.filter(line__entry=pe).count(), 0)

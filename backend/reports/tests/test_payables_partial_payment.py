"""#711 — Payables must show what is still owed, not what was invoiced.

The per-invoice payables/receivables report netted only *explicit* bill-wise
allocations (journals.BillReference AGAINST). None of the four payment paths in
the app writes one, so a plain part-payment left every invoice sitting at its
gross amount even though the supplier ledger, the aging report and the
dashboard had all already netted it.
"""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import make_admin, make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine
from reports.views import (
    OpenCustomerInvoicesView, OpenSupplierInvoicesView, PayablesAgingView,
)

SUPPLIER = 99
CUSTOMER = 77


def _entry(d, lines, *, entry_no, voucher_type='JOURNAL', location_id=1):
    """A posted JE whose party-tagged lines carry party_type/party_id.

    make_journal_entry() in core.tests.utils cannot do this — the report keys
    entirely off the party tag, so the tests have to set it.
    """
    entry = JournalEntry.objects.create(
        date=d, narration=f'{entry_no} narration', voucher_type=voucher_type,
        reference_type='Manual', location_id=location_id, entry_no=entry_no,
    )
    for account, debit, credit, party_type, party_id in lines:
        JournalEntryLine.objects.create(
            entry=entry, account=account, debit=debit, credit=credit,
            party_type=party_type or '', party_id=party_id,
        )
    entry.post()
    return entry


class PayablesPartialPaymentTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        self.payable = self.coa['2110']
        self.purchases = self.coa['5100']
        self.cash = self.coa['1110']
        self.receivable = self.coa['1130']
        self.sales = self.coa['4100']

    # ── fixtures ─────────────────────────────────────────────────────────────

    def purchase(self, amount, *, on=date(2026, 4, 1), entry_no='PUR-1'):
        """A supplier invoice: credit Payable (the obligation), debit Purchases."""
        return _entry(on, [
            (self.purchases, Decimal(amount), Decimal('0'), '', None),
            (self.payable, Decimal('0'), Decimal(amount), 'Supplier', SUPPLIER),
        ], entry_no=entry_no, voucher_type='PURCHASE')

    def payment(self, amount, *, on=date(2026, 4, 10), entry_no='PAY-1'):
        """A plain part-payment with no bill-wise allocation — what every
        payment path in the app actually writes."""
        return _entry(on, [
            (self.payable, Decimal(amount), Decimal('0'), 'Supplier', SUPPLIER),
            (self.cash, Decimal('0'), Decimal(amount), '', None),
        ], entry_no=entry_no, voucher_type='PAYMENT')

    def sale(self, amount, *, on=date(2026, 4, 1), entry_no='SAL-1'):
        return _entry(on, [
            (self.receivable, Decimal(amount), Decimal('0'), 'Customer', CUSTOMER),
            (self.sales, Decimal('0'), Decimal(amount), '', None),
        ], entry_no=entry_no, voucher_type='SALE')

    def receipt(self, amount, *, on=date(2026, 4, 10), entry_no='REC-1'):
        return _entry(on, [
            (self.cash, Decimal(amount), Decimal('0'), '', None),
            (self.receivable, Decimal('0'), Decimal(amount), 'Customer', CUSTOMER),
        ], entry_no=entry_no, voucher_type='RECEIPT')

    # ── helpers ──────────────────────────────────────────────────────────────

    def open_supplier_invoices(self):
        request = self.factory.get('/api/reports/open-supplier-invoices/',
                                   {'date': '2026-04-30'})
        force_authenticate(request, self.admin)
        return OpenSupplierInvoicesView.as_view()(request).data

    def open_customer_invoices(self):
        request = self.factory.get('/api/reports/open-customer-invoices/',
                                   {'date': '2026-04-30'})
        force_authenticate(request, self.admin)
        return OpenCustomerInvoicesView.as_view()(request).data

    def payables_aging(self):
        request = self.factory.get('/api/reports/payables-aging/',
                                   {'date': '2026-04-30'})
        force_authenticate(request, self.admin)
        # The aging view resolves supplier names/GSTINs straight from the
        # inventory master, whose tables are unmanaged and absent under SQLite.
        with patch('reports.views._party_tax_details', return_value={}):
            return PayablesAgingView.as_view()(request).data

    # ── the ticket's acceptance criteria ─────────────────────────────────────

    def test_partial_payment_reduces_the_payable(self):
        """Bill of 10,000; pay 4,000 -> Payables shows 6,000."""
        self.purchase('10000')
        self.payment('4000')

        data = self.open_supplier_invoices()
        self.assertEqual(len(data['rows']), 1)
        row = data['rows'][0]
        self.assertEqual(Decimal(row['amount']), Decimal('10000.00'))
        self.assertEqual(Decimal(row['paid_amount']), Decimal('4000.00'))
        self.assertEqual(Decimal(row['outstanding_amount']), Decimal('6000.00'))
        self.assertEqual(Decimal(data['total_outstanding']), Decimal('6000.00'))

    def test_paying_the_remainder_clears_the_payable(self):
        """Pay the remaining 6,000 -> Payables 0."""
        self.purchase('10000')
        self.payment('4000')
        self.payment('6000', on=date(2026, 4, 20), entry_no='PAY-2')

        data = self.open_supplier_invoices()
        self.assertEqual(data['rows'], [])
        self.assertEqual(Decimal(data['total_outstanding']), Decimal('0.00'))

    def test_multiple_partial_payments_accumulate(self):
        self.purchase('10000')
        self.payment('2000', on=date(2026, 4, 5), entry_no='PAY-1')
        self.payment('2000', on=date(2026, 4, 6), entry_no='PAY-2')
        self.payment('2000', on=date(2026, 4, 7), entry_no='PAY-3')

        data = self.open_supplier_invoices()
        self.assertEqual(Decimal(data['rows'][0]['outstanding_amount']),
                         Decimal('4000.00'))

    def test_overpayment_leaves_nothing_outstanding(self):
        """An advance/overpayment is not a payable — the supplier drops out
        rather than showing a negative balance."""
        self.purchase('10000')
        self.payment('12000')

        data = self.open_supplier_invoices()
        self.assertEqual(data['rows'], [])
        self.assertEqual(Decimal(data['total_outstanding']), Decimal('0.00'))

    def test_on_account_payment_is_applied_oldest_first(self):
        """Unallocated money settles the oldest invoice first, the same rule
        _age_open_invoices already uses, so the two reports agree."""
        self.purchase('6000', on=date(2026, 4, 1), entry_no='PUR-OLD')
        self.purchase('4000', on=date(2026, 4, 15), entry_no='PUR-NEW')
        self.payment('8000', on=date(2026, 4, 20))

        rows = self.open_supplier_invoices()['rows']
        self.assertEqual([r['invoice_no'] for r in rows], ['PUR-NEW'])
        self.assertEqual(Decimal(rows[0]['outstanding_amount']), Decimal('2000.00'))

    def test_explicit_allocation_takes_priority_over_fifo(self):
        """A payment that names its invoice settles that one; it must not also
        be counted as on-account money against the older invoice."""
        from journals.models import BillReference

        self.purchase('5000', on=date(2026, 4, 1), entry_no='PUR-OLD')
        newer = self.purchase('5000', on=date(2026, 4, 15), entry_no='PUR-NEW')
        pay = self.payment('3000', on=date(2026, 4, 20))
        BillReference.objects.create(
            line=pay.lines.get(account=self.payable), kind='AGAINST',
            ref_no=newer.entry_no, ref_date=newer.date, amount=Decimal('3000'),
        )

        rows = {r['invoice_no']: r for r in self.open_supplier_invoices()['rows']}
        self.assertEqual(Decimal(rows['PUR-OLD']['outstanding_amount']),
                         Decimal('5000.00'))
        self.assertEqual(Decimal(rows['PUR-NEW']['outstanding_amount']),
                         Decimal('2000.00'))

    def test_total_reconciles_with_aging_report(self):
        """The per-invoice page and the aging report describe the same debt;
        they must not disagree about how much of it is left."""
        self.purchase('10000')
        self.payment('4000')

        page = Decimal(self.open_supplier_invoices()['total_outstanding'])
        aging = Decimal(self.payables_aging()['total_outstanding'])
        self.assertEqual(page, aging)
        self.assertEqual(page, Decimal('6000.00'))

    def test_receivables_net_partial_receipts_symmetrically(self):
        self.sale('10000')
        self.receipt('4000')

        data = self.open_customer_invoices()
        self.assertEqual(len(data['rows']), 1)
        row = data['rows'][0]
        self.assertEqual(Decimal(row['amount']), Decimal('10000.00'))
        self.assertEqual(Decimal(row['paid_amount']), Decimal('4000.00'))
        self.assertEqual(Decimal(row['outstanding_amount']), Decimal('6000.00'))
        self.assertEqual(Decimal(data['total_outstanding']), Decimal('6000.00'))


class PayablesTabOverlapTests(TestCase):
    """The Payables page sums its two tabs, so a bill that appears in both is
    counted twice in the grand total."""

    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def test_bills_app_bill_does_not_also_appear_as_a_gl_invoice(self):
        from bills.models import Bill

        entry = _entry(date(2026, 4, 1), [
            (self.coa['5100'], Decimal('10000'), Decimal('0'), '', None),
            (self.coa['2110'], Decimal('0'), Decimal('10000'), 'Supplier', SUPPLIER),
        ], entry_no='BILL-JE-1', voucher_type='PURCHASE')
        Bill.objects.create(
            bill_no='INV-001', vendor_id=SUPPLIER, bill_date=date(2026, 4, 1),
            due_date=date(2026, 5, 1), total_amount=Decimal('10000'),
            journal_entry=entry, location_id=1,
        )

        request = self.factory.get('/api/reports/open-supplier-invoices/',
                                   {'date': '2026-04-30'})
        force_authenticate(request, self.admin)
        data = OpenSupplierInvoicesView.as_view()(request).data

        # The Vendor Bills tab already owns this obligation.
        self.assertEqual(data['rows'], [])
        self.assertEqual(Decimal(data['total_outstanding']), Decimal('0.00'))

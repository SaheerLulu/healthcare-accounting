"""Issues 3/4/5 — receivables/payables that the tag-based reports hid or ate.

#4  journals.services._sale_settlement books a CREDIT sale with no named
    customer onto the shared 1130 control and deliberately drops the party tag
    (core/party_ledgers.py:15 — walk-ins never get their own ledger). Every
    receivables surface filtered on that tag, so the posting layer created rows
    the reporting layer could not show: a walk-in credit sale of 1,180 left
    open-customer-invoices and receivables-aging empty while the trial balance
    carried 1130 Dr 1,180.

#3  The AGAINST-allocation lookup matched on ref_no alone, so a bills-app
    bill_no colliding with a JE entry_no netted a GL invoice a second time; and
    on-account money that exceeds a party's GL invoicing drained the oldest-first
    pool through every unrelated invoice until `if net <= 0` erased the party.

The widening is by ACCOUNT IDENTITY (the TRADE_RECEIVABLES/TRADE_PAYABLES
mapping), never by account_subtype — 'Receivable' is shared with advances,
deposits and prepaids, 'Payable' with PF/ESI/PT/Net Salary and provisions.
"""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.models import ChartOfAccount
from core.tests.utils import make_admin, make_settings, seed_chart_and_mappings
from journals.models import BillReference, JournalEntry, JournalEntryLine
from reports.views import (
    OpenCustomerInvoicesView, OpenSupplierInvoicesView,
    PayablesAgingView, ReceivablesAgingView,
)

CUSTOMER = 41
SUPPLIER = 42
WALKIN_LABEL = 'Walk-in / Cash Customer'
UNNAMED_SUPPLIER_LABEL = 'Unnamed Supplier'


def _entry(d, lines, *, entry_no, voucher_type='JOURNAL', location_id=1):
    """A posted JE whose lines carry an explicit party tag (or none at all).

    make_journal_entry() cannot set the tag, and the whole point of these tests
    is which tag shape a line carries.
    """
    entry = JournalEntry.objects.create(
        date=d, narration=f'{entry_no} narration', voucher_type=voucher_type,
        reference_type='Manual', location_id=location_id, entry_no=entry_no,
    )
    for account, debit, credit, party_type, party_id in lines:
        JournalEntryLine.objects.create(
            entry=entry, account=account, debit=debit, credit=credit,
            party_type=party_type or 'None', party_id=party_id,
        )
    entry.post()
    return entry


class UntaggedPartyBase(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        self.receivable = self.coa['1130']
        self.payable = self.coa['2110']
        self.cash = self.coa['1110']
        self.sales = self.coa['4100']
        self.purchases = self.coa['5100']

    # ── fixtures ─────────────────────────────────────────────────────────────

    def walkin_credit_sale(self, amount, *, on=date(2026, 4, 1), entry_no='SAL-W1'):
        """What _sale_settlement writes for a credit sale with no customer_id:
        the receivable control, no party tag at all."""
        return _entry(on, [
            (self.receivable, Decimal(amount), Decimal('0'), None, None),
            (self.sales, Decimal('0'), Decimal(amount), None, None),
        ], entry_no=entry_no, voucher_type='SALE')

    def named_credit_sale(self, amount, *, on=date(2026, 4, 1), entry_no='SAL-N1'):
        return _entry(on, [
            (self.receivable, Decimal(amount), Decimal('0'), 'Customer', CUSTOMER),
            (self.sales, Decimal('0'), Decimal(amount), None, None),
        ], entry_no=entry_no, voucher_type='SALE')

    def half_tagged_receipt(self, amount, *, on=date(2026, 4, 10), entry_no='REC-H1'):
        """What generate_receipt writes when party_id is NULL: party_type is
        hardcoded 'Customer' around a missing id."""
        return _entry(on, [
            (self.cash, Decimal(amount), Decimal('0'), None, None),
            (self.receivable, Decimal('0'), Decimal(amount), 'Customer', None),
        ], entry_no=entry_no, voucher_type='RECEIPT')

    # ── helpers ──────────────────────────────────────────────────────────────

    def _call(self, view, path, params=None):
        request = self.factory.get(path, params or {'date': '2026-04-30'})
        force_authenticate(request, self.admin)
        # The aging views resolve names/GSTINs from the inventory master, whose
        # tables are unmanaged and absent under SQLite.
        with patch('reports.views._party_tax_details',
                   side_effect=lambda _pt, ids: {pid: {} for pid in ids}):
            return view.as_view()(request).data

    def open_customer_invoices(self, params=None):
        return self._call(OpenCustomerInvoicesView,
                          '/api/reports/open-customer-invoices/', params)

    def open_supplier_invoices(self, params=None):
        return self._call(OpenSupplierInvoicesView,
                          '/api/reports/open-supplier-invoices/', params)

    def receivables_aging(self):
        return self._call(ReceivablesAgingView, '/api/reports/receivables-aging/')

    def payables_aging(self):
        return self._call(PayablesAgingView, '/api/reports/payables-aging/')


class WalkInReceivableVisibilityTests(UntaggedPartyBase):
    """#4 — the untagged control posting must reach both AR surfaces."""

    def test_untagged_walkin_credit_sale_appears_on_the_invoice_page(self):
        self.walkin_credit_sale('1180')

        data = self.open_customer_invoices()
        self.assertEqual(len(data['rows']), 1)
        row = data['rows'][0]
        self.assertEqual(Decimal(row['outstanding_amount']), Decimal('1180.00'))
        self.assertEqual(Decimal(data['total_outstanding']), Decimal('1180.00'))
        # A usable label, and no party to drill into.
        self.assertEqual(row['party_name'], WALKIN_LABEL)
        self.assertIsNone(row['party_id'])

    def test_untagged_walkin_credit_sale_appears_on_the_aging_report(self):
        self.walkin_credit_sale('1180')

        data = self.receivables_aging()
        self.assertEqual(len(data['rows']), 1)
        row = data['rows'][0]
        self.assertEqual(Decimal(row['total_outstanding']), Decimal('1180.00'))
        self.assertEqual(row['customer_name'], WALKIN_LABEL)
        self.assertIsNone(row['customer_id'])
        # Never the literal 'Customer #None'.
        self.assertNotIn('None', row['customer_name'])

    def test_untagged_receipt_settles_the_untagged_receivable(self):
        """An untagged credit on the control is the walk-in paying up."""
        self.walkin_credit_sale('1180')
        _entry(date(2026, 4, 10), [
            (self.cash, Decimal('1180'), Decimal('0'), None, None),
            (self.receivable, Decimal('0'), Decimal('1180'), None, None),
        ], entry_no='REC-W1', voucher_type='RECEIPT')

        self.assertEqual(self.open_customer_invoices()['rows'], [])
        self.assertEqual(self.receivables_aging()['rows'], [])

    def test_named_customer_rows_are_unaffected(self):
        self.named_credit_sale('5000')
        self.walkin_credit_sale('1180')

        rows = {r['invoice_no']: r for r in self.open_customer_invoices()['rows']}
        self.assertEqual(Decimal(rows['SAL-N1']['outstanding_amount']),
                         Decimal('5000.00'))
        self.assertEqual(rows['SAL-N1']['party_id'], CUSTOMER)
        self.assertEqual(Decimal(rows['SAL-W1']['outstanding_amount']),
                         Decimal('1180.00'))

    def test_party_id_filter_still_excludes_the_untagged_bucket(self):
        """Asking for one customer must not hand back the walk-in pile."""
        self.named_credit_sale('5000')
        self.walkin_credit_sale('1180')

        data = self.open_customer_invoices(
            {'date': '2026-04-30', 'party_id': str(CUSTOMER)})
        self.assertEqual([r['invoice_no'] for r in data['rows']], ['SAL-N1'])


class SubtypeOverreachTests(UntaggedPartyBase):
    """The widening must be by account identity, not by account_subtype —
    'Receivable'/'Payable' are shared with advances, deposits, prepaids and
    the statutory payables."""

    def _leaf(self, code, name, atype, subtype):
        return ChartOfAccount.objects.create(
            account_code=code, account_name=name, account_type=atype,
            account_subtype=subtype, is_leaf=True, is_active=True,
        )

    def test_advances_deposits_and_prepaids_are_not_customer_invoices(self):
        advance = self._leaf('1310', 'Advance to Suppliers', 'ASSET', 'Receivable')
        deposit = self._leaf('1340', 'Security Deposits', 'ASSET', 'Receivable')
        prepaid = self._leaf('1360', 'Prepaid Expenses', 'ASSET', 'Receivable')
        for i, acct in enumerate((advance, deposit, prepaid)):
            _entry(date(2026, 4, 1), [
                (acct, Decimal('70000'), Decimal('0'), None, None),
                (self.cash, Decimal('0'), Decimal('70000'), None, None),
            ], entry_no=f'ADV-{i}')

        self.assertEqual(self.open_customer_invoices()['rows'], [])
        self.assertEqual(self.receivables_aging()['rows'], [])

    def test_statutory_payables_are_not_supplier_invoices(self):
        """2170/2180/2190/2200 all carry subtype 'Payable'."""
        for i, code in enumerate(('2170', '2180', '2190', '2200')):
            _entry(date(2026, 4, 1), [
                (self.coa['5400'], Decimal('9000'), Decimal('0'), None, None),
                (self.coa[code], Decimal('0'), Decimal('9000'), None, None),
            ], entry_no=f'PAY-STAT-{i}')

        self.assertEqual(self.open_supplier_invoices()['rows'], [])
        self.assertEqual(self.payables_aging()['rows'], [])

    def test_untagged_payable_on_the_control_still_shows(self):
        """A vendor-less credit acquisition (fixed_assets.post_acquisition)
        lands untagged on 2110 and is a real payable."""
        _entry(date(2026, 4, 1), [
            (self.purchases, Decimal('30000'), Decimal('0'), None, None),
            (self.payable, Decimal('0'), Decimal('30000'), None, None),
        ], entry_no='ASSET-1', voucher_type='PURCHASE')

        page = self.open_supplier_invoices()
        self.assertEqual(len(page['rows']), 1)
        self.assertEqual(page['rows'][0]['party_name'], UNNAMED_SUPPLIER_LABEL)
        self.assertIsNone(page['rows'][0]['party_id'])
        # Both payables surfaces must agree on the same debt.
        aging = self.payables_aging()
        self.assertEqual(Decimal(aging['total_outstanding']),
                         Decimal(page['total_outstanding']))
        self.assertEqual(Decimal(aging['total_outstanding']), Decimal('30000.00'))


class UntaggedBucketSettlementTests(UntaggedPartyBase):
    """Every NULL-party row on a trade control shares one netting pile.

    A party_type with no id carries no more information than no tag at all, and
    the two shapes are the two HALVES of one ordinary transaction: the walk-in
    credit sale posts wholly untagged, while the receipt clearing it comes from
    a Receipt voucher with a blank party, which stamps party_type='Customer'
    around a NULL id. Bucketing them apart left the obligation on the report
    for ever with no path to zero.
    """

    def test_half_tagged_receipt_clears_the_walkin_receivable(self):
        self.walkin_credit_sale('1180')
        self.half_tagged_receipt('1180')

        data = self.open_customer_invoices()
        self.assertEqual(data['rows'], [])
        self.assertEqual(Decimal(data['total_outstanding']), Decimal('0'))

    def test_aging_nets_the_two_null_shapes_together(self):
        self.walkin_credit_sale('1180')
        self.half_tagged_receipt('1180')

        data = self.receivables_aging()
        self.assertEqual(data['rows'], [])
        self.assertEqual(Decimal(data['total_outstanding']), Decimal('0'))

    def test_part_receipt_leaves_the_remainder_outstanding(self):
        """The point of sharing a pile is that partial money behaves normally."""
        self.walkin_credit_sale('1180')
        self.half_tagged_receipt('700')

        data = self.open_customer_invoices()
        self.assertEqual(len(data['rows']), 1)
        self.assertEqual(Decimal(data['rows'][0]['outstanding_amount']),
                         Decimal('480.00'))

    def test_half_tagged_invoice_is_settled_by_untagged_money(self):
        """Mirror image: the invoice is half-tagged, the money untagged."""
        _entry(date(2026, 4, 1), [
            (self.receivable, Decimal('900'), Decimal('0'), 'Customer', None),
            (self.sales, Decimal('0'), Decimal('900'), None, None),
        ], entry_no='SAL-H1', voucher_type='SALE')
        _entry(date(2026, 4, 10), [
            (self.cash, Decimal('900'), Decimal('0'), None, None),
            (self.receivable, Decimal('0'), Decimal('900'), None, None),
        ], entry_no='REC-U1', voucher_type='RECEIPT')

        data = self.open_customer_invoices()
        self.assertEqual(data['rows'], [])

    def test_named_customer_is_untouched_by_the_untagged_pile(self):
        """The guard that matters: an integer party_id keeps its own bucket, so
        walk-in money can never settle a named customer's invoice."""
        self.walkin_credit_sale('1180')
        _entry(date(2026, 4, 2), [
            (self.receivable, Decimal('5000'), Decimal('0'), 'Customer', 42),
            (self.sales, Decimal('0'), Decimal('5000'), None, None),
        ], entry_no='SAL-N1', voucher_type='SALE')
        self.half_tagged_receipt('1180')

        data = self.open_customer_invoices()
        self.assertEqual([r['invoice_no'] for r in data['rows']], ['SAL-N1'])
        self.assertEqual(Decimal(data['rows'][0]['outstanding_amount']),
                         Decimal('5000.00'))


class AllocationScopingTests(UntaggedPartyBase):
    """#3 — a BillReference carrying a bill_id settles a bills-app Bill, never
    a GL invoice, so it must never net one."""

    def test_bill_id_allocation_does_not_net_a_gl_invoice(self):
        from bills.models import Bill, BillPayment

        gl_invoice = _entry(date(2026, 4, 1), [
            (self.purchases, Decimal('30000'), Decimal('0'), None, None),
            (self.payable, Decimal('0'), Decimal('30000'), 'Supplier', SUPPLIER),
        ], entry_no='PUR-COLLIDE', voucher_type='PURCHASE')
        # A bills-app bill whose bill_no happens to equal the JE's entry_no.
        bill = Bill.objects.create(
            bill_no=gl_invoice.entry_no, vendor_id=SUPPLIER,
            bill_date=date(2026, 4, 2), due_date=date(2026, 5, 2),
            vendor_name='Acme', total_amount=Decimal('30000'), location_id=1,
        )
        pay_je = _entry(date(2026, 4, 20), [
            (self.payable, Decimal('30000'), Decimal('0'), 'Supplier', SUPPLIER),
            (self.cash, Decimal('0'), Decimal('30000'), None, None),
        ], entry_no='BILLPAY-1', voucher_type='PAYMENT')
        BillPayment.objects.create(
            bill=bill, date=date(2026, 4, 20), mode='cash',
            amount=Decimal('30000'), journal_entry=pay_je,
        )
        BillReference.objects.create(
            line=pay_je.lines.get(account=self.payable), kind='AGAINST',
            ref_no=bill.bill_no, ref_date=bill.bill_date,
            amount=Decimal('30000'), bill_id=bill.id,
        )

        # _bills_app_ledger_keys keeps the payment out of the settled totals,
        # but the allocation lookup reads BillReference directly — without the
        # bill_id filter this settlement netted the GL invoice to zero and the
        # supplier's 30,000 vanished from Payables.
        rows = self.open_supplier_invoices()['rows']
        self.assertEqual([r['invoice_no'] for r in rows], ['PUR-COLLIDE'])
        self.assertEqual(Decimal(rows[0]['outstanding_amount']),
                         Decimal('30000.00'))

    def test_plain_allocation_without_a_bill_id_still_nets(self):
        """The narrowing must not disarm real bill-wise allocation."""
        invoice = _entry(date(2026, 4, 1), [
            (self.purchases, Decimal('5000'), Decimal('0'), None, None),
            (self.payable, Decimal('0'), Decimal('5000'), 'Supplier', SUPPLIER),
        ], entry_no='PUR-A', voucher_type='PURCHASE')
        pay = _entry(date(2026, 4, 20), [
            (self.payable, Decimal('2000'), Decimal('0'), 'Supplier', SUPPLIER),
            (self.cash, Decimal('0'), Decimal('2000'), None, None),
        ], entry_no='PAY-A', voucher_type='PAYMENT')
        BillReference.objects.create(
            line=pay.lines.get(account=self.payable), kind='AGAINST',
            ref_no=invoice.entry_no, ref_date=invoice.date,
            amount=Decimal('2000'),
        )

        rows = self.open_supplier_invoices()['rows']
        self.assertEqual(Decimal(rows[0]['outstanding_amount']),
                         Decimal('3000.00'))


class PoolClampTests(UntaggedPartyBase):
    """#5 — cap the oldest-first pool at what the GL still owes, so on-account
    money can never be drawn against invoices it does not belong to.

    Guard-rail, NOT the cure — the real fix for the double-netting is the
    allocation write path. `pool > gl_open` reduces to `settled > invoiced`,
    the same condition the `if net <= 0` gate already skips, so the clamp
    changes no output today; these tests pin the properties it keeps true and
    the residual it does NOT address.
    """

    def test_orphan_on_account_payment_cannot_reach_another_partys_invoices(self):
        """The failure mode that produced Payables 80,000 -> 0: 50,000 of
        settlement whose bill was cancelled out from under it. It may zero its
        OWN supplier (indistinguishable from a genuine advance), but the clamp
        and the per-bucket pool keep it off everyone else's invoices."""
        other_supplier = SUPPLIER + 1
        _entry(date(2026, 4, 1), [
            (self.purchases, Decimal('30000'), Decimal('0'), None, None),
            (self.payable, Decimal('0'), Decimal('30000'), 'Supplier', SUPPLIER),
        ], entry_no='PUR-ORPHANED', voucher_type='PURCHASE')
        _entry(date(2026, 4, 20), [
            (self.payable, Decimal('50000'), Decimal('0'), 'Supplier', SUPPLIER),
            (self.cash, Decimal('0'), Decimal('50000'), None, None),
        ], entry_no='PAY-ORPHAN', voucher_type='PAYMENT')
        _entry(date(2026, 4, 2), [
            (self.purchases, Decimal('25000'), Decimal('0'), None, None),
            (self.payable, Decimal('0'), Decimal('25000'), 'Supplier', other_supplier),
        ], entry_no='PUR-OTHER', voucher_type='PURCHASE')

        data = self.open_supplier_invoices()
        self.assertEqual([r['invoice_no'] for r in data['rows']], ['PUR-OTHER'])
        self.assertEqual(Decimal(data['total_outstanding']), Decimal('25000.00'))

    def test_over_settlement_is_still_gated_out_by_net_not_by_the_clamp(self):
        """Documents the residual so nobody mistakes the clamp for the cure: an
        over-settled bucket is dropped by `if net <= 0`, exactly as a genuine
        supplier advance is (see PayablesPartialPaymentTests
        .test_overpayment_leaves_nothing_outstanding) — the two are
        indistinguishable in the GL."""
        _entry(date(2026, 4, 1), [
            (self.purchases, Decimal('30000'), Decimal('0'), None, None),
            (self.payable, Decimal('0'), Decimal('30000'), 'Supplier', SUPPLIER),
        ], entry_no='PUR-GL', voucher_type='PURCHASE')
        _entry(date(2026, 4, 20), [
            (self.payable, Decimal('50000'), Decimal('0'), 'Supplier', SUPPLIER),
            (self.cash, Decimal('0'), Decimal('50000'), None, None),
        ], entry_no='PAY-ORPHAN', voucher_type='PAYMENT')

        self.assertEqual(self.open_supplier_invoices()['rows'], [])

    def test_clamp_is_a_no_op_on_a_genuine_part_payment(self):
        _entry(date(2026, 4, 1), [
            (self.purchases, Decimal('10000'), Decimal('0'), None, None),
            (self.payable, Decimal('0'), Decimal('10000'), 'Supplier', SUPPLIER),
        ], entry_no='PUR-VALID', voucher_type='PURCHASE')
        _entry(date(2026, 4, 10), [
            (self.payable, Decimal('4000'), Decimal('0'), 'Supplier', SUPPLIER),
            (self.cash, Decimal('0'), Decimal('4000'), None, None),
        ], entry_no='PAY-VALID', voucher_type='PAYMENT')

        rows = self.open_supplier_invoices()['rows']
        self.assertEqual(Decimal(rows[0]['outstanding_amount']),
                         Decimal('6000.00'))
        self.assertEqual(Decimal(rows[0]['paid_amount']), Decimal('4000.00'))

    def test_pool_is_per_bucket_not_global(self):
        """The newly-visible untagged bucket gets its own pool: an untagged
        payment must not be drawn against a named supplier's invoices."""
        _entry(date(2026, 4, 1), [
            (self.purchases, Decimal('30000'), Decimal('0'), None, None),
            (self.payable, Decimal('0'), Decimal('30000'), 'Supplier', SUPPLIER),
        ], entry_no='PUR-NAMED', voucher_type='PURCHASE')
        _entry(date(2026, 4, 20), [
            (self.payable, Decimal('50000'), Decimal('0'), None, None),
            (self.cash, Decimal('0'), Decimal('50000'), None, None),
        ], entry_no='PAY-UNTAGGED', voucher_type='PAYMENT')

        data = self.open_supplier_invoices()
        self.assertEqual([r['invoice_no'] for r in data['rows']], ['PUR-NAMED'])
        self.assertEqual(Decimal(data['total_outstanding']), Decimal('30000.00'))

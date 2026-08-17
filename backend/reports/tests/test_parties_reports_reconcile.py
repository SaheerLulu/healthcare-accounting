"""Parties vs Transactions>Payables/Receivables — the two halves must agree.

Issue 5 was "Parties > Supplier disagrees with Transactions > Payables", and it
was fixed from BOTH ends independently:

  * reports/views.py WIDENED the AR/AP surfaces to also show control-account
    postings that carry no party tag (walk-in credit sales, vendor-less credit
    asset buys), bucketed under a synthetic key.
  * parties/services.py NARROWED the party aggregate onto the control-account
    subtype, with the posted/optional/memorandum/as-of predicates the reports
    have always applied.

Neither change can see the other, and moving one surface toward the other is
exactly the way to overshoot past it. So these tests build ONE fixture and
assert an exact equality across both code paths — the real report views and the
real parties services, not a re-implementation of either. (parties'
test_balances.py deliberately re-implements the report predicate for speed;
that copy cannot notice reports/views.py changing underneath it. This file can.)

The invariant the two surfaces actually satisfy is NOT "the totals are equal" —
it is:

    report total  ==  sum of every party's outstanding  +  the untagged bucket

because an untagged balance is real money the report must show and no party
page can ever claim. Tests below pin that identity, and pin that the untagged
bucket is the ONLY term of divergence.
"""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.models import ChartOfAccount
from core.tests.utils import make_admin, make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine
from parties import services as party_services
from parties.models import PartyOpeningBalance
from parties.opening_balance import OPENING_BALANCE_REFERENCE
from reports.views import PayablesAgingView, ReceivablesAgingView

SUPPLIER_A = 71
SUPPLIER_B = 72
CUSTOMER_A = 81
STORE = 1

# Everything is dated in the past because both surfaces cap at today by
# default: parties via _resolve_as_of, the reports via `date.today()`.
LONG_AGO = date.today() - timedelta(days=60)
RECENTLY = date.today() - timedelta(days=10)
TOMORROW = date.today() + timedelta(days=1)


def _jv(lines, *, d=LONG_AGO, entry_no='JV-X', voucher_type='JOURNAL',
        reference_type='Manual', location_id=STORE, post=True, **kw):
    """Posted JE from (account, debit, credit, party) tuples.

    `party` is (party_type, party_id) or None. make_journal_entry() cannot set
    a party tag, and which tag shape a line carries is the whole subject here.
    """
    entry = JournalEntry.objects.create(
        date=d, narration=f'{entry_no} narration', voucher_type=voucher_type,
        reference_type=reference_type, location_id=location_id,
        entry_no=entry_no, **kw,
    )
    for account, debit, credit, party in lines:
        JournalEntryLine.objects.create(
            entry=entry, account=account,
            debit=Decimal(debit), credit=Decimal(credit),
            party_type=party[0] if party else 'None',
            party_id=party[1] if party else None,
        )
    if post:
        entry.post()
    return entry


class ReconcileBase(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        self.payable = self.coa['2110']
        self.receivable = self.coa['1130']
        self.cash = self.coa['1110']
        self.sales = self.coa['4100']
        self.rent = self.coa['5410']
        self.pf_payable = self.coa['2170']
        # Not in the shared seed, and load-bearing here: 1310 is subtype
        # 'Receivable' while belonging to a SUPPLIER, which is the one shape
        # that could leak across the two surfaces' subtype filters.
        self.supplier_advance = ChartOfAccount.objects.create(
            account_code='1310', account_name='Advance to Suppliers',
            account_type='ASSET', account_subtype='Receivable',
            is_leaf=True, is_active=True,
        )

    # ── the two surfaces ─────────────────────────────────────────────────────

    def _report(self, view, path, params=None):
        request = self.factory.get(path, params or {})
        force_authenticate(request, self.admin)
        # Names/GSTINs come from the unmanaged inventory master, absent under
        # SQLite. Blank details make the views fall back to their own labels,
        # which is what the untagged-bucket assertions read.
        with patch('reports.views._party_tax_details',
                   side_effect=lambda _pt, ids: {pid: {} for pid in ids}):
            return view.as_view()(request).data

    def payables_aging(self, params=None):
        return self._report(PayablesAgingView,
                            '/api/reports/payables-aging/', params)

    def receivables_aging(self, params=None):
        return self._report(ReceivablesAgingView,
                            '/api/reports/receivables-aging/', params)

    def party_outstanding(self, party_type, party_id, **kw):
        kw.setdefault('location_id', STORE)
        return Decimal(
            party_services.party_overview(party_type, party_id, **kw)['outstanding'])

    # ── assertions ───────────────────────────────────────────────────────────

    def assert_row(self, report, id_key, party_id, expected):
        """The report's row for one party carries `expected` outstanding."""
        rows = [r for r in report['rows'] if r[id_key] == party_id]
        self.assertEqual(len(rows), 1, f'expected exactly one row for {party_id}')
        self.assertEqual(Decimal(rows[0]['total_outstanding']), expected)

    def untagged_total(self, report, id_key):
        """The part of the report total that no party page can ever claim."""
        return sum((Decimal(r['total_outstanding'])
                    for r in report['rows'] if r[id_key] is None),
                   Decimal('0.00'))

    def gl_balance(self, account):
        """Net debit balance of one control leaf, straight off the ledger.

        The report is a re-presentation of these very lines, so where no party
        is in credit the report total must equal this. It is the assertion that
        actually catches an untagged bucket drifting away from the books.
        """
        total = Decimal('0.00')
        for line in JournalEntryLine.objects.filter(
                account=account, entry__is_posted=True,
                entry__is_optional=False, entry__is_memorandum=False,
                entry__date__lte=date.today()).values('debit', 'credit'):
            total += line['debit'] - line['credit']
        return total

    def assert_reconciles(self, report, id_key, party_type, party_ids):
        """report total == sum of party outstandings + untagged bucket."""
        from_parties = sum(
            (max(self.party_outstanding(party_type, pid), Decimal('0.00'))
             for pid in party_ids),
            Decimal('0.00'))
        self.assertEqual(
            Decimal(report['total_outstanding']),
            from_parties + self.untagged_total(report, id_key))


class SupplierReconcileTests(ReconcileBase):
    def _bill(self, amount, supplier=SUPPLIER_A, **kw):
        """A vendor bill in the shape cleanup_untagged_manual_jvs writes — the
        party tag on BOTH the expense debit and the payable credit."""
        kw.setdefault('entry_no', f'BILL-{supplier}')
        return _jv([
            (self.rent, amount, '0.00', ('Supplier', supplier)),
            (self.payable, '0.00', amount, ('Supplier', supplier)),
        ], voucher_type='PURCHASE', **kw)

    def _payment(self, amount, supplier=SUPPLIER_A, **kw):
        kw.setdefault('entry_no', f'PAY-{supplier}')
        return _jv([
            (self.payable, amount, '0.00', ('Supplier', supplier)),
            (self.cash, '0.00', amount, None),
        ], voucher_type='PAYMENT', d=RECENTLY, **kw)

    def test_partly_paid_bill_agrees_on_both_surfaces(self):
        self._bill('20000.00')
        self._payment('8000.00')
        self.assert_row(self.payables_aging(), 'supplier_id', SUPPLIER_A,
                        Decimal('12000.00'))
        self.assertEqual(self.party_outstanding('Supplier', SUPPLIER_A),
                         Decimal('12000.00'))

    def test_supplier_advance_is_excluded_by_both(self):
        # 1310 is subtype 'Receivable' but tagged to a SUPPLIER. Parties drops
        # it via the payable-subtype cut (an advance is an asset, not a smaller
        # creditor); Payables never saw it. The risk is the receivables side
        # picking it up instead — its widened Q is scoped to the RECEIVABLES
        # control, so a supplier tag on 1310 matches neither branch.
        self._bill('20000.00')
        _jv([
            (self.supplier_advance, '5000.00', '0.00', ('Supplier', SUPPLIER_A)),
            (self.cash, '0.00', '5000.00', None),
        ], entry_no='ADV-1', voucher_type='PAYMENT')

        self.assert_row(self.payables_aging(), 'supplier_id', SUPPLIER_A,
                        Decimal('20000.00'))
        self.assertEqual(self.party_outstanding('Supplier', SUPPLIER_A),
                         Decimal('20000.00'))
        self.assertEqual(self.receivables_aging()['rows'], [])

    def test_untagged_payable_is_the_only_divergence(self):
        # fixed_assets/services.py credits the Trade Payables control with no
        # vendor tag on a credit acquisition. The report must show it; no
        # supplier page can. That gap is the whole difference between the two
        # totals — nothing else is allowed to leak.
        self._bill('20000.00')
        self._bill('5000.00', supplier=SUPPLIER_B)
        _jv([
            (self.rent, '0.00', '3000.00', None),
            (self.payable, '0.00', '3000.00', None),
            (self.cash, '3000.00', '0.00', None),
            (self.rent, '3000.00', '0.00', None),
        ], entry_no='ASSET-1')

        report = self.payables_aging()
        self.assertEqual(self.untagged_total(report, 'supplier_id'),
                         Decimal('3000.00'))
        self.assert_reconciles(report, 'supplier_id', 'Supplier',
                               [SUPPLIER_A, SUPPLIER_B])

    def test_untagged_bucket_never_settles_a_named_supplier(self):
        # The two must net independently, or an unattributed debit silently
        # pays down a real creditor and Parties keeps showing the debt.
        self._bill('20000.00')
        _jv([
            (self.payable, '4000.00', '0.00', None),
            (self.cash, '0.00', '4000.00', None),
        ], entry_no='UNTAGGED-PAY', voucher_type='PAYMENT')

        report = self.payables_aging()
        self.assert_row(report, 'supplier_id', SUPPLIER_A, Decimal('20000.00'))
        self.assertEqual(self.party_outstanding('Supplier', SUPPLIER_A),
                         Decimal('20000.00'))
        # The stray debit leaves a negative bucket, which the report drops.
        self.assertEqual(self.untagged_total(report, 'supplier_id'),
                         Decimal('0.00'))

    def test_statutory_payable_tagged_to_a_supplier_agrees(self):
        # 2170 PF Payable shares subtype 'Payable' with the trade control.
        # Neither surface scopes its TAGGED branch by account identity, so both
        # count it. Nonsense data either way — but they must not disagree about
        # it, which is what this pins.
        self._bill('20000.00')
        _jv([
            (self.rent, '1000.00', '0.00', None),
            (self.pf_payable, '0.00', '1000.00', ('Supplier', SUPPLIER_A)),
        ], entry_no='PF-1')

        self.assert_row(self.payables_aging(), 'supplier_id', SUPPLIER_A,
                        Decimal('21000.00'))
        self.assertEqual(self.party_outstanding('Supplier', SUPPLIER_A),
                         Decimal('21000.00'))

    def test_optional_and_memorandum_vouchers_count_on_neither(self):
        self._bill('20000.00')
        self._bill('9999.00', supplier=SUPPLIER_B, entry_no='OPT-1',
                   is_optional=True)
        self._bill('8888.00', supplier=SUPPLIER_B, entry_no='MEMO-1',
                   is_memorandum=True)

        report = self.payables_aging()
        self.assert_row(report, 'supplier_id', SUPPLIER_A, Decimal('20000.00'))
        self.assertEqual(self.party_outstanding('Supplier', SUPPLIER_B),
                         Decimal('0.00'))
        self.assert_reconciles(report, 'supplier_id', 'Supplier',
                               [SUPPLIER_A, SUPPLIER_B])

    def test_post_dated_voucher_counts_on_neither(self):
        # parties only started capping at today with this change; before it, a
        # post-dated bill showed on the party page and nowhere else.
        self._bill('20000.00')
        self._bill('7000.00', supplier=SUPPLIER_B, entry_no='FUTURE-1',
                   d=TOMORROW)

        report = self.payables_aging()
        self.assertEqual(self.party_outstanding('Supplier', SUPPLIER_B),
                         Decimal('0.00'))
        self.assert_reconciles(report, 'supplier_id', 'Supplier',
                               [SUPPLIER_A, SUPPLIER_B])

    def test_opening_balance_counted_once_by_each_surface(self):
        # The halves are counted DIFFERENTLY on purpose: parties excludes the
        # OB journal entry and adds the stored PartyOpeningBalance amount (so
        # the figure survives with party ledgers disabled, where no OB JE
        # exists), while the report simply counts the JE. Same number, two
        # routes — and the classic way to break it is to double-count on one
        # side. Posted onto the control here rather than via
        # post_opening_balance_je: the per-party ledger it would build copies
        # the control's subtype, so both surfaces see it identically either way.
        PartyOpeningBalance.objects.create(
            party_type='Supplier', party_id=SUPPLIER_A, location_id=STORE,
            amount=Decimal('15000.00'), as_of_date=LONG_AGO,
        )
        _jv([
            (self.coa['3300'], '0.00', '0.00', None),
            (self.payable, '0.00', '15000.00', ('Supplier', SUPPLIER_A)),
            (self.coa['3300'], '15000.00', '0.00', None),
        ], entry_no='OB-1', reference_type=OPENING_BALANCE_REFERENCE)

        self.assert_row(self.payables_aging(), 'supplier_id', SUPPLIER_A,
                        Decimal('15000.00'))
        self.assertEqual(self.party_outstanding('Supplier', SUPPLIER_A),
                         Decimal('15000.00'))


class CustomerReconcileTests(ReconcileBase):
    def _sale(self, amount, customer=CUSTOMER_A, **kw):
        kw.setdefault('entry_no', f'SAL-{customer}')
        return _jv([
            (self.receivable, amount, '0.00', ('Customer', customer)),
            (self.sales, '0.00', amount, None),
        ], voucher_type='SALE', **kw)

    def test_partly_received_sale_agrees_on_both_surfaces(self):
        self._sale('12000.00')
        _jv([
            (self.cash, '4000.00', '0.00', None),
            (self.receivable, '0.00', '4000.00', ('Customer', CUSTOMER_A)),
        ], entry_no='REC-1', voucher_type='RECEIPT', d=RECENTLY)

        self.assert_row(self.receivables_aging(), 'customer_id', CUSTOMER_A,
                        Decimal('8000.00'))
        self.assertEqual(self.party_outstanding('Customer', CUSTOMER_A),
                         Decimal('8000.00'))

    def test_walkin_credit_sale_is_the_only_divergence(self):
        # journals.services._sale_settlement drops the tag for a credit sale
        # with no named customer; core/party_ledgers.py:15 says walk-ins never
        # get a ledger. The receivable is real, and belongs to no customer page.
        self._sale('12000.00')
        _jv([
            (self.receivable, '1180.00', '0.00', None),
            (self.sales, '0.00', '1180.00', None),
        ], entry_no='SAL-WALKIN', voucher_type='SALE')

        report = self.receivables_aging()
        self.assertEqual(self.untagged_total(report, 'customer_id'),
                         Decimal('1180.00'))
        self.assert_reconciles(report, 'customer_id', 'Customer', [CUSTOMER_A])

    def test_half_tagged_receipt_does_not_settle_a_named_customer(self):
        # generate_receipt hardcodes party_type='Customer' around a possibly
        # NULL id. Without an id it joins the untagged pile, never a named
        # customer's bucket — money received from nobody-in-particular must not
        # reduce a debt someone actually owes. parties can't attribute it either.
        self._sale('12000.00')
        _jv([
            (self.cash, '500.00', '0.00', None),
            (self.receivable, '0.00', '500.00', ('Customer', None)),
        ], entry_no='REC-HALF', voucher_type='RECEIPT', d=RECENTLY)

        report = self.receivables_aging()
        self.assert_row(report, 'customer_id', CUSTOMER_A, Decimal('12000.00'))
        self.assertEqual(self.party_outstanding('Customer', CUSTOMER_A),
                         Decimal('12000.00'))
        self.assert_reconciles(report, 'customer_id', 'Customer', [CUSTOMER_A])

    def test_all_three_party_shapes_reconcile_side_by_side(self):
        # The half-tagged receipt and the walk-in sale are BOTH id-less, so
        # both land in the report's no-party rows and they DO net each other —
        # they are the two halves of one walk-in transaction: sold on credit
        # with no customer recorded, later paid with no customer recorded.
        # Bucketing them apart held the 1,180 open for ever and pushed the
        # reported AR 500 ABOVE the ledger. Neither is claimable by a customer
        # page, so what remains is exactly the reconciliation gap.
        self._sale('12000.00')
        _jv([
            (self.receivable, '1180.00', '0.00', None),
            (self.sales, '0.00', '1180.00', None),
        ], entry_no='SAL-WALKIN', voucher_type='SALE')
        _jv([
            (self.cash, '500.00', '0.00', None),
            (self.receivable, '0.00', '500.00', ('Customer', None)),
        ], entry_no='REC-HALF', voucher_type='RECEIPT', d=RECENTLY)

        report = self.receivables_aging()
        self.assert_row(report, 'customer_id', CUSTOMER_A, Decimal('12000.00'))
        self.assertEqual(self.untagged_total(report, 'customer_id'),
                         Decimal('680.00'))
        self.assert_reconciles(report, 'customer_id', 'Customer', [CUSTOMER_A])
        # The whole point: nobody is in credit here, so the report is now the
        # 1130 balance re-presented. Under the split buckets this read 13,180
        # against a ledger of 12,680.
        self.assertEqual(Decimal(report['total_outstanding']),
                         self.gl_balance(self.receivable))

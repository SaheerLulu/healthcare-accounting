"""Parties balance aggregation — the first tests this app has ever had.

Issue 5: "Parties > Supplier" disagreed with "Transactions > Payables" for two
independent reasons, both exercised here.

  §A the aggregate counted the party TAG alone — no control-account subtype, no
      is_optional/is_memorandum exclusion, no as-of cap — while every reporting
      surface applies all four (reports.views AR/AP + aging, core dashboard KPIs,
      ChartOfAccount.get_balance).
  §B PartyOpeningBalance is unique per (party_type, party_id, location_id) but
      was read UNSCOPED and added to a journal aggregate that WAS store-scoped.

The register (Transactions / Statement tabs) is deliberately NOT narrowed — an
optional voucher stays visible there, it just doesn't count. Tests below pin
both halves of that split.

Dates are relative to date.today() because the as-of cap defaults to today, the
way the reports do.
"""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.db.models import Q
from django.test import TestCase, override_settings

from core.models import AccountMapping, ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine
from parties import services
from parties.models import PartyOpeningBalance

SUPPLIER = 7
CUSTOMER = 11
STORE_A = 1
STORE_B = 2

PAST = date.today() - timedelta(days=30)
FUTURE = date.today() + timedelta(days=30)


def _jv(lines, *, d=None, location_id=STORE_A, voucher_type='JOURNAL',
        post=True, **kw):
    """Balanced JE from (account, debit, credit, party) tuples.

    `party` is (party_type, party_id) or None.
    """
    entry = JournalEntry.objects.create(
        date=d or PAST, narration='test', voucher_type=voucher_type,
        reference_type='Manual', location_id=location_id, **kw,
    )
    for acct, dr, cr, party in lines:
        JournalEntryLine.objects.create(
            entry=entry, account=acct,
            debit=Decimal(dr), credit=Decimal(cr),
            party_type=party[0] if party else 'None',
            party_id=party[1] if party else None,
        )
    if post:
        entry.post()
    return entry


def _payables_report_balance(party_id, *, location_id=None, as_of=None):
    """What Transactions > Payables shows for a supplier.

    Copied from reports.views.PayablesAgingView on purpose: if parties ever
    drifts from the report again, the assertions using this fail.
    """
    qs = JournalEntryLine.objects.filter(
        entry__is_posted=True, entry__is_optional=False,
        entry__is_memorandum=False,
        entry__date__lte=as_of or date.today(),
        party_type='Supplier', party_id=party_id,
        account__account_subtype='Payable',
    )
    if location_id:
        qs = qs.filter(entry__location_id=location_id)
    return sum((r['credit'] - r['debit'] for r in qs.values('debit', 'credit')),
               Decimal('0.00'))


def _q_matches(q, row):
    """Evaluate one of the small Q trees list_parties builds against a fake
    row. Deliberately narrow — it understands exactly the lookups the service
    uses, and raises on anything else so a new filter can't silently pass here
    while doing nothing."""
    results = []
    for child in q.children:
        if isinstance(child, Q):
            results.append(_q_matches(child, row))
            continue
        key, value = child
        if key == 'location_id':
            results.append(row.location_id == value)
        elif key == 'location_id__isnull':
            results.append((row.location_id is None) is value)
        else:
            raise AssertionError(f'fake queryset cannot evaluate Q({key}=…)')
    matched = any(results) if q.connector == Q.OR else all(results)
    return not matched if q.negated else matched


class _FakePartyQS:
    """Duck-typed stand-in for SupplierRO.objects / CustomerRO.objects — the
    inventory proxy tables are managed=False and absent from the test DB."""

    def __init__(self, rows):
        self.rows = list(rows)

    def all(self):
        return self

    def filter(self, *args, **kw):
        rows = self.rows
        for q in args:
            rows = [r for r in rows if _q_matches(q, r)]
        if 'location_id' in kw:
            rows = [r for r in rows if r.location_id == kw['location_id']]
        if 'is_internal' in kw:
            rows = [r for r in rows
                    if getattr(r, 'is_internal', False) == kw['is_internal']]
        if 'customer_type__in' in kw:
            wanted = set(kw['customer_type__in'])
            rows = [r for r in rows if getattr(r, 'customer_type', None) in wanted]
        for key in ('company_name__icontains', 'customer_name__icontains'):
            if key in kw:
                needle = kw[key].lower()
                attr = key.split('__')[0]
                rows = [r for r in rows if needle in getattr(r, attr).lower()]
        return type(self)(rows)

    def order_by(self, *fields):
        return type(self)(sorted(self.rows, key=lambda r: r.id))

    def __iter__(self):
        return iter(self.rows)


def _fake_supplier(pk, name, location_id=STORE_A):
    return SimpleNamespace(
        id=pk, company_name=name, gst_no='', phone='', email='',
        city='', state='', status='active', location_id=location_id,
    )


def _patch_suppliers(*rows):
    return mock.patch('inventory_reader.models.SupplierRO',
                      SimpleNamespace(objects=_FakePartyQS(rows)))


class PartyBalanceFilterTests(TestCase):
    """§A — the four predicates every other outstanding surface applies."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.payable = ChartOfAccount.objects.get(account_code='2110')
        self.receivable = ChartOfAccount.objects.get(account_code='1130')
        self.rent = ChartOfAccount.objects.get(account_code='5410')
        self.cash = ChartOfAccount.objects.get(account_code='1110')
        self.sales = ChartOfAccount.objects.get(account_code='4100')

    def _bill(self, amount='20000.00', **kw):
        """A manual vendor-bill JV in the shape cleanup_untagged_manual_jvs
        writes: the party tag on BOTH the expense debit and the payable credit."""
        return _jv([
            (self.rent, amount, '0.00', ('Supplier', SUPPLIER)),
            (self.payable, '0.00', amount, ('Supplier', SUPPLIER)),
        ], voucher_type='PURCHASE', **kw)

    def test_tagged_expense_line_does_not_net_the_bill_to_zero(self):
        # The bug that made a bill vanish from Parties while Payables showed it
        # in full: both legs carry the tag, so tag-only aggregation nets to 0.
        self._bill()
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('20000.00'))
        self.assertEqual(Decimal(ov['total_invoices']), Decimal('20000.00'))
        self.assertEqual(
            Decimal(ov['outstanding']),
            _payables_report_balance(SUPPLIER, location_id=STORE_A))

    def test_expense_leg_is_not_counted_as_a_second_invoice(self):
        self._bill()
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(ov['invoice_count'], 1)

    def test_payment_against_the_bill_settles_it(self):
        self._bill()
        _jv([
            (self.payable, '8000.00', '0.00', ('Supplier', SUPPLIER)),
            (self.cash, '0.00', '8000.00', None),
        ], voucher_type='PAYMENT')
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('12000.00'))
        self.assertEqual(Decimal(ov['total_settled']), Decimal('8000.00'))

    def test_optional_voucher_does_not_count(self):
        self._bill(is_optional=True)
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('0.00'))

    def test_optional_voucher_is_still_visible_in_the_register(self):
        # Tally shows an optional voucher, it just doesn't count it — so the
        # narrowing must live at the aggregation site, not in lines_for_party.
        entry = self._bill(is_optional=True)
        rows = services.transaction_list('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual([r['entry_no'] for r in rows], [entry.entry_no])
        stmt = services.statement_of_account('Supplier', SUPPLIER,
                                             location_id=STORE_A)
        self.assertIn(entry.entry_no, [r['entry_no'] for r in stmt['rows']])

    def test_memorandum_voucher_does_not_count(self):
        self._bill(is_memorandum=True)
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('0.00'))

    def test_unposted_voucher_does_not_count(self):
        self._bill(post=False)
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('0.00'))

    def test_post_dated_voucher_is_capped_at_today(self):
        self._bill(d=FUTURE)
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('0.00'))
        self.assertEqual(Decimal(ov['outstanding']),
                         _payables_report_balance(SUPPLIER, location_id=STORE_A))

    def test_explicit_as_of_includes_a_later_voucher(self):
        self._bill(d=FUTURE)
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A,
                                     as_of=FUTURE)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('20000.00'))

    def test_supplier_advance_is_not_netted_off_the_payable(self):
        # 1310 Advance to Suppliers is subtype Receivable, so a supplier-tagged
        # debit there is an ASSET, not a reduction of the creditor. Excluding it
        # is the deliberate reading and matches Payables.
        advance = ChartOfAccount.objects.create(
            account_code='1310', account_name='Advance to Suppliers',
            account_type='ASSET', account_subtype='Receivable',
            is_leaf=True, is_active=True)
        self._bill()
        _jv([
            (advance, '5000.00', '0.00', ('Supplier', SUPPLIER)),
            (self.cash, '0.00', '5000.00', None),
        ], voucher_type='PAYMENT')
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('20000.00'))
        self.assertEqual(Decimal(ov['outstanding']),
                         _payables_report_balance(SUPPLIER, location_id=STORE_A))

    def test_other_stores_vouchers_are_excluded(self):
        self._bill()
        self._bill(amount='3000.00', location_id=STORE_B)
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('20000.00'))
        allstores = services.party_overview('Supplier', SUPPLIER)
        self.assertEqual(Decimal(allstores['outstanding']), Decimal('23000.00'))

    def test_customer_side_uses_the_receivable_subtype(self):
        _jv([
            (self.receivable, '1500.00', '0.00', ('Customer', CUSTOMER)),
            (self.sales, '0.00', '1500.00', ('Customer', CUSTOMER)),
        ], voucher_type='SALE')
        ov = services.party_overview('Customer', CUSTOMER, location_id=STORE_A)
        # The revenue credit also carries the tag; only the receivable counts.
        self.assertEqual(Decimal(ov['outstanding']), Decimal('1500.00'))

    def test_list_parties_agrees_with_the_detail_overview(self):
        self._bill(is_optional=True)      # must not count
        self._bill(amount='9000.00')      # must count
        self._bill(amount='500.00', d=FUTURE)   # must not count yet
        with _patch_suppliers(_fake_supplier(SUPPLIER, 'Acme Pharma')):
            rows = services.list_parties('Supplier', location_id=STORE_A)
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['outstanding'], ov['outstanding'])
        self.assertEqual(Decimal(rows[0]['outstanding']), Decimal('9000.00'))
        self.assertEqual(rows[0]['invoice_count'], ov['invoice_count'])


@override_settings(PARTY_LEDGERS_ENABLED=True)
class PerPartyLedgerBalanceTests(TestCase):
    """The subtype cut must survive the per-party-ledger model, where the
    posting lands on a `2105-S<id>-L<loc>` leaf rather than on 2110."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        sc, _ = ChartOfAccount.objects.get_or_create(
            account_code='2105',
            defaults=dict(account_name='Sundry Creditors', account_type='LIABILITY',
                          account_subtype='Payable', is_leaf=False, is_active=True))
        ChartOfAccount.objects.filter(account_code='2110').update(parent=sc, is_leaf=True)
        self.rent = ChartOfAccount.objects.get(account_code='5410')

    def test_balance_counts_the_party_leaf(self):
        from core.party_ledgers import get_or_create_party_ledger
        ledger = get_or_create_party_ledger('Supplier', SUPPLIER, location_id=STORE_A)
        _jv([
            (self.rent, '4000.00', '0.00', ('Supplier', SUPPLIER)),
            (ledger, '0.00', '4000.00', ('Supplier', SUPPLIER)),
        ], voucher_type='PURCHASE')
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('4000.00'))
        self.assertEqual(Decimal(ov['outstanding']),
                         _payables_report_balance(SUPPLIER, location_id=STORE_A))


class OpeningBalanceScopeTests(TestCase):
    """§B — PartyOpeningBalance is per (party, store); read it that way."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.payable = ChartOfAccount.objects.get(account_code='2110')
        self.cash = ChartOfAccount.objects.get(account_code='1110')

    def _ob(self, amount, *, location_id, party_id=SUPPLIER, as_of=None,
            party_type='Supplier'):
        return PartyOpeningBalance.objects.create(
            party_type=party_type, party_id=party_id, location_id=location_id,
            amount=Decimal(amount), as_of_date=as_of or PAST,
        )

    def test_each_store_sees_only_its_own_opening_balance(self):
        # Created oldest-store-first, which is exactly what the old
        # .first() (pk order) handed back to every store.
        self._ob('1000.00', location_id=STORE_A)
        self._ob('250.00', location_id=STORE_B)
        a = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        b = services.party_overview('Supplier', SUPPLIER, location_id=STORE_B)
        self.assertEqual(Decimal(a['opening_balance']), Decimal('1000.00'))
        self.assertEqual(Decimal(b['opening_balance']), Decimal('250.00'))
        self.assertEqual(Decimal(b['outstanding']), Decimal('250.00'))

    def test_no_location_sums_every_store(self):
        self._ob('1000.00', location_id=STORE_A)
        self._ob('250.00', location_id=STORE_B)
        ov = services.party_overview('Supplier', SUPPLIER)
        self.assertEqual(Decimal(ov['opening_balance']), Decimal('1250.00'))
        self.assertEqual(Decimal(ov['outstanding']), Decimal('1250.00'))

    def test_legacy_null_location_row_counts_for_every_store(self):
        # Migration 0005 added location_id NULLABLE with no backfill, and
        # post_opening_balance_je refuses to post a JE for a NULL-location row,
        # so these can only ever be counted arithmetically here. Dropping them
        # would swap today's overstatement for a silent understatement.
        self._ob('700.00', location_id=None)
        a = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        b = services.party_overview('Supplier', SUPPLIER, location_id=STORE_B)
        self.assertEqual(Decimal(a['opening_balance']), Decimal('700.00'))
        self.assertEqual(Decimal(b['opening_balance']), Decimal('700.00'))

    def test_legacy_row_adds_to_the_stores_own_row(self):
        self._ob('700.00', location_id=None)
        self._ob('300.00', location_id=STORE_A)
        a = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(Decimal(a['opening_balance']), Decimal('1000.00'))

    def test_opening_balance_dated_after_the_as_of_is_excluded(self):
        self._ob('1000.00', location_id=STORE_A, as_of=FUTURE)
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertEqual(Decimal(ov['opening_balance']), Decimal('0.00'))
        self.assertIsNone(ov['opening_balance_as_of'])

    def test_opening_balance_counts_without_a_gl_counterpart(self):
        # PARTY_LEDGERS_ENABLED is off under the test runner, so no OB journal
        # entry is ever posted — the stored amount is the only carrier.
        self._ob('1000.00', location_id=STORE_A)
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_A)
        self.assertIsNone(PartyOpeningBalance.objects.get().journal_entry_id)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('1000.00'))

    def test_opening_balance_adds_to_the_same_stores_movements(self):
        self._ob('1000.00', location_id=STORE_A)
        self._ob('250.00', location_id=STORE_B)
        _jv([
            (self.payable, '0.00', '400.00', ('Supplier', SUPPLIER)),
            (self.cash, '400.00', '0.00', None),
        ], voucher_type='PURCHASE', location_id=STORE_B)
        b = services.party_overview('Supplier', SUPPLIER, location_id=STORE_B)
        self.assertEqual(Decimal(b['outstanding']), Decimal('650.00'))

    def test_statement_opening_is_store_scoped(self):
        self._ob('1000.00', location_id=STORE_A)
        self._ob('250.00', location_id=STORE_B)
        stmt = services.statement_of_account('Supplier', SUPPLIER,
                                             location_id=STORE_B)
        self.assertEqual(Decimal(stmt['stored_opening_balance']), Decimal('250.00'))
        self.assertEqual(Decimal(stmt['opening_balance']), Decimal('250.00'))

    def test_list_parties_scopes_opening_balances_per_store(self):
        self._ob('1000.00', location_id=STORE_A)
        self._ob('250.00', location_id=STORE_B)
        # The supplier master row is store-scoped in inventory, so patch it into
        # whichever store is being asked about.
        with _patch_suppliers(_fake_supplier(SUPPLIER, 'Acme Pharma', STORE_A)):
            rows_a = services.list_parties('Supplier', location_id=STORE_A)
            rows_all = services.list_parties('Supplier')
        with _patch_suppliers(_fake_supplier(SUPPLIER, 'Acme Pharma', STORE_B)):
            rows_b = services.list_parties('Supplier', location_id=STORE_B)
        self.assertEqual(Decimal(rows_a[0]['opening_balance']), Decimal('1000.00'))
        self.assertEqual(Decimal(rows_b[0]['opening_balance']), Decimal('250.00'))
        self.assertEqual(Decimal(rows_all[0]['opening_balance']), Decimal('1250.00'))
        self.assertEqual(Decimal(rows_all[0]['outstanding']), Decimal('1250.00'))

    def test_list_parties_matches_overview_for_opening_balances(self):
        self._ob('1000.00', location_id=STORE_A)
        self._ob('250.00', location_id=STORE_B)
        with _patch_suppliers(_fake_supplier(SUPPLIER, 'Acme Pharma', STORE_B)):
            rows = services.list_parties('Supplier', location_id=STORE_B)
        ov = services.party_overview('Supplier', SUPPLIER, location_id=STORE_B)
        self.assertEqual(rows[0]['outstanding'], ov['outstanding'])
        self.assertEqual(rows[0]['opening_balance'], ov['opening_balance'])


@override_settings(PARTY_LEDGERS_ENABLED=True)
class OpeningBalanceWithGLCounterpartTests(TestCase):
    """With the GL counterpart posted, Parties (stored amount + non-OB tagged
    lines) and Payables (which counts the OB JE itself) must land on the same
    number — that is the whole point of excluding the OB JE from the tag
    aggregation instead of skipping the arithmetic addition."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        sc, _ = ChartOfAccount.objects.get_or_create(
            account_code='2105',
            defaults=dict(account_name='Sundry Creditors', account_type='LIABILITY',
                          account_subtype='Payable', is_leaf=False, is_active=True))
        ChartOfAccount.objects.filter(account_code='2110').update(parent=sc, is_leaf=True)
        AccountMapping.objects.get_or_create(
            key='OPENING_BALANCE_EQUITY',
            defaults={'account': ChartOfAccount.objects.get(account_code='3300')})

    def _post_ob(self, amount, *, location_id):
        from parties.opening_balance import post_opening_balance_je
        ob = PartyOpeningBalance.objects.create(
            party_type='Supplier', party_id=SUPPLIER, location_id=location_id,
            amount=Decimal(amount), as_of_date=PAST)
        post_opening_balance_je(ob)
        return ob

    def test_parties_and_payables_agree_per_store(self):
        self._post_ob('1000.00', location_id=STORE_A)
        self._post_ob('250.00', location_id=STORE_B)
        for store, expected in ((STORE_A, '1000.00'), (STORE_B, '250.00')):
            ov = services.party_overview('Supplier', SUPPLIER, location_id=store)
            self.assertEqual(Decimal(ov['outstanding']), Decimal(expected))
            self.assertEqual(Decimal(ov['outstanding']),
                             _payables_report_balance(SUPPLIER, location_id=store))

    def test_opening_balance_is_not_double_counted_all_stores(self):
        self._post_ob('1000.00', location_id=STORE_A)
        self._post_ob('250.00', location_id=STORE_B)
        ov = services.party_overview('Supplier', SUPPLIER)
        self.assertEqual(Decimal(ov['outstanding']), Decimal('1250.00'))
        self.assertEqual(Decimal(ov['outstanding']),
                         _payables_report_balance(SUPPLIER))

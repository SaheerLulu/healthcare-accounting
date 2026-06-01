"""Per-party ledger (Tally Sundry Creditor/Debtor) behaviour.

These tests opt INTO the feature with @override_settings(PARTY_LEDGERS_ENABLED=True)
— it defaults OFF under the test runner so the rest of the suite keeps asserting
the established shared-control-account behaviour. The inventory proxy tables don't
exist in the test DB, so party-ledger names fall back to "Supplier #<id>" — we
assert on the deterministic account_code / party link, never the name.
"""
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings

from core.models import AccountMapping, ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from core.party_ledgers import (
    get_or_create_party_ledger, get_party_ledger, resolve_party_account,
)
from journals.models import JournalEntry, JournalEntryLine
from journals.services import JournalAutoGenerationService

ENABLED = override_settings(PARTY_LEDGERS_ENABLED=True)


def ensure_party_groups():
    """Make sure 2105 Sundry Creditors / 1125 Sundry Debtors exist as groups
    with 2110/1130 re-homed under them, plus 3300 + the OBE mapping. Migrations
    usually seed these, but pin them so the tests are self-contained."""
    sc, _ = ChartOfAccount.objects.get_or_create(
        account_code='2105',
        defaults=dict(account_name='Sundry Creditors', account_type='LIABILITY',
                      account_subtype='Payable', is_leaf=False, is_active=True))
    sd, _ = ChartOfAccount.objects.get_or_create(
        account_code='1125',
        defaults=dict(account_name='Sundry Debtors', account_type='ASSET',
                      account_subtype='Receivable', is_leaf=False, is_active=True))
    ChartOfAccount.objects.filter(account_code='2110').update(parent=sc, is_leaf=True)
    ChartOfAccount.objects.filter(account_code='1130').update(parent=sd, is_leaf=True)
    obe, _ = ChartOfAccount.objects.get_or_create(
        account_code='3300',
        defaults=dict(account_name='Opening Balance Equity', account_type='EQUITY',
                      account_subtype='Capital', is_leaf=True, is_active=True))
    AccountMapping.objects.get_or_create(
        key='OPENING_BALANCE_EQUITY', defaults={'account': obe})


def _b2b_order(*, payment_type, oid=701, customer_id=42, location_id=1):
    line = SimpleNamespace(
        product_id=101, quantity=10, unit_price=Decimal('100.00'),
        discount_percent=Decimal('0'), discount_amount=Decimal('0'),
        tax_percent=Decimal('18.00'),
        cgst_amount=Decimal('90.00'), sgst_amount=Decimal('90.00'),
        igst_amount=Decimal('0'), line_total=Decimal('1000.00'))

    class _LinesMgr:
        def all(self):
            return [line]

    return SimpleNamespace(
        id=oid, status='confirmed', invoice_no=f'B2B-{oid}',
        customer=SimpleNamespace(gst_no='27ZZZZZ1234Z1Z5'),
        customer_id=customer_id, location_id=location_id,
        sale_date=date(2026, 4, 15), created_at=datetime(2026, 4, 15),
        payment_type=payment_type, subtotal=Decimal('1000.00'),
        discount_amount=Decimal('0'), total_amount=Decimal('1180.00'),
        supply_type='intra_state', round_off=Decimal('0'),
        gst_percent=Decimal('18.00'),
        total_cgst=Decimal('90.00'), total_sgst=Decimal('90.00'),
        total_igst=Decimal('0'), lines=_LinesMgr())


@ENABLED
class PartyLedgerResolverTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        ensure_party_groups()

    def test_creates_supplier_leaf_under_2105(self):
        led = get_or_create_party_ledger('Supplier', 5)
        self.assertEqual(led.account_code, '2105-S5')
        self.assertEqual(led.account_subtype, 'Payable')
        self.assertEqual(led.account_type, 'LIABILITY')
        self.assertEqual(led.parent.account_code, '2105')
        self.assertIsNone(led.location_id)
        self.assertTrue(led.is_leaf)
        self.assertEqual((led.party_type, led.party_id), ('Supplier', 5))

    def test_creates_customer_leaf_under_1125(self):
        led = get_or_create_party_ledger('Customer', 9)
        self.assertEqual(led.account_code, '1125-C9')
        self.assertEqual(led.account_subtype, 'Receivable')
        self.assertEqual(led.parent.account_code, '1125')

    def test_idempotent(self):
        a = get_or_create_party_ledger('Supplier', 5)
        b = get_or_create_party_ledger('Supplier', 5)
        self.assertEqual(a.id, b.id)
        self.assertEqual(ChartOfAccount.objects.filter(party_type='Supplier', party_id=5).count(), 1)

    def test_location_guard_rejects_per_location(self):
        with self.assertRaises(ValueError):
            get_or_create_party_ledger('Supplier', 5, location_id=7)

    def test_first_child_demotes_group_to_non_leaf(self):
        ChartOfAccount.objects.filter(account_code='2105').update(is_leaf=True)
        get_or_create_party_ledger('Supplier', 5)
        self.assertFalse(ChartOfAccount.objects.get(account_code='2105').is_leaf)

    def test_resolve_returns_fallback_for_no_party(self):
        ctrl = AccountMapping.get_account('TRADE_PAYABLES')
        self.assertEqual(resolve_party_account('Supplier', None, ctrl).id, ctrl.id)

    def test_resolve_returns_ledger_for_party(self):
        ctrl = AccountMapping.get_account('TRADE_PAYABLES')
        self.assertEqual(resolve_party_account('Supplier', 5, ctrl).account_code, '2105-S5')


class FlagOffTests(TestCase):
    """With the flag off, party postings stay on the control account."""
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        ensure_party_groups()

    @override_settings(PARTY_LEDGERS_ENABLED=False)
    def test_resolve_falls_back_when_disabled(self):
        ctrl = AccountMapping.get_account('TRADE_PAYABLES')
        self.assertEqual(resolve_party_account('Supplier', 5, ctrl).id, ctrl.id)
        self.assertIsNone(get_party_ledger('Supplier', 5))


@ENABLED
class RoutingTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        ensure_party_groups()
        self.svc = JournalAutoGenerationService()

    def _gen_b2b(self, order):
        with patch('journals.services.B2BSalesOrderRO') as MockRO, \
             patch.object(self.svc, '_product_avg_cost', return_value=Decimal('60.00')):
            (MockRO.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = order
            return self.svc.generate_b2b_sale(order.id)

    def test_b2b_credit_routes_to_customer_ledger(self):
        entry = self._gen_b2b(_b2b_order(payment_type='Credit', customer_id=42))
        ar = [l for l in entry.lines.all()
              if l.account.account_subtype == 'Receivable' and l.debit > 0]
        self.assertEqual(len(ar), 1)
        self.assertEqual(ar[0].account.account_code, '1125-C42')
        self.assertEqual((ar[0].party_type, ar[0].party_id), ('Customer', 42))
        self.assertFalse(JournalEntryLine.objects.filter(
            entry=entry, account__account_code='1130').exists())

    def test_b2b_cash_creates_no_party_ledger(self):
        entry = self._gen_b2b(_b2b_order(payment_type='Cash', customer_id=55))
        self.assertTrue(JournalEntryLine.objects.filter(
            entry=entry, account__account_code='1110').exists())
        self.assertIsNone(get_party_ledger('Customer', 55))

    def test_payment_routes_to_supplier_ledger(self):
        entry = self.svc.generate_payment({
            'date': date(2026, 4, 15), 'amount': Decimal('500.00'),
            'party_id': 7, 'payment_mode': 'cash', 'location_id': 1})
        pay = [l for l in entry.lines.all() if l.account.account_subtype == 'Payable']
        self.assertEqual(pay[0].account.account_code, '2105-S7')
        self.assertEqual((pay[0].party_type, pay[0].party_id), ('Supplier', 7))

    def test_receipt_routes_to_customer_ledger(self):
        entry = self.svc.generate_receipt({
            'date': date(2026, 4, 15), 'amount': Decimal('300.00'),
            'party_id': 9, 'receipt_mode': 'cash', 'skip_ar_check': True,
            'location_id': 1})
        rec = [l for l in entry.lines.all() if l.account.account_subtype == 'Receivable']
        self.assertEqual(rec[0].account.account_code, '1125-C9')

    def test_payment_without_party_stays_on_control(self):
        entry = self.svc.generate_payment({
            'date': date(2026, 4, 15), 'amount': Decimal('500.00'),
            'party_id': None, 'payment_mode': 'cash', 'location_id': 1})
        pay = [l for l in entry.lines.all() if l.account.account_subtype == 'Payable']
        self.assertEqual(pay[0].account.account_code, '2110')


@ENABLED
class TagLedgerInvariantTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        ensure_party_groups()
        self.entry = JournalEntry.objects.create(
            date=date(2026, 4, 15), voucher_type='PAYMENT', location_id=1)
        self.s1 = get_or_create_party_ledger('Supplier', 1)

    def test_mismatched_party_tag_rejected(self):
        with self.assertRaises(ValidationError):
            JournalEntryLine.objects.create(
                entry=self.entry, account=self.s1, debit=Decimal('10'),
                party_type='Supplier', party_id=2)

    def test_matching_party_tag_ok(self):
        line = JournalEntryLine.objects.create(
            entry=self.entry, account=self.s1, debit=Decimal('10'),
            party_type='Supplier', party_id=1)
        self.assertIsNotNone(line.id)

    def test_untagged_line_on_control_ok(self):
        ctrl = AccountMapping.get_account('TRADE_PAYABLES')
        line = JournalEntryLine.objects.create(
            entry=self.entry, account=ctrl, credit=Decimal('10'),
            party_type='Supplier', party_id=99)
        self.assertIsNotNone(line.id)  # control account is unconstrained


@ENABLED
class ManualJEAutoRouteTests(TestCase):
    """The JournalEntry create serializer redirects a party-tagged line that
    points at the Trade Payables/Receivables control onto the party's ledger."""
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        ensure_party_groups()

    def test_serializer_routes_control_line_to_party_ledger(self):
        from journals.serializers import JournalEntryCreateSerializer
        ctrl = AccountMapping.get_account('TRADE_RECEIVABLES')
        cash = AccountMapping.get_account('CASH')
        payload = {
            'date': '2026-04-15', 'voucher_type': 'RECEIPT',
            'reference_type': 'Manual', 'location_id': 1,
            'lines': [
                {'account': ctrl.id, 'debit': '0', 'credit': '250',
                 'party_type': 'Customer', 'party_id': 33},
                {'account': cash.id, 'debit': '250', 'credit': '0',
                 'party_type': 'None'},
            ],
        }
        ser = JournalEntryCreateSerializer(data=payload)
        ser.is_valid(raise_exception=True)
        entry = ser.save()
        cust_line = entry.lines.get(party_id=33)
        self.assertEqual(cust_line.account.account_code, '1125-C33')


@ENABLED
class OpeningBalanceGLTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        ensure_party_groups()

    def _make_ob(self, party_type, pid, amount):
        from parties.models import PartyOpeningBalance
        from parties.opening_balance import post_opening_balance_je
        ob = PartyOpeningBalance.objects.create(
            party_type=party_type, party_id=pid,
            amount=Decimal(amount), as_of_date=date(2026, 4, 1))
        post_opening_balance_je(ob)
        return ob

    def test_supplier_ob_posts_balanced_je_against_3300(self):
        ob = self._make_ob('Supplier', 5, '1000.00')
        self.assertIsNotNone(ob.journal_entry)
        je = ob.journal_entry
        led = get_party_ledger('Supplier', 5)
        self.assertEqual(je.reference_type, 'PartyOpeningBalance')
        # Creditor: Cr party ledger, Dr 3300.
        self.assertEqual(led.get_balance(), Decimal('-1000.00'))
        obe = ChartOfAccount.objects.get(account_code='3300')
        self.assertEqual(obe.get_balance(), Decimal('1000.00'))

    def test_customer_ob_posts_debit_to_ledger(self):
        self._make_ob('Customer', 9, '750.00')
        led = get_party_ledger('Customer', 9)
        self.assertEqual(led.get_balance(), Decimal('750.00'))

    def test_ob_not_double_counted_in_party_overview(self):
        from parties import services
        self._make_ob('Supplier', 5, '1000.00')
        ov = services.party_overview('Supplier', 5)
        # Outstanding = stored OB only (1000), NOT 2000 (OB JE excluded from tags).
        self.assertEqual(Decimal(ov['outstanding']), Decimal('1000.00'))

    def test_void_reverses_je(self):
        from parties.opening_balance import void_opening_balance_je
        ob = self._make_ob('Supplier', 5, '1000.00')
        void_opening_balance_je(ob)
        led = get_party_ledger('Supplier', 5)
        # Original + reversal net to zero on the ledger.
        self.assertEqual(led.get_balance(), Decimal('0.00'))
        self.assertIsNone(ob.journal_entry)


@ENABLED
class RollupTests(TestCase):
    """Per-party leaves roll up under the group: the group's children sum to the
    same total the single control used to carry."""
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        ensure_party_groups()
        self.svc = JournalAutoGenerationService()

    def test_two_suppliers_roll_up_under_2105(self):
        for pid, amt in ((1, '500.00'), (2, '300.00')):
            self.svc.generate_payment({
                'date': date(2026, 4, 15), 'amount': Decimal(amt),
                'party_id': pid, 'payment_mode': 'cash', 'location_id': 1})
        sc = ChartOfAccount.objects.get(account_code='2105')
        children_total = sum(
            (c.get_balance() for c in ChartOfAccount.objects.filter(parent=sc)),
            Decimal('0.00'))
        s1 = get_party_ledger('Supplier', 1).get_balance()
        s2 = get_party_ledger('Supplier', 2).get_balance()
        self.assertEqual(children_total, s1 + s2)
        self.assertEqual(s1, Decimal('500.00'))  # Dr payable (payment reduces liability)

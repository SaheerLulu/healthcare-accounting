"""A purchase settles where it was actually paid from, mirroring sales.

Every synced purchase used to credit Trade Payables whatever the purchase
order's payment_type said, so a cash purchase was booked as money still owed
and Payables overstated by the whole of it — while _sale_settlement had always
branched (Credit -> receivable, UPI/Card/Cheque -> Bank, cash -> Cash).

The asymmetry that stays deliberate: a BLANK payment type means Credit here,
not Cash. An unknown sale is a counter sale whose money came in; crediting Cash
for a bill we cannot prove was paid would drain the cash book and make a real
liability vanish.
"""
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.services import JournalAutoGenerationService

PAYABLES, CASH, BANK, STOCK = '2110', '1110', '1120', '1190'
SUPPLIER = 9
_UNSET = object()


def _purchase_order(payment_type=_UNSET):
    """₹1000 taxable, no tax. `payment_type` omitted entirely reproduces a PO
    row that never carried the column."""
    line = SimpleNamespace(
        product_id=101, quantity=100, free_qty=0,
        purchase_rate=Decimal('10.00'), discount_percent=Decimal('0'),
        cgst_amount=Decimal('0'), sgst_amount=Decimal('0'),
        igst_amount=Decimal('0'), tax_percent=Decimal('0'),
    )

    class _LinesMgr:
        def all(self):
            return [line]

    po = SimpleNamespace(
        id=501, state='confirmed',
        supplier=SimpleNamespace(gst_no='27AABCT1234A1Z5', state='Maharashtra'),
        supplier_id=SUPPLIER, location_id=1,
        bill_date=None, bill_no='PO-001',
        transport_cost=Decimal('0'), other_charges=Decimal('0'),
        additional_discount=Decimal('0'), round_off=Decimal('0'),
        supply_type='intra_state', created_at=datetime(2026, 4, 10),
        lines=_LinesMgr(),
    )
    if payment_type is not _UNSET:
        po.payment_type = payment_type
    return po


def _purchase_return(original_po=None):
    """A ₹500 return, no tax, against `original_po`."""
    line = SimpleNamespace(
        product_id=101, quantity=50, purchase_rate=Decimal('10.00'),
        tax_percent=Decimal('0'), cgst_amount=Decimal('0'),
        sgst_amount=Decimal('0'), igst_amount=Decimal('0'),
    )

    class _LinesMgr:
        def all(self):
            return [line]

    return SimpleNamespace(
        id=601, status='confirmed', return_no='PRET-1',
        supplier=SimpleNamespace(gst_no='27AABCT1234A1Z5', state='Maharashtra'),
        supplier_id=SUPPLIER, location_id=1,
        original_purchase_order=original_po,
        return_date=date(2026, 4, 20),
        subtotal=Decimal('500.00'), round_off=Decimal('0'),
        supply_type='intra_state', lines=_LinesMgr(),
    )


class PurchaseSettlementTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _post(self, po):
        with patch('journals.services.PurchaseOrderRO') as MockPO:
            (MockPO.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = po
            entry = self.svc.generate_purchase(po.id)
        self.assertIsNotNone(entry)
        return {l.account.account_code: l for l in entry.lines.all()}

    def test_credit_purchase_still_creates_a_payable(self):
        lines = self._post(_purchase_order('Credit'))
        self.assertIn(PAYABLES, lines)
        self.assertEqual(lines[PAYABLES].credit, Decimal('1000.00'))
        # Tagged, or AP aging cannot attribute the debt.
        self.assertEqual(lines[PAYABLES].party_type, 'Supplier')
        self.assertEqual(lines[PAYABLES].party_id, SUPPLIER)
        self.assertNotIn(CASH, lines)

    def test_cash_purchase_credits_cash_not_payables(self):
        lines = self._post(_purchase_order('Cash'))
        self.assertIn(CASH, lines)
        self.assertEqual(lines[CASH].credit, Decimal('1000.00'))
        self.assertNotIn(PAYABLES, lines,
                         'a paid-for purchase is not money still owed')

    def test_cash_purchase_line_is_not_party_tagged(self):
        """A tag on a settled line would put the bill back on Payables — the
        AR/AP surfaces key off the party tag."""
        lines = self._post(_purchase_order('Cash'))
        self.assertEqual(lines[CASH].party_type, 'None')
        self.assertIsNone(lines[CASH].party_id)

    def test_upi_card_and_cheque_purchases_credit_bank(self):
        for mode in ('UPI', 'Card', 'Cheque'):
            with self.subTest(mode=mode):
                self.svc = JournalAutoGenerationService()
                po = _purchase_order(mode)
                po.id = 500 + len(mode)  # a fresh reference id per mode
                lines = self._post(po)
                self.assertIn(BANK, lines, f'{mode} settles through the bank')
                self.assertEqual(lines[BANK].credit, Decimal('1000.00'))
                self.assertNotIn(PAYABLES, lines)
                self.assertNotIn(CASH, lines)

    def test_lowercase_credit_is_still_credit(self):
        lines = self._post(_purchase_order('credit'))
        self.assertIn(PAYABLES, lines)

    def test_blank_payment_type_stays_a_payable(self):
        """Unknown terms must not silently drain the cash book — the inventory
        PO model defaults to Credit and so does this."""
        for missing in ('', None):
            with self.subTest(payment_type=missing):
                self.svc = JournalAutoGenerationService()
                po = _purchase_order(missing)
                po.id = 520 if missing == '' else 521
                lines = self._post(po)
                self.assertIn(PAYABLES, lines)
                self.assertNotIn(CASH, lines)

    def test_a_po_row_without_the_column_at_all_stays_a_payable(self):
        lines = self._post(_purchase_order())
        self.assertIn(PAYABLES, lines)

    def test_the_entry_still_balances_whichever_way_it_settled(self):
        for pt, code in (('Credit', PAYABLES), ('Cash', CASH), ('UPI', BANK)):
            with self.subTest(payment_type=pt):
                self.svc = JournalAutoGenerationService()
                po = _purchase_order(pt)
                po.id = 530 + len(pt)
                lines = self._post(po)
                self.assertEqual(lines[STOCK].debit, Decimal('1000.00'))
                self.assertEqual(lines[code].credit, Decimal('1000.00'))


class PurchaseReturnSettlementTests(TestCase):
    """A return refunds to wherever the purchase was settled. Debiting Payables
    for a cash purchase would leave the supplier owing US money on Payables for
    goods we had already paid for."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _post(self, ret):
        with patch('journals.services.PurchaseReturnRO') as MockRet:
            (MockRet.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = ret
            entry = self.svc.generate_purchase_return(ret.id)
        self.assertIsNotNone(entry)
        return {l.account.account_code: l for l in entry.lines.all()}

    def test_return_of_a_credit_purchase_debits_payables(self):
        lines = self._post(_purchase_return(_purchase_order('Credit')))
        self.assertIn(PAYABLES, lines)
        self.assertEqual(lines[PAYABLES].debit, Decimal('500.00'))
        self.assertEqual(lines[PAYABLES].party_id, SUPPLIER)

    def test_return_of_a_cash_purchase_debits_cash(self):
        lines = self._post(_purchase_return(_purchase_order('Cash')))
        self.assertIn(CASH, lines)
        self.assertEqual(lines[CASH].debit, Decimal('500.00'))
        self.assertNotIn(PAYABLES, lines)

    def test_return_of_a_upi_purchase_debits_bank(self):
        lines = self._post(_purchase_return(_purchase_order('UPI')))
        self.assertIn(BANK, lines)
        self.assertEqual(lines[BANK].debit, Decimal('500.00'))

    def test_return_with_no_original_po_falls_back_to_payables(self):
        """The FK is nullable and db_constraint=False, so it can be absent or
        dangle. Reducing the payable is the safe reading."""
        lines = self._post(_purchase_return(None))
        self.assertIn(PAYABLES, lines)
        self.assertNotIn(CASH, lines)

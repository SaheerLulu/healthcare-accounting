"""B2B sales and sales-return JEs must branch their settlement account on
the order's payment_type. Credit → Trade Receivables (1130) with party tag;
Cash/Bank/Card/UPI etc. → Cash (1110) with no party tag (party_type on a
cash leg would inflate PartyOutstandingView)."""
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.services import JournalAutoGenerationService


def _b2b_order(*, payment_type, oid=701, location_id=1):
    """Single-line B2B order: 10 units × ₹100 = ₹1000 taxable + 18% GST = ₹1180 total."""
    line = SimpleNamespace(
        product_id=101, quantity=10,
        unit_price=Decimal('100.00'),
        discount_percent=Decimal('0'), discount_amount=Decimal('0'),
        tax_percent=Decimal('18.00'),
        cgst_amount=Decimal('90.00'), sgst_amount=Decimal('90.00'),
        igst_amount=Decimal('0'),
        line_total=Decimal('1000.00'),
    )

    class _LinesMgr:
        def all(self):
            return [line]

    return SimpleNamespace(
        id=oid, status='confirmed',
        invoice_no=f'B2B-{oid}',
        customer=SimpleNamespace(gst_no='27ZZZZZ1234Z1Z5'),
        customer_id=42, location_id=location_id,
        sale_date=date(2026, 4, 15), created_at=datetime(2026, 4, 15),
        payment_type=payment_type,
        subtotal=Decimal('1000.00'),
        discount_amount=Decimal('0'),
        total_amount=Decimal('1180.00'),
        supply_type='intra_state', round_off=Decimal('0'),
        gst_percent=Decimal('18.00'),
        total_cgst=Decimal('90.00'), total_sgst=Decimal('90.00'),
        total_igst=Decimal('0'),
        lines=_LinesMgr(),
    )


def _b2b_return(*, original_payment_type, rid=801, oid=701, location_id=1):
    """Full return of the order built by _b2b_order — same single line."""
    line = SimpleNamespace(
        product_id=101, quantity=10,
        unit_price=Decimal('100.00'),
        tax_percent=Decimal('18.00'),
        line_total=Decimal('1180.00'),  # SalesReturnLineRO line_total is tax-INCLUSIVE
    )

    class _LinesMgr:
        def all(self):
            return [line]

    return SimpleNamespace(
        id=rid, status='confirmed',
        return_no=f'RET-{rid}', return_type='b2b',
        customer=SimpleNamespace(gst_no='27ZZZZZ1234Z1Z5'),
        customer_id=42, location_id=location_id,
        return_date=datetime(2026, 4, 20),
        original_b2b_order=SimpleNamespace(
            id=oid, payment_type=original_payment_type,
        ),
        gst_percent=Decimal('18.00'),
        discount_amount=Decimal('0'),
        subtotal=Decimal('1180.00'),
        total_amount=Decimal('1180.00'),
        round_off=Decimal('0'),
        lines=_LinesMgr(),
    )


class B2BSalePaymentTypeRoutingTests(TestCase):
    """Forward B2B sale — settlement account depends on payment_type."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _generate(self, order):
        with patch('journals.services.B2BSalesOrderRO') as MockRO, \
             patch.object(self.svc, '_product_avg_cost', return_value=Decimal('60.00')):
            (MockRO.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = order
            return self.svc.generate_b2b_sale(order.id)

    def test_credit_sale_debits_trade_receivables_with_party_tag(self):
        entry = self._generate(_b2b_order(payment_type='Credit'))

        ar_lines = [l for l in entry.lines.all() if l.account.account_code == '1130']
        self.assertEqual(len(ar_lines), 1, 'Credit sale should debit TRADE_RECEIVABLES once')
        ar = ar_lines[0]
        self.assertEqual(ar.debit, Decimal('1180.00'))
        self.assertEqual(ar.credit, Decimal('0'))
        self.assertEqual(ar.party_type, 'Customer')
        self.assertEqual(ar.party_id, 42)

        cash_lines = [l for l in entry.lines.all() if l.account.account_code == '1110']
        self.assertEqual(cash_lines, [], 'Credit sale must NOT touch CASH')

    def test_cash_sale_debits_cash_without_party_tag(self):
        entry = self._generate(_b2b_order(payment_type='Cash'))

        cash_lines = [l for l in entry.lines.all() if l.account.account_code == '1110']
        self.assertEqual(len(cash_lines), 1, 'Cash sale should debit CASH once')
        c = cash_lines[0]
        self.assertEqual(c.debit, Decimal('1180.00'))
        self.assertEqual(c.credit, Decimal('0'))
        self.assertEqual(c.party_type, 'None',
                         'CASH line must not carry a party_type — would inflate AR aging')
        self.assertIsNone(c.party_id)

        ar_lines = [l for l in entry.lines.all() if l.account.account_code == '1130']
        self.assertEqual(ar_lines, [], 'Cash sale must NOT touch TRADE_RECEIVABLES')

    def test_upi_card_bank_all_route_to_bank(self):
        """UPI/Card/Bank/Cheque settle into the BANK account — they never
        touch the cash drawer (UPI credits the linked bank account, card
        settlements arrive via the acquirer, cheques are banked)."""
        # Deterministic, distinct oids — hash(mode) is randomized per process
        # (PYTHONHASHSEED) and two modes could collide, making the second
        # generate_b2b_sale a no-op (idempotency guard) and return None.
        for i, mode in enumerate(('UPI', 'Card', 'Bank', 'Cheque')):
            with self.subTest(mode=mode):
                entry = self._generate(_b2b_order(payment_type=mode, oid=720 + i))
                bank = [l for l in entry.lines.all() if l.account.account_code == '1120']
                self.assertEqual(len(bank), 1, f'{mode!r} should debit BANK')
                self.assertEqual(bank[0].debit, Decimal('1180.00'))
                cash = [l for l in entry.lines.all() if l.account.account_code == '1110']
                self.assertEqual(cash, [], f'{mode!r} must NOT touch CASH')


class B2BReturnPaymentTypeRoutingTests(TestCase):
    """Sales return — credit account must mirror the original sale's settlement."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _generate(self, ret):
        with patch('journals.services.SalesReturnRO') as MockRO, \
             patch.object(self.svc, '_product_avg_cost', return_value=Decimal('60.00')):
            (MockRO.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = ret
            return self.svc.generate_sales_return(ret.id)

    def test_return_of_credit_sale_credits_trade_receivables_with_party_tag(self):
        entry = self._generate(_b2b_return(original_payment_type='Credit'))

        ar_lines = [l for l in entry.lines.all() if l.account.account_code == '1130']
        self.assertEqual(len(ar_lines), 1, 'Return of credit sale should credit AR once')
        ar = ar_lines[0]
        self.assertEqual(ar.credit, Decimal('1180.00'))
        self.assertEqual(ar.debit, Decimal('0'))
        self.assertEqual(ar.party_type, 'Customer',
                         'AR credit must tag the party so the receivable clears in aging')
        self.assertEqual(ar.party_id, 42)

        cash_lines = [l for l in entry.lines.all() if l.account.account_code == '1110']
        self.assertEqual(cash_lines, [], 'Return of credit sale must NOT touch CASH')

    def test_return_of_cash_sale_credits_cash_without_party_tag(self):
        entry = self._generate(_b2b_return(original_payment_type='Cash'))

        cash_lines = [l for l in entry.lines.all() if l.account.account_code == '1110']
        self.assertEqual(len(cash_lines), 1, 'Return of cash sale should credit CASH once')
        c = cash_lines[0]
        self.assertEqual(c.credit, Decimal('1180.00'))
        self.assertEqual(c.debit, Decimal('0'))
        self.assertEqual(c.party_type, 'None')
        self.assertIsNone(c.party_id)

        ar_lines = [l for l in entry.lines.all() if l.account.account_code == '1130']
        self.assertEqual(ar_lines, [], 'Return of cash sale must NOT touch TRADE_RECEIVABLES')

    def test_return_with_missing_original_order_defaults_to_cash(self):
        """Defensive: if the original_b2b_order FK is None (data quality issue),
        we route to CASH rather than silently creating phantom AR."""
        ret = _b2b_return(original_payment_type='Credit')
        ret.original_b2b_order = None
        entry = self._generate(ret)

        cash_lines = [l for l in entry.lines.all() if l.account.account_code == '1110']
        self.assertEqual(len(cash_lines), 1)
        self.assertEqual(cash_lines[0].credit, Decimal('1180.00'))


class ReceiptVoucherARGuardTests(TestCase):
    """Manual receipts must not drive a customer into negative AR — protects
    against the case where a B2B sale was cash-paid (no AR created) and the
    user mistakenly tries to record a receipt against it."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _post_credit_b2b_sale(self, customer_id=42, oid=701):
        """Generate a Credit B2B sale that leaves ₹1180 open AR for the customer."""
        order = _b2b_order(payment_type='Credit', oid=oid)
        order.customer_id = customer_id
        with patch('journals.services.B2BSalesOrderRO') as MockRO, \
             patch.object(self.svc, '_product_avg_cost', return_value=Decimal('60.00')):
            (MockRO.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = order
            self.svc.generate_b2b_sale(order.id)

    def test_receipt_within_open_ar_succeeds(self):
        self._post_credit_b2b_sale(customer_id=42)
        entry = self.svc.generate_receipt({
            'date': date(2026, 4, 20), 'amount': Decimal('500.00'),
            'party_id': 42, 'receipt_mode': 'cash',
            'narration': 'Partial payment', 'location_id': 1,
        })
        self.assertIsNotNone(entry)

    def test_receipt_exceeding_open_ar_is_rejected(self):
        self._post_credit_b2b_sale(customer_id=42)
        with self.assertRaisesRegex(ValueError, r'exceeds customer'):
            self.svc.generate_receipt({
                'date': date(2026, 4, 20), 'amount': Decimal('2000.00'),
                'party_id': 42, 'receipt_mode': 'cash',
                'narration': 'Overpay', 'location_id': 1,
            })

    def test_receipt_against_customer_with_no_ar_is_rejected(self):
        """Cash-paid customer (no AR ever created) — receipt must be blocked."""
        with self.assertRaisesRegex(ValueError, r'exceeds customer'):
            self.svc.generate_receipt({
                'date': date(2026, 4, 20), 'amount': Decimal('100.00'),
                'party_id': 99, 'receipt_mode': 'cash',
                'narration': 'Bogus receipt', 'location_id': 1,
            })

    def test_skip_ar_check_allows_advance_receipt(self):
        """Customer-advance flow: receipt comes before invoice; explicit
        opt-out lets it through (the advance creates a credit balance)."""
        entry = self.svc.generate_receipt({
            'date': date(2026, 4, 20), 'amount': Decimal('5000.00'),
            'party_id': 77, 'receipt_mode': 'bank',
            'narration': 'Advance against future invoice', 'location_id': 1,
            'skip_ar_check': True,
        })
        self.assertIsNotNone(entry)

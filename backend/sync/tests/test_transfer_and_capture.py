"""Inter-store transfers must post as stock relocations (never revenue /
purchases / AR / AP / GST), B2B extra charges must balance into income, POS
multi-tender must split Cash vs Bank, and consultation fees must reach the
books as exempt income."""
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from core.models import AccountMapping, ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry
from journals.services import JournalAutoGenerationService


def _seed_extra_accounts():
    """Accounts the new generators need beyond the shared fixture."""
    extras = {
        '1191': ('Stock In Transit', 'ASSET', ''),
        '4520': ('Freight & Charges Recovered', 'REVENUE', 'Other_Income'),
        '4320': ('Sales - Consultation', 'REVENUE', 'Sales'),
        '5210': ('Discount Allowed', 'REVENUE', 'Other_Expense'),
        '5310': ('Discount Received', 'REVENUE', 'Other_Income'),
    }
    keys = {
        'STOCK_TRANSFER_TRANSIT': '1191',
        'OTHER_CHARGES_RECOVERED': '4520',
        'CONSULTATION_INCOME': '4320',
        'DISCOUNT_ALLOWED': '5210',
        'DISCOUNT_RECEIVED': '5310',
    }
    coa = {}
    for code, (name, atype, sub) in extras.items():
        coa[code], _ = ChartOfAccount.objects.get_or_create(
            account_code=code,
            defaults=dict(account_name=name, account_type=atype,
                          account_subtype=sub, is_leaf=True, is_active=True),
        )
    for key, code in keys.items():
        AccountMapping.objects.get_or_create(key=key, defaults={'account': coa[code]})
    return coa


class _Lines:
    def __init__(self, lines):
        self._lines = lines

    def all(self):
        return self._lines


def _transfer_po(*, po_id=901, state='confirmed', kind='inter_store',
                 src=1, dst=2):
    line = SimpleNamespace(
        product_id=11, quantity=10, free_qty=0,
        purchase_rate=Decimal('50.00'), discount_percent=Decimal('0'),
        tax_percent=Decimal('5.00'),
        cgst_amount=Decimal('0'), sgst_amount=Decimal('0'),
        igst_amount=Decimal('0'),
    )
    return SimpleNamespace(
        id=po_id, state=state, transfer_kind=kind,
        transfer_source_location_id=src, location_id=dst,
        source_indent_id=77, bill_no='IND-IND-2026-001',
        bill_date=date(2026, 5, 10), created_at=datetime(2026, 5, 10),
        supplier=SimpleNamespace(gst_no='', is_internal=True), supplier_id=5,
        transport_cost=Decimal('0'), other_charges=Decimal('0'),
        round_off=Decimal('0'),
        lines=_Lines([line]),
    )


class StockTransferPostingTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        _seed_extra_accounts()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _generate(self, po):
        with patch('journals.services.PurchaseOrderRO') as MockPO:
            MockPO.objects.prefetch_related.return_value.get.return_value = po
            return self.svc.generate_stock_transfer(po.id)

    def test_transfer_posts_paired_relocation_jvs(self):
        in_entry = self._generate(_transfer_po())
        self.assertIsNotNone(in_entry)

        out_entry = JournalEntry.objects.get(
            reference_type='StockTransferOut', reference_id=901)
        in_entry = JournalEntry.objects.get(
            reference_type='StockTransferIn', reference_id=901)

        # OUT leg at the source store: Dr Transit / Cr Closing Stock @ ₹500.
        self.assertEqual(out_entry.location_id, 1)
        out_codes = {l.account.account_code: (l.debit, l.credit)
                     for l in out_entry.lines.all()}
        self.assertEqual(out_codes['1191'], (Decimal('500.00'), Decimal('0')))
        self.assertEqual(out_codes['1190'], (Decimal('0'), Decimal('500.00')))

        # IN leg at the destination store: Dr Closing Stock / Cr Transit.
        self.assertEqual(in_entry.location_id, 2)
        in_codes = {l.account.account_code: (l.debit, l.credit)
                    for l in in_entry.lines.all()}
        self.assertEqual(in_codes['1190'], (Decimal('500.00'), Decimal('0')))
        self.assertEqual(in_codes['1191'], (Decimal('0'), Decimal('500.00')))

        # No revenue, purchases, AP, AR or GST anywhere in the pair.
        all_codes = set(out_codes) | set(in_codes)
        for forbidden in ('4100', '4200', '5100', '2110', '1130',
                          '2120', '2130', '2140', '1140', '1150', '1160'):
            self.assertNotIn(forbidden, all_codes)

    def test_intra_done_state_is_posted(self):
        entry = self._generate(_transfer_po(po_id=902, state='intra_done',
                                            kind='intra_store'))
        self.assertIsNotNone(
            entry, "intra-store transfers (state 'intra_done') must be booked")

    def test_transfer_is_idempotent(self):
        po = _transfer_po(po_id=903)
        self.assertIsNotNone(self._generate(po))
        self.assertIsNone(self._generate(po), 'second run must be a no-op')

    def test_generate_purchase_skips_transfer_grns(self):
        po = _transfer_po(po_id=904)
        with patch('journals.services.PurchaseOrderRO') as MockPO:
            (MockPO.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = po
            entry = self.svc.generate_purchase(po.id)
        self.assertIsNone(
            entry, 'transfer GRN must never post as a purchase (fake AP/ITC)')

    def test_generate_b2b_sale_skips_internal_transfer_leg(self):
        order = SimpleNamespace(
            id=905, status='confirmed', source_indent_id=77,
            invoice_no='INV-X', customer=SimpleNamespace(gst_no='', is_internal=True),
            customer_id=8, location_id=1,
            sale_date=date(2026, 5, 10), created_at=datetime(2026, 5, 10),
            payment_type='Credit',
            subtotal=Decimal('500.00'), discount_amount=Decimal('0'),
            total_amount=Decimal('500.00'), round_off=Decimal('0'),
            gst_percent=Decimal('0'),
            lines=_Lines([]),
        )
        with patch('journals.services.B2BSalesOrderRO') as MockRO:
            (MockRO.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = order
            entry = self.svc.generate_b2b_sale(order.id)
        self.assertIsNone(
            entry, 'internal transfer leg must never post as B2B revenue')


class B2BChargesBalancedPostingTests(TestCase):
    """A B2B order with freight + charges used to post unbalanced and silently
    vanish from the books (entry.post() raised, sync logged the error)."""

    def setUp(self):
        seed_chart_and_mappings()
        _seed_extra_accounts()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def test_freight_and_charges_post_balanced(self):
        line = SimpleNamespace(
            product_id=11, quantity=10, unit_price=Decimal('100.00'),
            discount_percent=Decimal('0'), discount_amount=Decimal('0'),
            tax_percent=Decimal('12.00'),
            cgst_amount=Decimal('60.00'), sgst_amount=Decimal('60.00'),
            igst_amount=Decimal('0'), line_total=Decimal('1000.00'),
        )
        order = SimpleNamespace(
            id=911, status='confirmed', source_indent_id=None,
            invoice_no='INV-911',
            customer=SimpleNamespace(gst_no='27ZZZZZ1234Z1Z5', state='Maharashtra'),
            customer_id=42, location_id=1,
            sale_date=date(2026, 5, 12), created_at=datetime(2026, 5, 12),
            payment_type='Credit',
            subtotal=Decimal('1000.00'), discount_amount=Decimal('0'),
            # total = 1000 + 120 GST + 200 freight + 10 freight GST (5%)
            #         + 50 packing + 0.50 round-off
            total_amount=Decimal('1380.50'),
            round_off=Decimal('0.50'),
            freight_charge=Decimal('200.00'),
            freight_tax_percent=Decimal('5.00'),
            freight_tax_amount=Decimal('10.00'),
            service_charge=Decimal('0'), packing_charge=Decimal('50.00'),
            transportation_cost=Decimal('0'), other_charges=Decimal('0'),
            gst_percent=Decimal('12.00'),
            total_cgst=Decimal('60.00'), total_sgst=Decimal('60.00'),
            total_igst=Decimal('0'),
            lines=_Lines([line]),
        )
        with patch('journals.services.B2BSalesOrderRO') as MockRO, \
             patch.object(self.svc, '_product_avg_cost', return_value=Decimal('0')):
            (MockRO.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = order
            entry = self.svc.generate_b2b_sale(order.id)

        self.assertIsNotNone(entry, 'order with freight/charges must post')
        codes = {}
        for l in entry.lines.all():
            dr, cr = codes.get(l.account.account_code, (Decimal('0'), Decimal('0')))
            codes[l.account.account_code] = (dr + l.debit, cr + l.credit)

        self.assertEqual(codes['1130'][0], Decimal('1380.50'))  # AR at gross
        self.assertEqual(codes['4200'][1], Decimal('1000.00'))  # goods sales
        self.assertEqual(codes['4520'][1], Decimal('250.00'))   # freight+packing
        # GST = 120 on goods + 10 on freight, split CGST/SGST.
        self.assertEqual(codes['2120'][1], Decimal('65.00'))
        self.assertEqual(codes['2130'][1], Decimal('65.00'))
        # Round-off credited; entry balances overall.
        total_dr = sum(v[0] for v in codes.values())
        total_cr = sum(v[1] for v in codes.values())
        self.assertEqual(total_dr, total_cr)


class POSSettlementRoutingTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        _seed_extra_accounts()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _pos(self, *, payment_type='Cash', payments=None, pos_id=921):
        line = SimpleNamespace(
            product_id=11, quantity=2, unit_price=Decimal('105.00'),
            discount_percent=Decimal('0'), discount_amount=Decimal('0'),
            tax_percent=Decimal('5.00'), line_total=Decimal('210.00'),
        )
        pos = SimpleNamespace(
            id=pos_id, status='completed', invoice_no=f'POS-{pos_id}',
            customer_id=None, location_id=1,
            sale_date=datetime(2026, 5, 13, 11, 0),
            payment_type=payment_type,
            gst_percent=Decimal('0'), discount_amount=Decimal('0'),
            round_off=Decimal('0'), subtotal=Decimal('210.00'),
            total_amount=Decimal('210.00'),
            lines=_Lines([line]),
        )
        if payments is not None:
            pos.payments = _Lines(payments)
        return pos

    def _generate(self, pos):
        with patch('journals.services.POSOrderRO') as MockRO, \
             patch.object(self.svc, '_product_avg_cost', return_value=Decimal('0')):
            MockRO.objects.prefetch_related.return_value.get.return_value = pos
            return self.svc.generate_pos_sale(pos.id)

    def test_upi_pos_sale_lands_in_bank(self):
        entry = self._generate(self._pos(payment_type='UPI', pos_id=922))
        codes = {l.account.account_code for l in entry.lines.all() if l.debit > 0}
        self.assertIn('1120', codes, 'UPI settles to BANK')
        self.assertNotIn('1110', codes)

    def test_split_tender_posts_one_leg_per_account(self):
        payments = [
            SimpleNamespace(payment_method='Cash', amount=Decimal('110.00')),
            SimpleNamespace(payment_method='UPI', amount=Decimal('100.00')),
        ]
        entry = self._generate(self._pos(payment_type='Cash',
                                         payments=payments, pos_id=923))
        debits = {l.account.account_code: l.debit
                  for l in entry.lines.all() if l.debit > 0}
        self.assertEqual(debits.get('1110'), Decimal('110.00'))
        self.assertEqual(debits.get('1120'), Decimal('100.00'))

    def test_mismatched_tender_rows_fall_back_to_header(self):
        payments = [SimpleNamespace(payment_method='UPI', amount=Decimal('1.00'))]
        entry = self._generate(self._pos(payment_type='Cash',
                                         payments=payments, pos_id=924))
        debits = {l.account.account_code: l.debit
                  for l in entry.lines.all() if l.debit > 0}
        self.assertEqual(debits.get('1110'), Decimal('210.00'),
                         'partial tender rows must not be trusted')


class POSLoyaltyRedemptionTests(TestCase):
    """POS total = subtotal − discount − loyalty_redemption + round_off.
    A bill with a loyalty redemption used to post unbalanced and silently
    vanish from the books (entry.post() raised inside the sync loop)."""

    def setUp(self):
        seed_chart_and_mappings()
        _seed_extra_accounts()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def test_loyalty_redemption_posts_balanced(self):
        line = SimpleNamespace(
            product_id=11, quantity=2, unit_price=Decimal('105.00'),
            discount_percent=Decimal('0'), discount_amount=Decimal('0'),
            tax_percent=Decimal('0'), line_total=Decimal('210.00'),
        )
        pos = SimpleNamespace(
            id=941, status='completed', invoice_no='POS-941',
            customer_id=None, location_id=1,
            sale_date=datetime(2026, 5, 15, 11, 0),
            payment_type='Cash',
            gst_percent=Decimal('0'), discount_amount=Decimal('10.00'),
            loyalty_redemption_amount=Decimal('50.00'),
            round_off=Decimal('0'), subtotal=Decimal('210.00'),
            # 210 − 10 discount − 50 loyalty = 150 actually collected
            total_amount=Decimal('150.00'),
            lines=_Lines([line]),
        )
        with patch('journals.services.POSOrderRO') as MockRO, \
             patch.object(self.svc, '_product_avg_cost', return_value=Decimal('0')):
            MockRO.objects.prefetch_related.return_value.get.return_value = pos
            entry = self.svc.generate_pos_sale(pos.id)

        self.assertIsNotNone(entry, 'loyalty-redemption bill must post')
        codes = {}
        for l in entry.lines.all():
            dr, cr = codes.get(l.account.account_code, (Decimal('0'), Decimal('0')))
            codes[l.account.account_code] = (dr + l.debit, cr + l.credit)

        self.assertEqual(codes['1110'][0], Decimal('150.00'))   # cash collected
        self.assertEqual(codes['4100'][1], Decimal('210.00'))   # gross sales
        self.assertEqual(codes['5210'][0], Decimal('60.00'))    # discount + loyalty
        total_dr = sum(v[0] for v in codes.values())
        total_cr = sum(v[1] for v in codes.values())
        self.assertEqual(total_dr, total_cr)

        loyalty_lines = [l for l in entry.lines.all()
                         if l.narration == 'Loyalty points redemption']
        self.assertEqual(len(loyalty_lines), 1)
        self.assertEqual(loyalty_lines[0].debit, Decimal('50.00'))


class PurchaseAdditionalDiscountTests(TestCase):
    """Header-level post-tax bill discount must reduce the supplier payable
    (booked to Discount Received) — previously AP was overstated by it."""

    def setUp(self):
        seed_chart_and_mappings()
        _seed_extra_accounts()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _po(self, *, po_id=951, addl=Decimal('100.00')):
        line = SimpleNamespace(
            product_id=11, quantity=100, free_qty=0,
            purchase_rate=Decimal('10.00'), discount_percent=Decimal('0'),
            cgst_amount=Decimal('0'), sgst_amount=Decimal('0'),
            igst_amount=Decimal('0'), tax_percent=Decimal('0'),
        )
        return SimpleNamespace(
            id=po_id, state='confirmed', transfer_kind='',
            supplier=SimpleNamespace(gst_no='27ABCDE1234A1Z5'),
            supplier_id=9, location_id=1,
            bill_date=date(2026, 5, 16), bill_no='PB-951',
            transport_cost=Decimal('0'), other_charges=Decimal('0'),
            additional_discount=addl,
            round_off=Decimal('0'), supply_type='intra_state',
            created_at=datetime(2026, 5, 16),
            lines=_Lines([line]),
        )

    def _generate(self, po):
        with patch('journals.services.PurchaseOrderRO') as MockPO:
            (MockPO.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = po
            return self.svc.generate_purchase(po.id)

    def test_additional_discount_reduces_payable(self):
        entry = self._generate(self._po())
        codes = {l.account.account_code: (l.debit, l.credit)
                 for l in entry.lines.all()}
        self.assertEqual(codes['1190'][0], Decimal('1000.00'))  # stock at gross
        self.assertEqual(codes['2110'][1], Decimal('900.00'))   # AP net of discount
        self.assertEqual(codes['5310'][1], Decimal('100.00'))   # discount received
        total_dr = sum(v[0] for v in codes.values())
        total_cr = sum(v[1] for v in codes.values())
        self.assertEqual(total_dr, total_cr)

    def test_without_discount_unchanged(self):
        entry = self._generate(self._po(po_id=952, addl=Decimal('0')))
        codes = {l.account.account_code: (l.debit, l.credit)
                 for l in entry.lines.all()}
        self.assertEqual(codes['2110'][1], Decimal('1000.00'))
        self.assertNotIn('5310', codes)


class FeeCollectionPostingTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        _seed_extra_accounts()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _fee(self, *, fee_id=931, status='Paid', mode='Cash'):
        return SimpleNamespace(
            id=fee_id, fee_id=f'FEE-{fee_id}', amount=Decimal('300.00'),
            payment_mode=mode, payment_status=status,
            receipt_number='RCP-1', location_id=1,
            collected_at=datetime(2026, 5, 14, 10, 0),
            created_at=datetime(2026, 5, 14, 10, 0),
        )

    def _generate(self, fee):
        with patch('journals.services.FeeCollectionRO') as MockRO:
            MockRO.objects.get.return_value = fee
            return self.svc.generate_fee_collection(fee.id)

    def test_paid_fee_posts_exempt_income(self):
        entry = self._generate(self._fee())
        self.assertIsNotNone(entry)
        codes = {l.account.account_code: (l.debit, l.credit)
                 for l in entry.lines.all()}
        self.assertEqual(codes['1110'], (Decimal('300.00'), Decimal('0')))
        self.assertEqual(codes['4320'], (Decimal('0'), Decimal('300.00')))
        # Exempt service — no output GST.
        for gst in ('2120', '2130', '2140'):
            self.assertNotIn(gst, codes)

    def test_upi_fee_lands_in_bank(self):
        entry = self._generate(self._fee(fee_id=932, mode='UPI'))
        codes = {l.account.account_code for l in entry.lines.all() if l.debit > 0}
        self.assertIn('1120', codes)

    def test_unpaid_fee_is_skipped(self):
        self.assertIsNone(self._generate(self._fee(fee_id=933, status='Pending')))
        self.assertIsNone(self._generate(self._fee(fee_id=934, status='Waived')))


class LooseSaleCOGSTests(TestCase):
    """Loose (tablet-level) sale lines carry the TABLET count in `quantity`;
    COGS must relieve stock in PACK equivalents (qty / qty_per_pack), not at
    the raw tablet count — that overstated COGS by the pack factor."""

    def setUp(self):
        seed_chart_and_mappings()
        _seed_extra_accounts()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def test_loose_line_relieves_pack_equivalent(self):
        from journals.models import JournalEntry

        entry = JournalEntry.objects.create(
            date=date(2026, 5, 20), voucher_type='SALE',
            reference_type='POSOrder', reference_id=961, location_id=1,
        )
        loose_line = SimpleNamespace(
            product_id=11, quantity=10, is_loose=True, qty_per_pack=15)

        # Pack cost ₹150 → 10 tablets = 2/3 pack → COGS ₹100 (not ₹1500).
        with patch.object(self.svc, '_product_avg_cost', return_value=Decimal('150.00')):
            total = self.svc._post_cogs(entry=entry, lines=[loose_line])
        self.assertEqual(total, Decimal('100.00'))

    def test_pack_line_unchanged(self):
        from journals.models import JournalEntry

        entry = JournalEntry.objects.create(
            date=date(2026, 5, 20), voucher_type='SALE',
            reference_type='POSOrder', reference_id=962, location_id=1,
        )
        pack_line = SimpleNamespace(
            product_id=11, quantity=10, is_loose=False, qty_per_pack=15)
        with patch.object(self.svc, '_product_avg_cost', return_value=Decimal('150.00')):
            total = self.svc._post_cogs(entry=entry, lines=[pack_line])
        self.assertEqual(total, Decimal('1500.00'))

    def test_line_without_loose_fields_unchanged(self):
        from journals.models import JournalEntry

        entry = JournalEntry.objects.create(
            date=date(2026, 5, 20), voucher_type='SALE',
            reference_type='SalesReturn', reference_id=963, location_id=1,
        )
        bare_line = SimpleNamespace(product_id=11, quantity=3)
        with patch.object(self.svc, '_product_avg_cost', return_value=Decimal('10.00')):
            total = self.svc._post_cogs(entry=entry, lines=[bare_line])
        self.assertEqual(total, Decimal('30.00'))


class WaivedFeeReversalTests(TestCase):
    """A Paid consultation fee that is later Waived must auto-reverse its
    income JE through reverse_cancelled()."""

    def setUp(self):
        seed_chart_and_mappings()
        _seed_extra_accounts()
        make_settings()

    def test_waived_fee_is_reversed(self):
        from journals.models import JournalEntry
        from sync.services import InventorySyncService

        svc = JournalAutoGenerationService()
        fee = SimpleNamespace(
            id=971, fee_id='FEE-971', amount=Decimal('300.00'),
            payment_mode='Cash', payment_status='Paid',
            receipt_number='', location_id=1,
            collected_at=datetime(2026, 5, 21, 10, 0),
            created_at=datetime(2026, 5, 21, 10, 0),
        )
        with patch('journals.services.FeeCollectionRO') as MockRO:
            MockRO.objects.get.return_value = fee
            original = svc.generate_fee_collection(fee.id)
        self.assertIsNotNone(original)

        sync = InventorySyncService()
        with patch('sync.services.PurchaseOrderRO') as MockPO, \
             patch('sync.services.POSOrderRO') as MockPOS, \
             patch('sync.services.B2BSalesOrderRO') as MockB2B, \
             patch('sync.services.SalesReturnRO') as MockRet, \
             patch('sync.services.PurchaseReturnRO') as MockPRet, \
             patch('sync.services.FeeCollectionRO') as MockFee:
            for m in (MockPO, MockPOS, MockB2B, MockRet, MockPRet):
                m.objects.filter.return_value.values_list.return_value = []
            MockFee.objects.filter.return_value.values_list.return_value = [971]
            reversed_count = sync.reverse_cancelled()

        self.assertEqual(reversed_count, 1)
        reversal = JournalEntry.objects.get(
            reference_type='FeeCollection', reference_id=971,
            reversal_of__isnull=False,
        )
        codes = {l.account.account_code: (l.debit, l.credit)
                 for l in reversal.lines.all()}
        self.assertEqual(codes['4320'], (Decimal('300.00'), Decimal('0')))
        self.assertEqual(codes['1110'], (Decimal('0'), Decimal('300.00')))

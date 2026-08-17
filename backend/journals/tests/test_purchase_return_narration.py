"""Purchase-return / reversal narration and money-base regressions.

Three separate defects live on the same pair of generators:
  * the debit note never named the supplier's bill, so a journal search for
    "INV-2233" (search matches entry_no + narration only) found the purchase
    but not the return that undid it;
  * the return's taxable base was recomputed as qty × rate, which ignores the
    trade discount and prices free goods, overstating what we claw back from
    the supplier;
  * reversal dates were truncated off a UTC-aware timestamp, dating every
    00:00–05:30 IST reversal one day early.
"""
from datetime import date, datetime, timezone as dt_timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from core.date_utils import as_local_date
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry
from journals.services import JournalAutoGenerationService

# Sentinel for "this attribute is absent entirely", which is what a dangling
# db_constraint=False FK leaves behind.
_MISSING = object()


def _line(quantity=10, rate='100.00', tax_percent='0', cgst='0', sgst='0', igst='0'):
    return SimpleNamespace(
        product_id=101, quantity=quantity, purchase_rate=Decimal(rate),
        tax_percent=Decimal(tax_percent), cgst_amount=Decimal(cgst),
        sgst_amount=Decimal(sgst), igst_amount=Decimal(igst),
    )


def _make_return(*, return_id=801, subtotal='0.00', lines=None,
                 original_purchase_order=..., return_date=date(2026, 5, 4),
                 supplier_gstin='27ABCDE1234A1Z5', location_id=1):
    """Build a PurchaseReturnRO stand-in.

    `original_purchase_order` defaults to a PO carrying bill INV-2233; pass
    None for a return that was never linked to a bill, and pass the sentinel
    `_MISSING` to drop the attribute entirely (what a dangling, unconstrained
    FK looks like to a defensive getattr).
    """
    if lines is None:
        lines = [_line()]

    class _Lines:
        def all(self):
            return lines

    fields = dict(
        id=return_id, status='confirmed',
        return_no='PRET-20260504120000123456',
        supplier=SimpleNamespace(gst_no=supplier_gstin), supplier_id=9,
        location_id=location_id, return_date=return_date,
        subtotal=Decimal(subtotal), round_off=Decimal('12.34'),
        lines=_Lines(),
    )
    if original_purchase_order is ...:
        original_purchase_order = SimpleNamespace(id=601, bill_no='INV-2233')
    if original_purchase_order is not _MISSING:
        fields['original_purchase_order'] = original_purchase_order
    return SimpleNamespace(**fields)


class _StubbedROMixin:
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()
        # The accounting test DB has none of pharmacy's managed=False RO tables
        # that the supply-type resolver and party-ledger lookup read.
        for target, kw in (
            ('_get_supply_type', {'return_value': 'intra_state'}),
            ('_party_account', {
                'side_effect': lambda party_type, party_id, fallback, location_id=None: fallback,
            }),
        ):
            p = patch.object(JournalAutoGenerationService, target, **kw)
            p.start()
            self.addCleanup(p.stop)

    def _gen_return(self, ret):
        with patch('journals.services.PurchaseReturnRO') as MockRet:
            (MockRet.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = ret
            return self.svc.generate_purchase_return(ret.id)

    def _gen_reversal(self, rev):
        with patch('journals.services.PurchaseReversalRO') as MockRev:
            (MockRev.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = rev
            return self.svc.generate_purchase_reversal(rev.id)


class PurchaseReturnNarrationTests(_StubbedROMixin, TestCase):
    def test_bill_number_leads_the_narration(self):
        ret = _make_return()
        entry = self._gen_return(ret)
        self.assertIsNotNone(entry)
        self.assertEqual(
            entry.narration,
            'Purchase Return against Bill INV-2233: '
            'PRET-20260504120000123456 to Supplier ID 9',
        )

    def test_narration_is_searchable_by_bill_number(self):
        # The journal list search matches entry_no + narration only; this is
        # the whole point of the change.
        self._gen_return(_make_return())
        self.assertEqual(
            JournalEntry.objects.filter(narration__icontains='INV-2233').count(), 1)

    def test_unlinked_return_falls_back_to_the_old_narration(self):
        entry = self._gen_return(
            _make_return(return_id=802, original_purchase_order=None))
        self.assertEqual(
            entry.narration,
            'Purchase Return: PRET-20260504120000123456 to Supplier ID 9')

    def test_blank_bill_no_falls_back_to_the_old_narration(self):
        entry = self._gen_return(_make_return(
            return_id=803,
            original_purchase_order=SimpleNamespace(id=601, bill_no='')))
        self.assertEqual(
            entry.narration,
            'Purchase Return: PRET-20260504120000123456 to Supplier ID 9')

    def test_dangling_fk_does_not_break_posting(self):
        # db_constraint=False means the joined row can simply not be there.
        entry = self._gen_return(
            _make_return(return_id=804, original_purchase_order=_MISSING))
        self.assertIsNotNone(entry)
        self.assertTrue(entry.is_posted)
        self.assertEqual(
            entry.narration,
            'Purchase Return: PRET-20260504120000123456 to Supplier ID 9')


class PurchaseReturnTaxableBaseTests(_StubbedROMixin, TestCase):
    def test_header_subtotal_wins_over_qty_times_rate(self):
        # 12 strips returned, 2 of them free goods, 10% trade discount:
        # qty × rate = 1200.00, but the pharmacy's own base is 10 × 100 × 0.9.
        ret = _make_return(subtotal='900.00', lines=[_line(quantity=12, rate='100.00')])
        entry = self._gen_return(ret)
        stock_line = entry.lines.get(account__account_code='1190')
        self.assertEqual(stock_line.credit, Decimal('900.00'))
        payable_line = entry.lines.get(account__account_code='2110')
        self.assertEqual(payable_line.debit, Decimal('900.00'))

    def test_round_off_is_not_folded_into_the_base(self):
        # round_off is excluded from the pharmacy's own total_amount; adding it
        # here would swap one mismatch for another.
        entry = self._gen_return(_make_return(
            return_id=812, subtotal='900.00',
            lines=[_line(quantity=12, rate='100.00')]))
        self.assertEqual(
            entry.lines.get(account__account_code='1190').credit, Decimal('900.00'))

    def test_tax_from_lines_is_split_on_the_authoritative_base(self):
        ret = _make_return(
            return_id=813, subtotal='900.00',
            lines=[_line(quantity=12, rate='100.00', tax_percent='12',
                         cgst='54.00', sgst='54.00')])
        entry = self._gen_return(ret)
        self.assertEqual(
            entry.lines.get(account__account_code='1140').credit, Decimal('54.00'))
        self.assertEqual(
            entry.lines.get(account__account_code='1150').credit, Decimal('54.00'))
        self.assertEqual(
            entry.lines.get(account__account_code='2110').debit, Decimal('1008.00'))

    def test_derived_tax_tracks_the_discounted_base(self):
        # Source carried no tax split at all → we derive it, and it must be
        # charged on 900.00, not on the 1200.00 pre-discount value.
        ret = _make_return(
            return_id=814, subtotal='900.00',
            lines=[_line(quantity=12, rate='100.00', tax_percent='12')])
        entry = self._gen_return(ret)
        self.assertEqual(
            entry.lines.get(account__account_code='1140').credit, Decimal('54.00'))
        self.assertEqual(
            entry.lines.get(account__account_code='1150').credit, Decimal('54.00'))

    def test_missing_subtotal_still_falls_back_to_per_line(self):
        # Legacy rows never had subtotal written; they must keep posting.
        ret = _make_return(
            return_id=815, subtotal='0.00', lines=[_line(quantity=12, rate='100.00')])
        entry = self._gen_return(ret)
        self.assertEqual(
            entry.lines.get(account__account_code='1190').credit, Decimal('1200.00'))

    def test_entry_balances(self):
        entry = self._gen_return(_make_return(
            return_id=816, subtotal='900.00',
            lines=[_line(quantity=12, rate='100.00', tax_percent='12',
                         cgst='54.00', sgst='54.00')]))
        lines = list(entry.lines.all())
        self.assertEqual(sum(l.debit for l in lines), sum(l.credit for l in lines))


class LocalDateBoundaryTests(_StubbedROMixin, TestCase):
    # 2026-08-17 22:00 UTC is already 2026-08-18 03:30 in Asia/Kolkata.
    UTC_INSTANT = datetime(2026, 8, 17, 22, 0, tzinfo=dt_timezone.utc)

    def test_as_local_date_shifts_across_the_ist_boundary(self):
        self.assertEqual(self.UTC_INSTANT.date(), date(2026, 8, 17))   # the bug
        self.assertEqual(as_local_date(self.UTC_INSTANT), date(2026, 8, 18))

    def test_as_local_date_passes_dates_through(self):
        self.assertEqual(as_local_date(date(2026, 8, 17)), date(2026, 8, 17))
        self.assertIsNone(as_local_date(None))

    def test_as_local_date_leaves_naive_datetimes_alone(self):
        # Nothing to convert without an offset — truncate and move on.
        self.assertEqual(
            as_local_date(datetime(2026, 8, 17, 22, 0)), date(2026, 8, 17))

    def test_reversal_is_dated_in_ist(self):
        rev = SimpleNamespace(
            id=901, status='confirmed', reversal_type='partial',
            reversal_no='PREV-9', reversal_date=self.UTC_INSTANT,
            original_purchase_order_id=601,
            original_purchase_order=SimpleNamespace(id=601, bill_no='INV-2233'),
            supplier=SimpleNamespace(gst_no='27ABCDE1234A1Z5'), supplier_id=9,
            location_id=1,
            lines=SimpleNamespace(all=lambda: [SimpleNamespace(
                taxable_amount=Decimal('500.00'), cgst_amount=Decimal('0'),
                sgst_amount=Decimal('0'), igst_amount=Decimal('0'),
                tax_percent=Decimal('0'))]),
        )
        entry = self._gen_reversal(rev)
        self.assertIsNotNone(entry)
        self.assertEqual(entry.date, date(2026, 8, 18))
        self.assertIn('against Bill INV-2233', entry.narration)

    def test_return_date_is_unchanged_for_plain_dates(self):
        entry = self._gen_return(_make_return(
            return_id=902, subtotal='900.00', return_date=date(2026, 5, 4)))
        self.assertEqual(entry.date, date(2026, 5, 4))

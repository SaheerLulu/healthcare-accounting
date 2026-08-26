"""B2B invoice-amendment sync: an already-issued tax invoice that an admin
corrected in pharmacy (B2BSalesOrderEdit) must get its stale sales JE swapped —
a balanced reversal carrying the edit reference as the processed marker — and a
fresh JE regenerated from the order's corrected values.

The invoice keeps its number through an amendment, so the stale entry stays live
under `reference_type='B2BSalesOrder'` and `sync_b2b` will never revisit it: it
skips anything already synced. Without this pass the stock and the invoice move
while the books stay on the original figures.

JEs that already reflect the corrected values (posted after the amendment was
applied, or not posted at all) must be left alone.
"""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine
from sync.services import AUTO_GEN_REF_TYPES, InventorySyncService
from sync.models import SyncError


def _posted_b2b_je(order_id, amount=Decimal('1120'), location_id=1):
    receivable = ChartOfAccount.objects.get(account_code='1110')
    sales = ChartOfAccount.objects.get(account_code='4100')
    e = JournalEntry.objects.create(
        date=date(2026, 8, 1), narration=f'Tax Invoice: MAIN2526A0{order_id}',
        voucher_type='SALES', reference_type='B2BSalesOrder',
        reference_id=order_id, location_id=location_id,
    )
    JournalEntryLine.objects.create(entry=e, account=receivable, debit=amount)
    JournalEntryLine.objects.create(entry=e, account=sales, credit=amount)
    e.post()
    return e


class _FakeEditQS:
    """Duck-typed stand-in for B2BSalesOrderEditRO.objects honouring the
    exclude/select_related/order_by chain the sync step uses — the exclude
    really applies the anti-join, so idempotency is exercised rather than
    assumed."""

    def __init__(self, rows):
        self.rows = list(rows)

    def exclude(self, **kw):
        excluded = kw.get('id__in')
        done = set()
        if excluded is not None:
            for v in excluded:
                done.add(v['reference_id'] if isinstance(v, dict) else v)
        return _FakeEditQS(r for r in self.rows if r.id not in done)

    def select_related(self, *args):
        return self

    def order_by(self, *args):
        return _FakeEditQS(sorted(self.rows, key=lambda r: r.id))

    def __iter__(self):
        return iter(self.rows)


def _fake_model(rows):
    return SimpleNamespace(objects=_FakeEditQS(rows))


def _backdate(entry, minutes):
    """Push a posted entry's `created_at` into the past. `auto_now_add` means
    it can only be moved with an UPDATE, and the guard this suite exercises is
    a comparison against exactly that column."""
    JournalEntry.objects.filter(pk=entry.pk).update(
        created_at=timezone.now() - timedelta(minutes=minutes),
    )
    entry.refresh_from_db()
    return entry


def _edit(edit_id, order_id, *, applied_delta_minutes=5, status='confirmed',
          source_indent_id=None):
    """One amendment row. `applied_delta_minutes` is relative to now, i.e.
    positive = the correction landed AFTER the JE under test was posted."""
    return SimpleNamespace(
        id=edit_id,
        sales_order_id=order_id,
        reason='Customer short-shipped 6 boxes',
        created_at=timezone.now() + timedelta(minutes=applied_delta_minutes),
        sales_order=SimpleNamespace(
            id=order_id, status=status, source_indent_id=source_indent_id,
        ),
    )


class B2BAmendmentSyncTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = InventorySyncService()

    def _run(self, edits, regen_result='fresh'):
        """Run sync_b2b_amendments against stub edits; the regenerated JE is a
        real posted entry unless regen_result is None."""
        def _regen(order_id, force=False):
            self.assertTrue(force)
            if regen_result is None:
                return None
            return _posted_b2b_je(order_id, amount=Decimal('448'))

        with patch('sync.services.B2BSalesOrderEditRO', _fake_model(edits)), \
             patch.object(self.svc.journal_service, 'generate_b2b_sale',
                          side_effect=_regen) as regen:
            count = self.svc.sync_b2b_amendments()
        return count, regen

    def test_stale_je_swapped_and_reposted(self):
        live = _posted_b2b_je(42)
        count, regen = self._run([_edit(7, 42)])

        self.assertEqual(count, 1)
        regen.assert_called_once_with(42, force=True)

        swap = JournalEntry.objects.get(reference_type='B2BSalesOrderEdit')
        self.assertEqual(swap.reference_id, 7)
        self.assertEqual(swap.reversal_of_id, live.id)
        self.assertTrue(swap.is_posted)
        # Debits and credits mirrored — the reversal nets the original to zero.
        live_line = live.lines.get(debit__gt=0)
        self.assertTrue(
            swap.lines.filter(account=live_line.account,
                              credit=live_line.debit).exists()
        )
        # Original marked reversed; the corrected entry is now the live one.
        self.assertTrue(JournalEntry.objects.filter(reversal_of=live).exists())
        fresh = (JournalEntry.objects
                 .filter(reference_type='B2BSalesOrder', reference_id=42,
                         reversal_of__isnull=True, reversal_entry__isnull=True)
                 .get())
        self.assertNotEqual(fresh.id, live.id)
        self.assertEqual(fresh.lines.get(debit__gt=0).debit, Decimal('448'))

    def test_the_reversal_names_the_invoice_it_cancels(self):
        # The regeneration immediately re-posts a second full-value entry for
        # the same invoice number; without the number on the reversal a ledger
        # search returns two sales with nothing visible netting them.
        live = _posted_b2b_je(42)
        self._run([_edit(7, 42)])
        swap = JournalEntry.objects.get(reference_type='B2BSalesOrderEdit')
        self.assertIn('MAIN2526A042', swap.narration)
        self.assertIn(live.entry_no, swap.narration)

    def test_a_blank_live_narration_leaves_no_dangling_separator(self):
        live = _posted_b2b_je(43)
        JournalEntry.objects.filter(pk=live.pk).update(narration='')
        live.refresh_from_db()
        self._run([_edit(9, 43)])
        swap = JournalEntry.objects.get(reference_type='B2BSalesOrderEdit')
        self.assertTrue(swap.narration.endswith('correction)'), swap.narration)

    def test_second_run_is_noop(self):
        _posted_b2b_je(42)
        edits = [_edit(7, 42)]
        count1, _ = self._run(edits)
        count2, regen2 = self._run(edits)
        self.assertEqual((count1, count2), (1, 0))
        regen2.assert_not_called()
        self.assertEqual(
            JournalEntry.objects.filter(reference_type='B2BSalesOrderEdit').count(), 1,
        )

    def test_je_posted_after_the_amendment_is_left_alone(self):
        _posted_b2b_je(42)  # created NOW
        # Correction applied an hour BEFORE the JE existed → sync_b2b already
        # posted the corrected values; there is nothing stale to swap.
        count, regen = self._run([_edit(7, 42, applied_delta_minutes=-60)])
        self.assertEqual(count, 0)
        regen.assert_not_called()
        self.assertFalse(
            JournalEntry.objects.filter(reference_type='B2BSalesOrderEdit').exists()
        )

    def test_no_live_je_skips(self):
        # The sale has not synced yet — sync_b2b will post the corrected values
        # itself on this same run.
        count, regen = self._run([_edit(7, 42)])
        self.assertEqual(count, 0)
        regen.assert_not_called()

    def test_a_cancelled_invoice_is_left_to_reverse_cancelled(self):
        _posted_b2b_je(42)
        count, regen = self._run([_edit(7, 42, status='cancelled')])
        self.assertEqual(count, 0)
        regen.assert_not_called()
        # Correcting it here would leave the books carrying a sale that no
        # longer exists.
        self.assertFalse(
            JournalEntry.objects.filter(reference_type='B2BSalesOrderEdit').exists()
        )

    def test_an_inter_store_transfer_leg_is_skipped(self):
        # Indent-origin "sales" never posted revenue to begin with.
        _posted_b2b_je(42)
        count, regen = self._run([_edit(7, 42, source_indent_id=3)])
        self.assertEqual(count, 0)
        regen.assert_not_called()

    def test_failed_regeneration_rolls_back_the_swap(self):
        live = _posted_b2b_je(42)
        count, _ = self._run([_edit(7, 42)], regen_result=None)
        self.assertEqual(count, 0)
        # A reversed sale must never be left without its replacement.
        self.assertFalse(
            JournalEntry.objects.filter(reference_type='B2BSalesOrderEdit').exists()
        )
        self.assertFalse(JournalEntry.objects.filter(reversal_of=live).exists())
        self.assertTrue(SyncError.objects.filter(
            sync_type='b2b_amendment', source_id=7, resolved=False,
        ).exists())

    def test_a_second_amendment_needs_no_further_swap(self):
        # Real ordering, spelled out: the invoice posted an hour ago, then two
        # corrections landed. (The other tests use the shorthand of a
        # future-dated edit against a just-created JE, which exercises the same
        # branch; here the timestamps have to be genuine for the SECOND
        # amendment's guard to mean anything.)
        _backdate(_posted_b2b_je(42), minutes=60)
        first = _edit(7, 42, applied_delta_minutes=-30)
        second = _edit(8, 42, applied_delta_minutes=-10)

        count, regen = self._run([first, second])

        # #1 swaps. What it regenerates is built from the order's CURRENT
        # values — which already include #2 — so #2 has nothing stale left to
        # correct and must not reverse a freshly-correct entry.
        self.assertEqual(count, 1)
        regen.assert_called_once_with(42, force=True)
        self.assertEqual(
            JournalEntry.objects.filter(reference_type='B2BSalesOrderEdit').count(), 1,
        )

    def test_missing_source_table_is_survivable(self):
        # Accounting can deploy ahead of pharmacy, before the edit table exists.
        broken = SimpleNamespace(objects=SimpleNamespace(
            exclude=lambda **kw: (_ for _ in ()).throw(Exception('no such table')),
        ))
        with patch('sync.services.B2BSalesOrderEditRO', broken):
            self.assertEqual(self.svc.sync_b2b_amendments(), 0)

    def test_edit_marker_is_wiped_by_a_full_resync(self):
        # Otherwise a resync deletes the sales JEs and leaves orphaned
        # reversal pairs pointing at nothing.
        self.assertIn('B2BSalesOrderEdit', AUTO_GEN_REF_TYPES)
        from sync.management.commands.regenerate_synced_jes import AUTO_REFERENCE_TYPES
        self.assertIn('B2BSalesOrderEdit', AUTO_REFERENCE_TYPES)

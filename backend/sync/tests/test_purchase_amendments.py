"""Purchase-amendment sync: a confirmed purchase that was edited and
re-approved (pharmacy PurchaseAmendment, status='applied') must get its stale
purchase JE swapped — balanced reversal carrying the amendment reference as
the processed marker — and a fresh JE regenerated from the corrected values.
JEs already reflecting the corrected values (posted after the amendment was
approved, or not posted yet) must be left alone."""
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


def _posted_purchase_je(po_id, amount=Decimal('100'), location_id=1):
    cash = ChartOfAccount.objects.get(account_code='1110')
    sales = ChartOfAccount.objects.get(account_code='4100')
    e = JournalEntry.objects.create(
        date=date(2026, 7, 1), narration=f'purchase {po_id}',
        voucher_type='PURCHASE', reference_type='PurchaseOrder',
        reference_id=po_id, location_id=location_id,
    )
    JournalEntryLine.objects.create(entry=e, account=cash, debit=amount)
    JournalEntryLine.objects.create(entry=e, account=sales, credit=amount)
    e.post()
    return e


class _FakeAmendmentQS:
    """Duck-typed stand-in for PurchaseAmendmentRO.objects that honours the
    filter/exclude/select_related/order_by chain the sync step uses — the
    exclude actually applies the anti-join so idempotency is exercised."""

    def __init__(self, rows):
        self.rows = list(rows)

    def filter(self, **kw):
        status = kw.get('status')
        return _FakeAmendmentQS(
            r for r in self.rows if status is None or r.status == status
        )

    def exclude(self, **kw):
        excluded = kw.get('id__in')
        done = set()
        if excluded is not None:
            for v in excluded:
                done.add(v['reference_id'] if isinstance(v, dict) else v)
        return _FakeAmendmentQS(r for r in self.rows if r.id not in done)

    def select_related(self, *args):
        return self

    def order_by(self, *args):
        return _FakeAmendmentQS(sorted(self.rows, key=lambda r: r.id))

    def __iter__(self):
        return iter(self.rows)


def _fake_model(rows):
    return SimpleNamespace(objects=_FakeAmendmentQS(rows))


def _amendment(am_id, po_id, *, approved_delta_minutes=5, state='confirmed',
               status='applied'):
    return SimpleNamespace(
        id=am_id,
        purchase_order_id=po_id,
        status=status,
        approved_at=timezone.now() + timedelta(minutes=approved_delta_minutes),
        purchase_order=SimpleNamespace(state=state),
    )


class PurchaseAmendmentSyncTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = InventorySyncService()

    def _run(self, amendments, regen_result='fresh'):
        """Run sync_purchase_amendments against stub amendments; the
        regenerated JE is a real posted entry unless regen_result is None."""
        def _regen(po_id, force=False):
            self.assertTrue(force)
            if regen_result is None:
                return None
            return _posted_purchase_je(po_id, amount=Decimal('77'))

        with patch('sync.services.PurchaseAmendmentRO', _fake_model(amendments)), \
             patch.object(self.svc.journal_service, 'generate_purchase',
                          side_effect=_regen) as regen:
            count = self.svc.sync_purchase_amendments()
        return count, regen

    def test_stale_je_swapped_and_reposted(self):
        live = _posted_purchase_je(42)
        count, regen = self._run([_amendment(7, 42)])

        self.assertEqual(count, 1)
        regen.assert_called_once_with(42, force=True)

        swap = JournalEntry.objects.get(reference_type='PurchaseAmendment')
        self.assertEqual(swap.reference_id, 7)
        self.assertEqual(swap.reversal_of_id, live.id)
        self.assertTrue(swap.is_posted)
        # Debits and credits mirrored.
        live_line = live.lines.get(debit__gt=0)
        self.assertTrue(
            swap.lines.filter(account=live_line.account,
                              credit=live_line.debit).exists()
        )
        # The original is now marked reversed; the fresh JE is the live one.
        self.assertTrue(JournalEntry.objects.filter(reversal_of=live).exists())
        fresh = (JournalEntry.objects
                 .filter(reference_type='PurchaseOrder', reference_id=42,
                         reversal_of__isnull=True, reversal_entry__isnull=True)
                 .get())
        self.assertNotEqual(fresh.id, live.id)

    def test_second_run_is_noop(self):
        _posted_purchase_je(42)
        amendments = [_amendment(7, 42)]
        count1, _ = self._run(amendments)
        count2, regen2 = self._run(amendments)
        self.assertEqual((count1, count2), (1, 0))
        regen2.assert_not_called()
        self.assertEqual(
            JournalEntry.objects.filter(reference_type='PurchaseAmendment').count(), 1,
        )

    def test_je_created_after_amendment_is_left_alone(self):
        _posted_purchase_je(42)  # created NOW
        # Amendment approved an hour BEFORE the JE existed → the JE was built
        # from the corrected values already; nothing stale to swap.
        count, regen = self._run([_amendment(7, 42, approved_delta_minutes=-60)])
        self.assertEqual(count, 0)
        regen.assert_not_called()
        self.assertFalse(
            JournalEntry.objects.filter(reference_type='PurchaseAmendment').exists()
        )

    def test_no_live_je_skips(self):
        count, regen = self._run([_amendment(7, 42)])
        self.assertEqual(count, 0)
        regen.assert_not_called()

    def test_po_back_in_approval_defers(self):
        _posted_purchase_je(42)
        count, regen = self._run([_amendment(7, 42, state='pending_approval')])
        self.assertEqual(count, 0)
        regen.assert_not_called()

    def test_failed_regeneration_rolls_back_swap(self):
        live = _posted_purchase_je(42)
        count, _ = self._run([_amendment(7, 42)], regen_result=None)
        self.assertEqual(count, 0)
        # The swap must not survive without its replacement.
        self.assertFalse(
            JournalEntry.objects.filter(reference_type='PurchaseAmendment').exists()
        )
        self.assertFalse(JournalEntry.objects.filter(reversal_of=live).exists())
        self.assertTrue(SyncError.objects.filter(
            sync_type='purchase_amendment', source_id=7, resolved=False,
        ).exists())

    def test_amendment_in_auto_gen_ref_types(self):
        self.assertIn('PurchaseAmendment', AUTO_GEN_REF_TYPES)

import contextlib
import logging
import time
import traceback
from decimal import Decimal
from django.db import transaction, connection
from inventory_reader.models import (
    PurchaseOrderRO, POSOrderRO, B2BSalesOrderRO, SalesReturnRO, PurchaseReturnRO,
    OpeningStockRO,
)
from journals.models import JournalEntry
from journals.services import JournalAutoGenerationService
from .models import SyncLog, SyncError

logger = logging.getLogger('sync')


# A fixed 63-bit key for the sync advisory lock. The UI SyncRunView and the
# scheduled management command BOTH call sync_all(); this single lock serialises
# them so the read-then-create idempotency check (`_synced_ids` → create) can't
# race and double-post every order in the overlap window. Postgres-only — a
# harmless no-op on other backends (e.g. SQLite under test), where there is no
# second concurrent connection to race against anyway.
_SYNC_ADVISORY_LOCK_KEY = 478223197


@contextlib.contextmanager
def sync_advisory_lock():
    """Yield True if this process holds the exclusive sync lock (or the backend
    isn't Postgres), False if another run already holds it."""
    if connection.vendor != 'postgresql':
        yield True
        return
    with connection.cursor() as cur:
        cur.execute('SELECT pg_try_advisory_lock(%s)', [_SYNC_ADVISORY_LOCK_KEY])
        acquired = bool(cur.fetchone()[0])
    try:
        yield acquired
    finally:
        if acquired:
            with connection.cursor() as cur:
                cur.execute('SELECT pg_advisory_unlock(%s)', [_SYNC_ADVISORY_LOCK_KEY])


# Inventory statuses that mean an order was voided/cancelled AFTER we may have
# already posted its JE. Conservative, explicit list — a status not in here is
# left untouched, so an ordinary state transition can never trigger a wrong
# reversal (worst case we miss a cancellation, which is safe).
CANCELLED_STATES = ('cancelled', 'canceled', 'void', 'voided', 'returned')


class InventorySyncService:

    def __init__(self):
        self.journal_service = JournalAutoGenerationService()

    def _record_metrics(self, sync_type: str, started_at: float, errors_before: int):
        """Patch duration + error_count onto the SyncLog just written by a
        sync_X method. Decoupled so we only have to touch each sync_X with a
        single extra line at the end."""
        errors_after = SyncError.objects.filter(
            sync_type=sync_type, resolved=False,
        ).count()
        duration = Decimal(str(round(time.monotonic() - started_at, 2)))
        SyncLog.objects.filter(sync_type=sync_type).update(
            duration_seconds=duration,
            error_count=max(0, errors_after - errors_before),
        )

    def _synced_ids(self, reference_type: str) -> set:
        """All inventory ids already represented by a JournalEntry for this ref type.
        Used to make sync self-healing — any record the cursor skipped (e.g.,
        cursor advanced past max while a lower-id record arrived later) gets
        picked up on the next run regardless of the cursor.
        """
        return set(
            JournalEntry.objects
            .filter(reference_type=reference_type)
            .values_list('reference_id', flat=True)
        )

    def _log_error(self, sync_type, source_id, error):
        """Log error to SyncError model instead of printing."""
        tb = traceback.format_exc()
        logger.error("Error syncing %s %s: %s", sync_type, source_id, error, exc_info=True)

        sync_error, created = SyncError.objects.get_or_create(
            sync_type=sync_type,
            source_id=source_id,
            resolved=False,
            defaults={
                'error_message': str(error),
                'traceback': tb,
            }
        )
        if not created:
            sync_error.retry_count += 1
            sync_error.error_message = str(error)
            sync_error.traceback = tb
            sync_error.save()

    def _resolve_error(self, sync_type, source_id):
        """Mark any existing unresolved error as resolved after successful sync."""
        SyncError.objects.filter(
            sync_type=sync_type,
            source_id=source_id,
            resolved=False,
        ).update(resolved=True)

    def sync_purchases(self, since_id: int = 0) -> int:
        started = time.monotonic()
        errors_before = SyncError.objects.filter(sync_type='purchase', resolved=False).count()
        already_synced = self._synced_ids('PurchaseOrder')
        orders = PurchaseOrderRO.objects.filter(
            state__in=['confirmed', 'done', 'approved'],
        ).exclude(id__in=already_synced).order_by('id')

        count = 0
        last_id = since_id
        for po in orders:
            try:
                entry = self.journal_service.generate_purchase(po.id)
                if entry:
                    count += 1
                self._resolve_error('purchase', po.id)
                last_id = max(last_id, po.id)
            except Exception as e:
                self._log_error('purchase', po.id, e)

        SyncLog.objects.update_or_create(
            sync_type='purchase',
            defaults={'last_synced_id': last_id, 'records_processed': count}
        )
        self._record_metrics('purchase', started, errors_before)
        return count

    def sync_pos(self, since_id: int = 0) -> int:
        started = time.monotonic()
        errors_before = SyncError.objects.filter(sync_type='pos', resolved=False).count()
        already_synced = self._synced_ids('POSOrder')
        orders = POSOrderRO.objects.filter(
            status__in=['confirmed', 'completed'],
        ).exclude(id__in=already_synced).order_by('id')

        count = 0
        last_id = since_id
        for pos in orders:
            try:
                entry = self.journal_service.generate_pos_sale(pos.id)
                if entry:
                    count += 1
                self._resolve_error('pos', pos.id)
                last_id = max(last_id, pos.id)
            except Exception as e:
                self._log_error('pos', pos.id, e)

        SyncLog.objects.update_or_create(
            sync_type='pos',
            defaults={'last_synced_id': last_id, 'records_processed': count}
        )
        self._record_metrics('pos', started, errors_before)
        return count

    def sync_b2b(self, since_id: int = 0) -> int:
        started = time.monotonic()
        errors_before = SyncError.objects.filter(sync_type='b2b', resolved=False).count()
        already_synced = self._synced_ids('B2BSalesOrder')
        orders = B2BSalesOrderRO.objects.filter(
            status__in=['confirmed', 'delivered', 'invoiced'],
        ).exclude(id__in=already_synced).order_by('id')

        count = 0
        last_id = since_id
        for order in orders:
            try:
                entry = self.journal_service.generate_b2b_sale(order.id)
                if entry:
                    count += 1
                self._resolve_error('b2b', order.id)
                last_id = max(last_id, order.id)
            except Exception as e:
                self._log_error('b2b', order.id, e)

        SyncLog.objects.update_or_create(
            sync_type='b2b',
            defaults={'last_synced_id': last_id, 'records_processed': count}
        )
        self._record_metrics('b2b', started, errors_before)
        return count

    def sync_returns(self, since_id: int = 0) -> int:
        started = time.monotonic()
        errors_before = SyncError.objects.filter(sync_type='return', resolved=False).count()
        already_synced = self._synced_ids('SalesReturn')
        returns = SalesReturnRO.objects.filter(
            status__in=['confirmed', 'completed'],
        ).exclude(id__in=already_synced).order_by('id')

        count = 0
        last_id = since_id
        for ret in returns:
            try:
                entry = self.journal_service.generate_sales_return(ret.id)
                if entry:
                    count += 1
                self._resolve_error('return', ret.id)
                last_id = max(last_id, ret.id)
            except Exception as e:
                self._log_error('return', ret.id, e)

        SyncLog.objects.update_or_create(
            sync_type='return',
            defaults={'last_synced_id': last_id, 'records_processed': count}
        )
        self._record_metrics('return', started, errors_before)
        return count

    def sync_opening_stocks(self, since_id: int = 0) -> int:
        """Convert inventory-side OpeningStock batches into the matching JV.

        Runs first in sync_all() so the books reflect on-hand inventory before
        any subsequent purchase/sale JV references the stock account.
        """
        started = time.monotonic()
        errors_before = SyncError.objects.filter(sync_type='opening_stock', resolved=False).count()
        already_synced = self._synced_ids('OpeningStock')
        batches = OpeningStockRO.objects.exclude(id__in=already_synced).order_by('id')

        count = 0
        last_id = since_id
        for os_header in batches:
            try:
                entry = self.journal_service.generate_opening_stock(os_header.id)
                if entry:
                    count += 1
                self._resolve_error('opening_stock', os_header.id)
                last_id = max(last_id, os_header.id)
            except Exception as e:
                self._log_error('opening_stock', os_header.id, e)

        SyncLog.objects.update_or_create(
            sync_type='opening_stock',
            defaults={'last_synced_id': last_id, 'records_processed': count}
        )
        self._record_metrics('opening_stock', started, errors_before)
        return count

    def sync_purchase_returns(self, since_id: int = 0) -> int:
        """Sync purchase returns from inventory system (Phase 4A)."""
        started = time.monotonic()
        errors_before = SyncError.objects.filter(sync_type='purchase_return', resolved=False).count()
        already_synced = self._synced_ids('PurchaseReturn')
        returns = PurchaseReturnRO.objects.filter(
            status__in=['confirmed', 'completed', 'approved'],
        ).exclude(id__in=already_synced).order_by('id')

        count = 0
        last_id = since_id
        for ret in returns:
            try:
                entry = self.journal_service.generate_purchase_return(ret.id)
                if entry:
                    count += 1
                self._resolve_error('purchase_return', ret.id)
                last_id = max(last_id, ret.id)
            except Exception as e:
                self._log_error('purchase_return', ret.id, e)

        SyncLog.objects.update_or_create(
            sync_type='purchase_return',
            defaults={'last_synced_id': last_id, 'records_processed': count}
        )
        self._record_metrics('purchase_return', started, errors_before)
        return count

    def retry_failed(self):
        """Retry all unresolved sync errors."""
        errors = SyncError.objects.filter(resolved=False)
        results = {'retried': 0, 'resolved': 0, 'failed': 0}

        for error in errors:
            try:
                if error.sync_type == 'opening_stock':
                    self.journal_service.generate_opening_stock(error.source_id)
                elif error.sync_type == 'purchase':
                    self.journal_service.generate_purchase(error.source_id)
                elif error.sync_type == 'pos':
                    self.journal_service.generate_pos_sale(error.source_id)
                elif error.sync_type == 'b2b':
                    self.journal_service.generate_b2b_sale(error.source_id)
                elif error.sync_type == 'return':
                    self.journal_service.generate_sales_return(error.source_id)
                elif error.sync_type == 'purchase_return':
                    self.journal_service.generate_purchase_return(error.source_id)
                else:
                    continue

                error.resolved = True
                error.save()
                results['resolved'] += 1
            except Exception as e:
                error.retry_count += 1
                error.error_message = str(e)
                error.traceback = traceback.format_exc()
                error.save()
                results['failed'] += 1

            results['retried'] += 1

        return results

    def _reverse_entry(self, original: JournalEntry) -> JournalEntry:
        """Post a balanced reversal of `original` (debits/credits swapped),
        linked via reversal_of so it can never be reversed twice. The swap also
        backs out the COGS / stock-relief legs automatically."""
        from datetime import date as date_cls
        from journals.models import JournalEntryLine
        with transaction.atomic():
            reversal = JournalEntry.objects.create(
                date=date_cls.today(),
                narration=f'Auto-reversal — {original.reference_type} '
                          f'#{original.reference_id} cancelled upstream '
                          f'(reverses {original.entry_no})',
                voucher_type=original.voucher_type,
                reference_type=original.reference_type,
                reference_id=original.reference_id,
                location_id=original.location_id,
                reversal_of=original,
            )
            for line in original.lines.all():
                JournalEntryLine.objects.create(
                    entry=reversal, account=line.account,
                    debit=line.credit, credit=line.debit,
                    narration=line.narration,
                    party_type=line.party_type, party_id=line.party_id,
                )
            reversal.post()
        return reversal

    def reverse_cancelled(self) -> int:
        """Reverse the JE of any previously-synced order whose source document is
        now cancelled/voided upstream, so the books stop carrying a sale or
        purchase that no longer exists. Idempotent: skips reversal entries and
        any original already reversed (reverse-once)."""
        # Built at call time (not as a class attr) so the model names resolve to
        # the current module globals — and stay patchable in tests.
        specs = (
            ('PurchaseOrder', PurchaseOrderRO, 'state'),
            ('POSOrder', POSOrderRO, 'status'),
            ('B2BSalesOrder', B2BSalesOrderRO, 'status'),
            ('SalesReturn', SalesReturnRO, 'status'),
            ('PurchaseReturn', PurchaseReturnRO, 'status'),
        )
        reversed_count = 0
        for ref_type, model, state_field in specs:
            originals = list(
                JournalEntry.objects.filter(
                    reference_type=ref_type, is_posted=True,
                    reversal_of__isnull=True,      # not itself a reversal
                    reversal_entry__isnull=True,   # not already reversed
                ).exclude(reference_id__isnull=True)
            )
            if not originals:
                continue
            by_ref = {e.reference_id: e for e in originals}
            try:
                cancelled_ids = list(
                    model.objects.filter(
                        id__in=list(by_ref.keys()),
                        **{f'{state_field}__in': CANCELLED_STATES},
                    ).values_list('id', flat=True)
                )
            except Exception as e:
                logger.warning('reverse_cancelled: source lookup failed for %s: %s', ref_type, e)
                continue
            for rid in cancelled_ids:
                try:
                    self._reverse_entry(by_ref[rid])
                    reversed_count += 1
                except Exception as e:
                    self._log_error(f'{ref_type.lower()}_reversal', rid, e)
        return reversed_count

    def sync_all(self) -> dict:
        # Serialise overlapping runs (a UI click racing the */5 cron) so the
        # idempotency check can't double-post. If another run holds the lock,
        # skip — the in-progress run will pick up everything anyway.
        with sync_advisory_lock() as acquired:
            if not acquired:
                logger.info('sync_all skipped — another sync run already holds the lock')
                return {
                    'skipped': True,
                    'reason': 'another sync is already running',
                    'opening_stocks': 0, 'purchases': 0, 'pos': 0, 'b2b': 0,
                    'returns': 0, 'purchase_returns': 0, 'reversed_cancelled': 0,
                    'total': 0,
                }
            return self._sync_all_locked()

    def _sync_all_locked(self) -> dict:
        # Auto-provision a ledger for every supplier and every non-retail (B2B /
        # Hospital / Clinic) customer before posting, so the per-party ledgers
        # exist even for parties that haven't transacted yet. Idempotent and
        # best-effort — a provisioning hiccup must not abort the sync.
        from core.party_ledgers import provision_all_party_ledgers
        try:
            provisioned = provision_all_party_ledgers()
        except Exception:
            logger.exception('Party-ledger provisioning failed during sync_all')
            provisioned = {'suppliers_created': 0, 'customers_created': 0}

        opening_stock_count = self.sync_opening_stocks(SyncLog.get_last_id('opening_stock'))
        purchase_count = self.sync_purchases(SyncLog.get_last_id('purchase'))
        pos_count = self.sync_pos(SyncLog.get_last_id('pos'))
        b2b_count = self.sync_b2b(SyncLog.get_last_id('b2b'))
        return_count = self.sync_returns(SyncLog.get_last_id('return'))
        purchase_return_count = self.sync_purchase_returns(SyncLog.get_last_id('purchase_return'))

        # After posting new orders, back out any previously-synced order that
        # was cancelled upstream so the books don't drift from inventory.
        reversed_cancelled = self.reverse_cancelled()

        total = (opening_stock_count + purchase_count + pos_count + b2b_count
                 + return_count + purchase_return_count)
        SyncLog.objects.create(
            sync_type='all',
            last_synced_id=0,
            records_processed=total
        )

        return {
            'opening_stocks': opening_stock_count,
            'purchases': purchase_count,
            'pos': pos_count,
            'b2b': b2b_count,
            'returns': return_count,
            'purchase_returns': purchase_return_count,
            'reversed_cancelled': reversed_cancelled,
            'party_ledgers': provisioned,
            'total': total,
        }


# Reference types that come from the inventory pipeline. Hand-edited 'Manual'
# JVs are NOT in this list and never get touched by full re-sync.
AUTO_GEN_REF_TYPES = (
    'OpeningStock',
    'PurchaseOrder', 'POSOrder', 'B2BSalesOrder',
    'SalesReturn', 'PurchaseReturn',
)


@transaction.atomic
def full_resync(*, dry_run: bool = False) -> dict:
    """
    WP 668 — full re-sync. Wipes all auto-generated JVs (and their lines via
    CASCADE), resets every SyncLog cursor, then re-runs sync from scratch.

    `dry_run=True` returns the count that would be wiped without touching
    anything. The caller (UI button) should always show a confirmation
    dialog *plus* surface the dry-run count first.
    """
    qs = JournalEntry.objects.filter(reference_type__in=AUTO_GEN_REF_TYPES)
    target_count = qs.count()

    if dry_run:
        return {
            'dry_run': True,
            'would_delete_journals': target_count,
            'would_reset_cursors': SyncLog.objects.count(),
        }

    # Defensive — never wipe Manual entries even if the filter is somehow off.
    deleted, _ = qs.exclude(reference_type='Manual').delete()
    SyncLog.objects.update(last_synced_id=0)
    SyncError.objects.update(resolved=True)  # archive old errors before re-run

    # Re-run sync
    svc = InventorySyncService()
    result = svc.sync_all()

    return {
        'dry_run': False,
        'wiped_entries': deleted,
        'resync': result,
    }

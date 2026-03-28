import logging
import traceback
from django.db import transaction
from inventory_reader.models import (
    PurchaseOrderRO, POSOrderRO, B2BSalesOrderRO, SalesReturnRO, PurchaseReturnRO
)
from journals.services import JournalAutoGenerationService
from .models import SyncLog, SyncError

logger = logging.getLogger('sync')


class InventorySyncService:

    def __init__(self):
        self.journal_service = JournalAutoGenerationService()

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
        orders = PurchaseOrderRO.objects.filter(
            id__gt=since_id,
            state__in=['confirmed', 'done', 'approved']
        ).order_by('id')

        count = 0
        last_id = since_id
        for po in orders:
            try:
                entry = self.journal_service.generate_purchase(po.id)
                if entry:
                    count += 1
                self._resolve_error('purchase', po.id)
                last_id = po.id
            except Exception as e:
                self._log_error('purchase', po.id, e)

        SyncLog.objects.update_or_create(
            sync_type='purchase',
            defaults={'last_synced_id': last_id, 'records_processed': count}
        )
        return count

    def sync_pos(self, since_id: int = 0) -> int:
        orders = POSOrderRO.objects.filter(
            id__gt=since_id,
            status__in=['confirmed', 'completed']
        ).order_by('id')

        count = 0
        last_id = since_id
        for pos in orders:
            try:
                entry = self.journal_service.generate_pos_sale(pos.id)
                if entry:
                    count += 1
                self._resolve_error('pos', pos.id)
                last_id = pos.id
            except Exception as e:
                self._log_error('pos', pos.id, e)

        SyncLog.objects.update_or_create(
            sync_type='pos',
            defaults={'last_synced_id': last_id, 'records_processed': count}
        )
        return count

    def sync_b2b(self, since_id: int = 0) -> int:
        orders = B2BSalesOrderRO.objects.filter(
            id__gt=since_id,
            status__in=['confirmed', 'delivered', 'invoiced']
        ).order_by('id')

        count = 0
        last_id = since_id
        for order in orders:
            try:
                entry = self.journal_service.generate_b2b_sale(order.id)
                if entry:
                    count += 1
                self._resolve_error('b2b', order.id)
                last_id = order.id
            except Exception as e:
                self._log_error('b2b', order.id, e)

        SyncLog.objects.update_or_create(
            sync_type='b2b',
            defaults={'last_synced_id': last_id, 'records_processed': count}
        )
        return count

    def sync_returns(self, since_id: int = 0) -> int:
        returns = SalesReturnRO.objects.filter(
            id__gt=since_id,
            status__in=['confirmed', 'completed']
        ).order_by('id')

        count = 0
        last_id = since_id
        for ret in returns:
            try:
                entry = self.journal_service.generate_sales_return(ret.id)
                if entry:
                    count += 1
                self._resolve_error('return', ret.id)
                last_id = ret.id
            except Exception as e:
                self._log_error('return', ret.id, e)

        SyncLog.objects.update_or_create(
            sync_type='return',
            defaults={'last_synced_id': last_id, 'records_processed': count}
        )
        return count

    def sync_purchase_returns(self, since_id: int = 0) -> int:
        """Sync purchase returns from inventory system (Phase 4A)."""
        returns = PurchaseReturnRO.objects.filter(
            id__gt=since_id,
            status__in=['confirmed', 'completed', 'approved']
        ).order_by('id')

        count = 0
        last_id = since_id
        for ret in returns:
            try:
                entry = self.journal_service.generate_purchase_return(ret.id)
                if entry:
                    count += 1
                self._resolve_error('purchase_return', ret.id)
                last_id = ret.id
            except Exception as e:
                self._log_error('purchase_return', ret.id, e)

        SyncLog.objects.update_or_create(
            sync_type='purchase_return',
            defaults={'last_synced_id': last_id, 'records_processed': count}
        )
        return count

    def retry_failed(self):
        """Retry all unresolved sync errors."""
        errors = SyncError.objects.filter(resolved=False)
        results = {'retried': 0, 'resolved': 0, 'failed': 0}

        for error in errors:
            try:
                if error.sync_type == 'purchase':
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

    def sync_all(self) -> dict:
        purchase_count = self.sync_purchases(SyncLog.get_last_id('purchase'))
        pos_count = self.sync_pos(SyncLog.get_last_id('pos'))
        b2b_count = self.sync_b2b(SyncLog.get_last_id('b2b'))
        return_count = self.sync_returns(SyncLog.get_last_id('return'))
        purchase_return_count = self.sync_purchase_returns(SyncLog.get_last_id('purchase_return'))

        total = purchase_count + pos_count + b2b_count + return_count + purchase_return_count
        SyncLog.objects.create(
            sync_type='all',
            last_synced_id=0,
            records_processed=total
        )

        return {
            'purchases': purchase_count,
            'pos': pos_count,
            'b2b': b2b_count,
            'returns': return_count,
            'purchase_returns': purchase_return_count,
            'total': total,
        }

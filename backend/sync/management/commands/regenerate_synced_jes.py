"""Regenerate all auto-generated journal entries.

Use after fixing bugs in journals.services that affect already-synced records:
  - BUG-2 (POS sale GST decomposition)
  - BUG-3 (Sales return GST reversal + balance)
  - BUG-7 (Purchase / GSTR-2B classification asymmetry)

Steps:
  1. Delete every JournalEntry whose reference_type is one of the auto-sync sources
     (PurchaseOrder, POSOrder, B2BSalesOrder, SalesReturn, PurchaseReturn). Lines
     cascade. Manual JEs (Bill posting, recurring journals, the user's own entries)
     are left untouched.
  2. Reset SyncLog so the sync service rescans from id=0.
  3. Re-run InventorySyncService.sync_all() — which now applies the corrected
     journal-generation logic to every source record.

Idempotent if re-run after success.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from journals.models import JournalEntry
from sync.models import SyncLog, SyncError
from sync.services import InventorySyncService


AUTO_REFERENCE_TYPES = [
    'PurchaseOrder',
    'POSOrder',
    'B2BSalesOrder',
    'SalesReturn',
    'PurchaseReturn',
    # Amendment swap markers must be wiped with the purchase / sales JEs they
    # reverse, or a resync would leave orphaned reversal pairs.
    'PurchaseAmendment',
    'B2BSalesOrderEdit',
]


class Command(BaseCommand):
    help = (
        "Delete all auto-generated journal entries and re-run inventory sync "
        "with the current (fixed) generation logic."
    )

    def handle(self, *args, **options):
        with transaction.atomic():
            qs = JournalEntry.objects.filter(reference_type__in=AUTO_REFERENCE_TYPES)
            count = qs.count()
            self.stdout.write(f"Deleting {count} auto-generated JEs…")
            qs.delete()

            self.stdout.write("Resetting SyncLog and SyncError…")
            SyncLog.objects.all().delete()
            SyncError.objects.all().delete()

        self.stdout.write("Re-running InventorySyncService.sync_all()…")
        result = InventorySyncService().sync_all()

        self.stdout.write(self.style.SUCCESS(
            f"Resync done: {result['total']} JEs generated "
            f"(purchases={result['purchases']}, pos={result['pos']}, "
            f"b2b={result['b2b']}, returns={result['returns']}, "
            f"purchase_returns={result['purchase_returns']})"
        ))

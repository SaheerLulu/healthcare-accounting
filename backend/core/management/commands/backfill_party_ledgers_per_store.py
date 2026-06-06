"""Split shared per-party ledger leaves into per-store leaves and repoint
historical journal lines, based on each parent entry's location_id.

Before the per-store party-ledger change, each supplier/customer had ONE shared
leaf (e.g. ``1125-C42``, location_id NULL). Now each (party, store) gets its own
leaf (``1125-C42-L7``). This command:

  1. For every shared party leaf (party_id set, location_id NULL), finds the
     distinct stores its posted lines belong to (entry.location_id).
  2. get_or_creates the per-store leaf for each, and repoints those lines onto it.
  3. Leaves the now-empty shared leaf in place (deactivated) as a harmless
     historical group parent.

ALWAYS run with ``--dry-run`` first. Safe to re-run: lines already on a
per-store leaf are skipped, so a second run is a no-op.
"""
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import ChartOfAccount
from core.party_ledgers import get_or_create_party_ledger
from journals.models import JournalEntryLine


class Command(BaseCommand):
    help = ('Split shared party-ledger leaves into per-store leaves and repoint '
            'historical journal lines by entry.location_id.')

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Preview the changes without writing.')

    def handle(self, *args, **opts):
        dry = opts['dry_run']

        shared_leaves = list(
            ChartOfAccount.objects.filter(
                party_id__isnull=False, location_id__isnull=True,
            )
        )
        if not shared_leaves:
            self.stdout.write(self.style.WARNING('No shared party leaves to split.'))
            return

        total_lines = 0
        total_leaves = 0
        for leaf in shared_leaves:
            # Distinct stores this leaf's posted lines belong to.
            loc_counts = (
                JournalEntryLine.objects
                .filter(account=leaf, entry__location_id__isnull=False)
                .values_list('entry__location_id', flat=True)
            )
            by_loc = defaultdict(int)
            for loc_id in loc_counts:
                by_loc[loc_id] += 1
            if not by_loc:
                continue

            for loc_id, n in sorted(by_loc.items()):
                self.stdout.write(
                    f'  {leaf.account_code} ({leaf.party_type}#{leaf.party_id}) '
                    f'→ store {loc_id}: {n} lines'
                    + ('  [DRY-RUN]' if dry else '')
                )
                total_lines += n
                total_leaves += 1
                if dry:
                    continue
                with transaction.atomic():
                    store_leaf = get_or_create_party_ledger(
                        leaf.party_type, leaf.party_id, location_id=loc_id)
                    (JournalEntryLine.objects
                     .filter(account=leaf, entry__location_id=loc_id)
                     .update(account=store_leaf))

            # Deactivate the now-drained shared leaf (kept for history/FK safety).
            if not dry:
                remaining = JournalEntryLine.objects.filter(account=leaf).exists()
                if not remaining and leaf.is_active:
                    leaf.is_active = False
                    leaf.save(update_fields=['is_active', 'updated_at'])

        self.stdout.write(self.style.SUCCESS(
            f'\nDone: {total_lines} lines across {total_leaves} (party, store) leaves'
            + ('  [DRY-RUN — nothing written]' if dry else '')
        ))

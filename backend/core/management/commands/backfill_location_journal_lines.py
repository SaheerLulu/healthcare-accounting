"""Repoint historical JournalEntryLine rows from template CoA to per-store
clones, based on each parent entry's location_id.

Before per-location COA, every journal entry posted against the global
"1110 Cash" template. After ``bootstrap_location_coa`` runs for each store,
this command moves those existing lines onto their store-specific clones so
trial-balance / cash-book queries scoped to a location see real numbers.

ALWAYS run with ``--dry-run`` first to preview. The command never touches
SHARED_KEYS-backed accounts (GST, equity, suspense, round-off, etc.) and
never moves lines whose entry already points at a per-store account.

Safe to re-run: the only operation is a per-line UPDATE of account_id;
running again after success is a no-op because lines already point at clones.
"""
from collections import defaultdict
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import AccountMapping, ChartOfAccount
from journals.models import JournalEntryLine


class Command(BaseCommand):
    help = ('Repoint existing JournalEntryLine.account from template CoA to '
            'per-store clones based on entry.location_id.')

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Preview the changes without writing.')
        parser.add_argument('--location-id', type=int, default=None,
                            help='Limit to entries at this location only.')
        parser.add_argument('--batch-size', type=int, default=500,
                            help='Update batch size (default 500).')

    def handle(self, *args, **opts):
        dry = opts['dry_run']
        only_loc = opts.get('location_id')
        batch = opts['batch_size']

        shared_keys = AccountMapping.SHARED_KEYS
        # Account IDs that should NEVER move per-store — GST, equity, etc.
        shared_account_ids = set(
            AccountMapping.objects.filter(
                key__in=shared_keys, location_id__isnull=True,
            ).values_list('account_id', flat=True)
        )

        # Build a (template_account_id, location_id) → clone_account_id map.
        clone_map = self._build_clone_map(shared_account_ids)
        if not clone_map:
            raise CommandError(
                'No per-store clones found. Run bootstrap_location_coa first.'
            )

        # Find lines that need repointing: entry has a location, account is a
        # template (location_id is NULL) and is not in the shared set.
        qs = JournalEntryLine.objects.filter(
            entry__location_id__isnull=False,
            account__location_id__isnull=True,
        ).exclude(account_id__in=shared_account_ids)
        if only_loc:
            qs = qs.filter(entry__location_id=only_loc)

        total = qs.count()
        if total == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to backfill.'))
            return

        # Group by (location_id, account_id) so we can issue one UPDATE per pair.
        groups = defaultdict(list)
        for line_id, entry_loc, tpl_id in qs.values_list(
            'id', 'entry__location_id', 'account_id',
        ).iterator(chunk_size=batch):
            clone_id = clone_map.get((tpl_id, entry_loc))
            if clone_id is None:
                # No clone for this combination — most often because the
                # location wasn't bootstrapped yet. Skip silently; user can
                # re-run after bootstrapping.
                continue
            groups[(entry_loc, clone_id)].append(line_id)

        updated = 0
        skipped = total - sum(len(ids) for ids in groups.values())
        for (loc, clone_id), line_ids in groups.items():
            if dry:
                self.stdout.write(
                    f'  loc {loc} → clone account {clone_id}: '
                    f'{len(line_ids)} lines'
                )
                updated += len(line_ids)
                continue
            with transaction.atomic():
                # Chunk the UPDATE to avoid building huge IN-clauses.
                for i in range(0, len(line_ids), batch):
                    chunk = line_ids[i:i + batch]
                    JournalEntryLine.objects.filter(id__in=chunk).update(
                        account_id=clone_id,
                    )
                    updated += len(chunk)

        msg = (f'Repointed {updated} of {total} lines'
               f' (skipped {skipped} due to missing clones)')
        if dry:
            self.stdout.write(self.style.WARNING(msg + ' [DRY-RUN]'))
        else:
            self.stdout.write(self.style.SUCCESS(msg))

    def _build_clone_map(self, shared_account_ids):
        """Build {(template_id, location_id): clone_id} from cloned accounts.

        A clone is any non-shared account with location_id set AND a parent
        that is itself NULL-location (the template)."""
        clones = ChartOfAccount.objects.filter(
            location_id__isnull=False,
            parent__location_id__isnull=True,
        ).exclude(parent_id__in=shared_account_ids).values(
            'id', 'location_id', 'parent_id',
        )
        return {(c['parent_id'], c['location_id']): c['id'] for c in clones}

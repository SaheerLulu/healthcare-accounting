"""Clone the template Chart of Accounts for one or more locations.

Per the per-location COA design ([[per-location-coa]]), every store gets its
own settlement, party, sales, expense, and inventory accounts under a code
like "1110-MUM" (parent: the template "1110 Cash"). A small set of role keys
stay shared at the company level — GST, TDS, equity, suspense, round-off —
because they roll up under a single GSTIN/TAN/legal entity.

Idempotent: re-running for a location that already has clones is a no-op.

Examples:
  # Bootstrap a specific location
  ./manage.py bootstrap_location_coa --location-id 7

  # Bootstrap every location known to the inventory DB (skips ones already done)
  ./manage.py bootstrap_location_coa --all

  # Dry-run: show what would be created without writing anything
  ./manage.py bootstrap_location_coa --all --dry-run
"""
import re
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import AccountMapping, ChartOfAccount


def derive_location_code(name: str) -> str:
    """Turn 'Mumbai Branch' / 'Delhi NCR' / 'Pune-2' into 'MUM' / 'DEL' / 'PUN2'.

    Strips non-alphanumerics, uppercases, takes the first 3-4 alpha chars
    plus any trailing digits. Keep it short — accounts get '1110-MUM' style
    codes and the field is 20 chars wide."""
    cleaned = re.sub(r'[^A-Za-z0-9]', '', name).upper()
    if not cleaned:
        return 'LOC'
    # Find the alpha prefix and any digit suffix.
    m = re.match(r'^([A-Z]+)(\d*)', cleaned)
    if not m:
        return cleaned[:4]
    alpha, digits = m.groups()
    return (alpha[:3] + digits)[:8] or 'LOC'


class Command(BaseCommand):
    help = 'Clone the template Chart of Accounts for one or more locations.'

    def add_arguments(self, parser):
        g = parser.add_mutually_exclusive_group(required=True)
        g.add_argument('--location-id', type=int,
                       help='Bootstrap this single location (numeric id).')
        g.add_argument('--all', action='store_true',
                       help='Bootstrap every location in inventory_reader.LocationRO.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Show what would be created without writing.')
        parser.add_argument('--code', type=str, default=None,
                            help='Override the derived 3-4 char location code '
                                 '(only valid with --location-id).')

    def handle(self, *args, **opts):
        if opts.get('code') and opts.get('all'):
            raise CommandError('--code only makes sense with --location-id.')

        locations = self._resolve_locations(opts)
        if not locations:
            self.stdout.write(self.style.WARNING('No locations to process.'))
            return

        dry = opts['dry_run']
        total_clones = 0
        total_mappings = 0
        for loc_id, loc_name, loc_code in locations:
            clones, mappings = self._bootstrap_one(loc_id, loc_name, loc_code, dry_run=dry)
            self.stdout.write(
                f'  loc {loc_id} ({loc_name}) [{loc_code}]: '
                f'{clones} accounts, {mappings} mappings'
                + ('  [DRY-RUN]' if dry else '')
            )
            total_clones += clones
            total_mappings += mappings

        self.stdout.write(self.style.SUCCESS(
            f'\nDone: {total_clones} accounts + {total_mappings} mappings '
            f'across {len(locations)} location(s)'
            + ('  [DRY-RUN — nothing written]' if dry else '')
        ))

    def _resolve_locations(self, opts):
        """Returns [(loc_id, name, code)] for the locations to bootstrap."""
        from inventory_reader.models import LocationRO
        if opts.get('location_id'):
            loc_id = opts['location_id']
            try:
                loc = LocationRO.objects.get(id=loc_id)
            except LocationRO.DoesNotExist:
                raise CommandError(f'Location {loc_id} not found in inventory DB.')
            code = opts.get('code') or derive_location_code(loc.name)
            return [(loc.id, loc.name, code)]
        # --all: skip internal warehouses, etc. — only physical "internal" stores.
        out = []
        for loc in LocationRO.objects.all().order_by('id'):
            code = derive_location_code(loc.name)
            out.append((loc.id, loc.name, code))
        return out

    @transaction.atomic
    def _bootstrap_one(self, loc_id, loc_name, loc_code, *, dry_run):
        """Clone every non-shared template account + mapping for this location.

        Returns (n_accounts_created, n_mappings_created)."""
        shared_keys = AccountMapping.SHARED_KEYS

        # The role-mapped codes the user wants to keep shared (NULL location).
        # Anything not in this set gets per-store clones.
        shared_codes = set(
            AccountMapping.objects.filter(
                key__in=shared_keys, location_id__isnull=True,
            ).values_list('account__account_code', flat=True)
        )

        templates = list(
            ChartOfAccount.objects.filter(
                location_id__isnull=True, is_active=True,
            ).exclude(account_code__in=shared_codes)
            .order_by('account_code')
        )

        clones_created = 0
        # Map template_id → clone_id so AccountMapping rebinding works.
        template_to_clone = {}

        for tpl in templates:
            clone_code = f'{tpl.account_code}-{loc_code}'
            existing = ChartOfAccount.objects.filter(
                account_code=clone_code, location_id=loc_id,
            ).first()
            if existing:
                template_to_clone[tpl.id] = existing.id
                continue
            if not dry_run:
                # Parent the clone under the template itself, so a consolidated
                # trial balance rolls up "1110-MUM" + "1110-DEL" via the
                # template "1110 Cash". The template stops being a leaf the
                # moment it has children; its own balance stays at zero since
                # all postings go to the per-store leaves.
                clone = ChartOfAccount.objects.create(
                    account_code=clone_code,
                    account_name=f'{tpl.account_name} - {loc_name}',
                    account_type=tpl.account_type,
                    account_subtype=tpl.account_subtype,
                    parent_id=tpl.id,
                    location_id=loc_id,
                    is_leaf=True,
                    is_active=True,
                    description=f'Per-store clone of {tpl.account_code} for {loc_name}.',
                )
                if tpl.is_leaf:
                    tpl.is_leaf = False
                    tpl.save(update_fields=['is_leaf', 'updated_at'])
                template_to_clone[tpl.id] = clone.id
            clones_created += 1

        # Now rebind each non-shared AccountMapping default onto the clone.
        mappings_created = 0
        defaults = AccountMapping.objects.filter(location_id__isnull=True).exclude(
            key__in=shared_keys,
        ).select_related('account')

        for m in defaults:
            clone_id = template_to_clone.get(m.account_id)
            if not clone_id:
                # No clone (e.g., template was inactive or filtered out).
                continue
            if AccountMapping.objects.filter(key=m.key, location_id=loc_id).exists():
                continue
            if not dry_run:
                AccountMapping.objects.create(
                    key=m.key, location_id=loc_id, account_id=clone_id,
                )
            mappings_created += 1

        return clones_created, mappings_created

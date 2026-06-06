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
from django.core.management.base import BaseCommand, CommandError

from core.location_coa import bootstrap_location, derive_location_code  # noqa: F401 (re-exported for tests)


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
            clones, mappings = bootstrap_location(loc_id, loc_name, loc_code, dry_run=dry)
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

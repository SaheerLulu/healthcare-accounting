"""Delete ALL accounting data for one decommissioned store (by location_id).

Companion to the pharmacy app's ``purge_location``. The accounting app shares
the pharmacy Postgres DB but owns its own tables and references the store only
by a loose ``location_id`` integer (no cross-app foreign key). So deleting a
store's pharmacy data leaves every accounting row for that store — journals,
GST, TDS, bills, banking, payroll, etc. — dangling. Run this to remove them.

Strategy
--------
Every managed accounting model that carries a ``location_id`` field is swept
(``filter(location_id=<store>).delete()``). Because many of these PROTECT-
reference ``core.ChartOfAccount`` (itself location-scoped), a fixed delete order
is fragile, so we retry until stable: each pass deletes what it can and defers
anything that raises ProtectedError to the next pass, until no rows are left or
no further progress is possible. Child rows without their own ``location_id``
(journal/bill/expense lines) are CASCADE-removed with their location-scoped
parents; the one exception — ``banking.PettyCashTransaction`` (PROTECT→
PettyCashFloat, no location_id) — is pre-deleted via a join to its store float.

Anything still blocked at the end (e.g. a per-store account referenced by a
SHARED, non-location asset class) is reported, not force-deleted.

Not touched: shared masters without a location_id (e.g. AssetClass, NULL-
location template accounts) and other stores' rows.

Usage
-----
    python manage.py purge_location <location_id> --dry-run   # preview + validate, deletes nothing
    python manage.py purge_location <location_id>             # prompts to type the id
    python manage.py purge_location <location_id> --yes       # no prompt (scripts)
"""
from __future__ import annotations

from django.apps import apps
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import ProtectedError

_LIST_CAP = 60


class Command(BaseCommand):
    help = 'Delete all accounting rows for one store (location_id) — for decommissioning a branch.'

    def add_arguments(self, parser):
        parser.add_argument('location_id', type=int, help='Pharmacy store id (accounting location_id) to purge.')
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Run the whole purge inside a rolled-back transaction: reports counts and '
                 'validates delete order, but commits nothing.')
        parser.add_argument(
            '--yes', action='store_true',
            help='Skip the interactive "type the id" confirmation (for scripts).')

    # ------------------------------------------------------------------
    @staticmethod
    def _location_models():
        """Every managed model that carries a concrete ``location_id`` field.
        Excludes unmanaged inventory_reader proxies (they read pharmacy tables)
        and Django built-ins (which have no location_id)."""
        return [
            m for m in apps.get_models()
            if m._meta.managed
            and any(f.name == 'location_id' for f in m._meta.concrete_fields)
        ]

    @staticmethod
    def _child_predeletes(loc_id):
        """(label, queryset) for non-location-scoped children that PROTECT a
        location-scoped parent and are not cascade-covered, reached via a join
        to their store-scoped owner. Currently only PettyCashTransaction."""
        out = []
        try:
            from banking.models import PettyCashTransaction
            out.append((
                'banking.PettyCashTransaction (via float__location_id)',
                PettyCashTransaction._base_manager.filter(float__location_id=loc_id),
            ))
        except Exception:
            pass
        return out

    # ------------------------------------------------------------------
    def handle(self, *args, **opts):
        loc_id = opts['location_id']
        dry_run = opts['dry_run']
        models = self._location_models()

        self.stdout.write(self.style.MIGRATE_HEADING(
            f'\nPurge accounting data for store location_id={loc_id}'))
        self.stdout.write(
            f'{len(models)} accounting models carry a location_id and will be swept.')

        if not dry_run and not opts['yes']:
            self._print_preview(models, loc_id)
            typed = input(f'\nType the location id to PERMANENTLY delete its accounting data — {loc_id}: ')
            if typed.strip() != str(loc_id):
                raise CommandError('Aborted — the id you typed did not match.')

        with transaction.atomic():
            summary = self._purge(models, loc_id)
            if dry_run:
                transaction.set_rollback(True)

        self._print_summary(loc_id, summary, dry_run)

    # ------------------------------------------------------------------
    def _purge(self, models, loc_id):
        deleted = []  # (label, count) — count includes cascaded children

        # 1) join-based child pre-deletes (no location_id of their own)
        for label, qs in self._child_predeletes(loc_id):
            total, _ = qs.delete()
            deleted.append((label, total))

        # 2) retry-until-stable sweep over the location_id models
        pending = list(models)
        blocked = []
        while pending:
            progressed = False
            still = []
            for model in pending:
                try:
                    with transaction.atomic():  # savepoint: a ProtectedError here
                        total, _ = model._base_manager.filter(location_id=loc_id).delete()
                    deleted.append((model._meta.label, total))
                    progressed = True
                except ProtectedError:
                    still.append(model)
            if not progressed:
                blocked = still
                break
            pending = still

        blocked_report = [
            (m._meta.label, m._base_manager.filter(location_id=loc_id).count())
            for m in blocked
        ]
        return {'deleted': deleted, 'blocked': blocked_report}

    # ------------------------------------------------------------------
    def _print_preview(self, models, loc_id):
        self.stdout.write('\nRows currently at this store (header rows; child lines cascade):')
        grand = 0
        for model in sorted(models, key=lambda m: m._meta.label):
            n = model._base_manager.filter(location_id=loc_id).count()
            grand += n
            if n:
                self.stdout.write(f'  {n:>8}  {model._meta.label}')
        for label, qs in self._child_predeletes(loc_id):
            n = qs.count()
            if n:
                self.stdout.write(f'  {n:>8}  {label}')
        self.stdout.write(f'  {grand:>8}  total (location_id-tagged rows)')

    def _print_summary(self, loc_id, summary, dry_run):
        verb = 'Would delete' if dry_run else 'Deleted'
        self.stdout.write(self.style.MIGRATE_HEADING(
            f'\n{"DRY RUN — " if dry_run else ""}Accounting purge summary for location_id={loc_id}'))
        grand = 0
        shown = 0
        for label, n in summary['deleted']:
            grand += n
            if n:
                self.stdout.write(f'  {verb} {n:>8}  {label}')
                shown += 1
        if shown == 0:
            self.stdout.write('  (no accounting rows found for this store)')
        self.stdout.write(f'  {verb} {grand:>8}  accounting rows total (incl. cascaded lines)')

        if summary['blocked']:
            self.stdout.write(self.style.ERROR(
                '\n  BLOCKED — could not delete (still referenced by a shared/other-store row):'))
            for label, n in summary['blocked']:
                self.stdout.write(self.style.ERROR(f'    {n:>8}  {label}'))
            self.stdout.write(self.style.WARNING(
                '  Resolve these references manually (e.g. reassign a shared AssetClass) and re-run.'))

        if dry_run:
            self.stdout.write(self.style.WARNING(
                '\nDRY RUN — nothing committed. Re-run without --dry-run to execute.'))
        else:
            self.stdout.write(self.style.SUCCESS('\nDone.'))

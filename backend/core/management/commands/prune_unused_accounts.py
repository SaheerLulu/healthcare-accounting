"""Trim the Chart of Accounts down to what's actually in use.

The seeded Tally chart is deliberately comprehensive (fixed-asset classes, dozens
of expense sub-accounts, receivable/stock sub-types, …). Most installs never
touch the bulk of it. This command removes the dead weight: LEAF accounts that

  * are NOT referenced by ANY model (no journal lines, no AccountMapping, no
    bank account / asset class / recurring line / cost link, not a parent), and
  * are NOT a per-party ledger.

Anything referenced anywhere is kept, so the trim can never break posting,
GST/TDS/payroll mappings, reports, or another module's configuration. It is also
reversible — `manage.py seed_coa` re-creates the canonical chart (the pruned rows
had no data to lose).

Dry-run by default. Use --apply to delete, or --deactivate to hide (is_active=
False) instead of deleting. --prune-empty-groups also removes group rows left
with no children.

  ./manage.py prune_unused_accounts                  # preview
  ./manage.py prune_unused_accounts --apply          # delete the dead leaves
  ./manage.py prune_unused_accounts --apply --deactivate
  ./manage.py prune_unused_accounts --apply --prune-empty-groups
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import ChartOfAccount


def _referenced_account_ids():
    """Every ChartOfAccount id referenced by any FK/O2O on any model — including
    journal lines, AccountMapping, the self parent link, and any other app."""
    keep = set()
    for rel in ChartOfAccount._meta.related_objects:
        model = rel.related_model
        fk = rel.field.attname  # e.g. 'account_id', 'parent_id'
        try:
            keep |= {v for v in model.objects.values_list(fk, flat=True) if v}
        except Exception:  # unmanaged / table absent — skip
            pass
    return keep


class Command(BaseCommand):
    help = 'Remove chart-of-accounts leaves that nothing references (keeps mapped/used/party).'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Actually change the DB (default: dry-run preview).')
        parser.add_argument('--deactivate', action='store_true',
                            help='Set is_active=False instead of deleting.')
        parser.add_argument('--prune-empty-groups', action='store_true',
                            help='Also remove group rows left without any children.')

    def handle(self, *args, **opts):
        apply = opts['apply']
        deactivate = opts['deactivate']
        keep = _referenced_account_ids()
        keep |= set(ChartOfAccount.objects.filter(party_id__isnull=False)
                    .values_list('id', flat=True))

        removable = list(
            ChartOfAccount.objects.filter(is_leaf=True).exclude(id__in=keep)
            .order_by('account_code')
        )
        verb = 'Deactivate' if deactivate else 'Delete'
        self.stdout.write(f'{verb} {len(removable)} unused leaf account(s):')
        for a in removable:
            self.stdout.write(f'  {a.account_code:10} {a.account_name}')

        if apply and removable:
            ids = [a.id for a in removable]
            with transaction.atomic():
                if deactivate:
                    ChartOfAccount.objects.filter(id__in=ids).update(is_active=False)
                else:
                    ChartOfAccount.objects.filter(id__in=ids).delete()

        groups_done = 0
        if opts['prune_empty_groups']:
            # Repeatedly drop childless non-leaf groups (bottom-up).
            while True:
                empty = list(ChartOfAccount.objects.filter(is_leaf=False, children__isnull=True))
                empty = [g for g in empty if g.party_id is None]
                if not empty:
                    break
                self.stdout.write(f'{verb} {len(empty)} empty group(s): '
                                  + ', '.join(g.account_code for g in empty))
                groups_done += len(empty)
                if not apply:
                    break  # can't iterate safely without applying
                ids = [g.id for g in empty]
                with transaction.atomic():
                    if deactivate:
                        ChartOfAccount.objects.filter(id__in=ids).update(is_active=False)
                    else:
                        ChartOfAccount.objects.filter(id__in=ids).delete()

        remaining = ChartOfAccount.objects.count()
        if apply:
            self.stdout.write(self.style.SUCCESS(
                f'Done — {len(removable)} leaves + {groups_done} groups '
                f'{"deactivated" if deactivate else "removed"}; {remaining} accounts remain.'))
        else:
            self.stdout.write(self.style.WARNING(
                f'DRY-RUN — nothing changed. Would leave {remaining - len(removable)} accounts. '
                f'Re-run with --apply to execute.'))

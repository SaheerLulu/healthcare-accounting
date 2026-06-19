"""Prune the redundant per-store account clones left by the old bootstrap.

Historically ``bootstrap_location`` cloned EVERY template account into EVERY
store (~180 rows per store). The COA now only auto-clones the *operational*
accounts (``core.coa_data.OPERATIONAL_KEYS`` — the ones the pharmacy inventory
sync and doctor/front-office fee collection actually post to). This command
removes the leftover non-operational per-store clones (and their per-store
``AccountMapping`` overrides) so each store's Chart of Accounts shows only what
it uses. Non-operational keys keep resolving via the shared NULL-location
template through ``AccountMapping.get_account()``'s fallback.

Safe by construction:
  * never touches NULL-location templates or deliberate shared accounts,
  * never touches per-party ledgers (``party_id`` set),
  * never touches operational clones (``CASH-MUM``, ``INPUT_CGST-MUM``, …),
  * SKIPS (and reports) any clone with journal lines or any other reference
    (bank account, asset class, recurring line, cost link, used as a parent),
  * after deletion, re-flags any template left childless as a postable leaf so
    it is selectable again in account pickers.

Dry-run by default; pass ``--apply`` to execute. ``--location-id`` limits to one
store.

  ./manage.py prune_store_coa                  # preview, all stores
  ./manage.py prune_store_coa --apply          # execute
  ./manage.py prune_store_coa --location-id 7  # preview, one store
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from core.coa_data import OPERATIONAL_KEYS
from core.models import AccountMapping, ChartOfAccount


def _external_reference_ids():
    """ChartOfAccount ids referenced by any model EXCEPT AccountMapping.

    AccountMapping rows for the pruned clones are removed by this command, so
    an AccountMapping reference must NOT keep a clone alive. Everything else —
    journal lines, bank accounts, asset classes, recurring lines, cost links,
    and the self parent link — does.
    """
    keep = set()
    for rel in ChartOfAccount._meta.related_objects:
        model = rel.related_model
        if model is AccountMapping:
            continue
        fk = rel.field.attname  # e.g. 'account_id', 'parent_id'
        try:
            keep |= {v for v in model.objects.values_list(fk, flat=True) if v}
        except Exception:  # unmanaged / table absent — skip
            pass
    return keep


class Command(BaseCommand):
    help = ('Remove leftover non-operational per-store account clones '
            '(keeps operational/party/referenced accounts).')

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Actually change the DB (default: dry-run preview).')
        parser.add_argument('--location-id', type=int, default=None,
                            help='Limit to a single store (numeric location id).')

    def handle(self, *args, **opts):
        apply = opts['apply']
        loc_id = opts['location_id']

        clones = ChartOfAccount.objects.filter(
            location_id__isnull=False, party_id__isnull=True,
        )
        if loc_id is not None:
            clones = clones.filter(location_id=loc_id)

        # Per-store clones to KEEP: those bound to an operational key.
        keep_ids = set(
            AccountMapping.objects.filter(
                location_id__isnull=False, key__in=OPERATIONAL_KEYS,
            ).values_list('account_id', flat=True)
        )
        external_refs = _external_reference_ids()

        candidates = list(
            clones.exclude(id__in=keep_ids).order_by('location_id', 'account_code')
        )

        to_delete = []
        skipped = []  # (clone, reason)
        for c in candidates:
            if c.journal_lines.exists():
                skipped.append((c, 'journal lines'))
            elif c.id in external_refs:
                skipped.append((c, 'referenced'))
            else:
                to_delete.append(c)

        self.stdout.write(f'Per-store clones examined: {len(candidates)}')
        self.stdout.write(f'  → deletable (no references): {len(to_delete)}')
        self.stdout.write(f'  → skipped (in use): {len(skipped)}')
        for c, reason in skipped:
            self.stdout.write(self.style.WARNING(
                f'    SKIP {c.account_code:16} loc={c.location_id}  ({reason})'))
        sample = to_delete[:25]
        for c in sample:
            self.stdout.write(f'    del  {c.account_code:16} loc={c.location_id}  {c.account_name}')
        if len(to_delete) > len(sample):
            self.stdout.write(f'    … and {len(to_delete) - len(sample)} more')

        if not apply:
            self.stdout.write(self.style.WARNING(
                '\nDRY-RUN — nothing changed. Re-run with --apply to execute.'))
            return
        if not to_delete:
            self.stdout.write(self.style.SUCCESS('Nothing to delete.'))
            return

        del_ids = [c.id for c in to_delete]
        parent_ids = {c.parent_id for c in to_delete if c.parent_id}
        with transaction.atomic():
            # AccountMapping.account is PROTECT → drop the overrides first.
            n_maps = AccountMapping.objects.filter(account_id__in=del_ids).delete()[0]
            ChartOfAccount.objects.filter(id__in=del_ids).delete()
            # Any template that just lost its last child becomes a postable leaf
            # again (so it shows up in account pickers).
            releafed = 0
            for tpl in ChartOfAccount.objects.filter(id__in=parent_ids):
                should_leaf = not tpl.children.exists()
                if tpl.is_leaf != should_leaf:
                    tpl.is_leaf = should_leaf
                    tpl.save(update_fields=['is_leaf', 'updated_at'])
                    releafed += 1

        self.stdout.write(self.style.SUCCESS(
            f'Done — deleted {len(del_ids)} clones + {n_maps} mapping override(s); '
            f're-flagged {releafed} template(s) as leaf; skipped {len(skipped)} in use.'))

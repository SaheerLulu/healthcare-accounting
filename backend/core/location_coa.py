"""Per-location Chart of Accounts bootstrapping ([[per-location-coa]]).

Shared service used by both the ``bootstrap_location_coa`` management command
and the incremental sync. Every store gets its own settlement, party, sales,
expense and inventory leaves under codes like ``1110-MUM`` (parent: the
template ``1110 Cash``); a small ``AccountMapping.SHARED_KEYS`` set stays at the
company level (GST/TDS/equity/suspense/round-off) because it rolls up under a
single GSTIN/TAN/legal entity. All functions are idempotent.
"""
import re

from django.db import transaction

from core.models import AccountMapping, ChartOfAccount


def derive_location_code(name: str) -> str:
    """Turn 'Mumbai Branch' / 'Delhi NCR' / 'Pune-2' into 'MUM' / 'DEL' / 'PUN2'.

    Strips non-alphanumerics, uppercases, takes the first 3-4 alpha chars plus
    any trailing digits. Keep it short — accounts get '1110-MUM' style codes and
    the field is 20 chars wide."""
    cleaned = re.sub(r'[^A-Za-z0-9]', '', name or '').upper()
    if not cleaned:
        return 'LOC'
    m = re.match(r'^([A-Z]+)(\d*)', cleaned)
    if not m:
        return cleaned[:4]
    alpha, digits = m.groups()
    return (alpha[:3] + digits)[:8] or 'LOC'


@transaction.atomic
def bootstrap_location(loc_id, loc_name, loc_code, *, dry_run=False):
    """Clone every non-shared template account + mapping for one location.

    Returns (n_accounts_created, n_mappings_created). Idempotent: existing
    clones/mappings are skipped, so re-running is a no-op."""
    shared_keys = AccountMapping.SHARED_KEYS

    # Role-mapped codes that stay shared (NULL location). Anything not in this
    # set gets per-store clones.
    shared_codes = set(
        AccountMapping.objects.filter(
            key__in=shared_keys, location_id__isnull=True,
        ).values_list('account__account_code', flat=True)
    )

    templates = list(
        ChartOfAccount.objects.filter(
            location_id__isnull=True, is_active=True,
            # Per-party ledgers (Sundry Creditor/Debtor leaves) are shared
            # across stores by design — never clone them per location.
            party_id__isnull=True,
        ).exclude(account_code__in=shared_codes)
        .order_by('account_code')
    )

    clones_created = 0
    template_to_clone = {}  # template_id -> clone_id, for mapping rebinding

    for tpl in templates:
        clone_code = f'{tpl.account_code}-{loc_code}'
        existing = ChartOfAccount.objects.filter(
            account_code=clone_code, location_id=loc_id,
        ).first()
        if existing:
            template_to_clone[tpl.id] = existing.id
            continue
        if not dry_run:
            # Parent the clone under the template so a consolidated trial balance
            # rolls up "1110-MUM" + "1110-DEL" via the template "1110 Cash". The
            # template stops being a leaf once it has children; its own balance
            # stays zero since all postings go to the per-store leaves.
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

    # Rebind each non-shared AccountMapping default onto the clone.
    mappings_created = 0
    defaults = AccountMapping.objects.filter(location_id__isnull=True).exclude(
        key__in=shared_keys,
    ).select_related('account')

    for m in defaults:
        clone_id = template_to_clone.get(m.account_id)
        if not clone_id:
            continue
        if AccountMapping.objects.filter(key=m.key, location_id=loc_id).exists():
            continue
        if not dry_run:
            AccountMapping.objects.create(
                key=m.key, location_id=loc_id, account_id=clone_id,
            )
        mappings_created += 1

    return clones_created, mappings_created


def ensure_locations_bootstrapped(*, only_missing=True):
    """Bootstrap per-store COA for every inventory location, cheaply.

    Intended to run on every sync. Detects, per location, whether every
    non-shared mapping key already has a per-store override; a store is
    (re)bootstrapped when it is missing ANY of them. This catches both brand-new
    stores AND stores bootstrapped before a new expense/cost account was added
    (e.g. a newly un-shared ROUND_OFF, or a freshly added PETTY_EXPENSE), so no
    cost ever silently falls back to a shared account. `bootstrap_location` is
    idempotent, so it only fills the gaps. Best-effort: wrap in try/except.
    """
    from collections import defaultdict
    from inventory_reader.models import LocationRO

    summary = {'locations': 0, 'accounts': 0, 'mappings': 0}

    # Every mapping key that SHOULD have a per-store override.
    nonshared_keys = set(
        AccountMapping.objects.filter(location_id__isnull=True)
        .exclude(key__in=AccountMapping.SHARED_KEYS)
        .values_list('key', flat=True)
    )
    if not nonshared_keys:
        return summary

    # Per-location keys that already have an override.
    have = defaultdict(set)
    for loc_id, key in (
        AccountMapping.objects.filter(location_id__isnull=False, key__in=nonshared_keys)
        .values_list('location_id', 'key')
    ):
        have[loc_id].add(key)

    for loc in LocationRO.objects.all().order_by('id'):
        missing = nonshared_keys - have.get(loc.id, set())
        if only_missing and not missing:
            continue
        code = derive_location_code(loc.name)
        clones, mappings = bootstrap_location(loc.id, loc.name, code)
        if clones or mappings:
            summary['locations'] += 1
            summary['accounts'] += clones
            summary['mappings'] += mappings
    return summary

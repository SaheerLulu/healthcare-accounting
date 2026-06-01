"""Per-party ledger resolution — the single chokepoint for Tally-style
"Sundry Creditor/Debtor" ledgers (one GL leaf per inventory supplier/customer).

Design (see [[party-ledger-per-party]]):
- Each supplier gets a leaf ledger `2105-S<id>` under group 2105 Sundry Creditors;
  each named customer gets `1125-C<id>` under group 1125 Sundry Debtors.
- The leaf is linked to its inventory party via ChartOfAccount.party_type/party_id
  (a DB-unique pair), NOT by parsing the account_code.
- Party ledgers are ALWAYS shared (location_id NULL): one consolidated statement
  per party across stores. The resolver REFUSES a non-NULL location_id, and a
  CheckConstraint enforces it at the DB level.
- account_subtype is copied from the control ('Payable'/'Receivable') so every
  subtype-filtered report (AR/AP, aging, ratios, MSME) keeps working unchanged.
- Walk-in / cash customers (NULL party_id) are NEVER given a ledger — those
  postings stay on the generic control leaf (TRADE_PAYABLES/TRADE_RECEIVABLES).

Posting sites call `resolve_party_account(party_type, party_id, fallback)`:
it returns the per-party ledger when the feature is enabled and party_id is set,
otherwise the passed-in control account. That keeps every call site a one-liner
and respects the PARTY_LEDGERS_ENABLED flag in one place.
"""
import logging

from django.conf import settings
from django.db import IntegrityError, transaction

logger = logging.getLogger('core.party_ledgers')

SUPPLIER_GROUP_CODE = '2105'   # Sundry Creditors
CUSTOMER_GROUP_CODE = '1125'   # Sundry Debtors

_PARTY_CFG = {
    'Supplier': dict(group=SUPPLIER_GROUP_CODE, tag='S',
                     account_type='LIABILITY', subtype='Payable'),
    'Customer': dict(group=CUSTOMER_GROUP_CODE, tag='C',
                     account_type='ASSET', subtype='Receivable'),
}


def party_ledgers_enabled() -> bool:
    """Master switch. Default ON; set PARTY_LEDGERS_ENABLED=False to fall back
    to the shared control accounts (e.g. for staged rollout / debugging)."""
    return getattr(settings, 'PARTY_LEDGERS_ENABLED', True)


def party_ledger_code(party_type: str, party_id: int) -> str:
    cfg = _PARTY_CFG[party_type]
    return f"{cfg['group']}-{cfg['tag']}{party_id}"


def _party_name(party_type: str, party_id: int) -> str:
    """Human ledger name from the inventory master (truncated to 255).

    Resilient: the inventory proxy tables are unmanaged and may be absent (e.g.
    in a test DB) — fall back to a generic name rather than raising."""
    fallback = f'{party_type} #{party_id}'
    try:
        # Isolate the read in its own savepoint: the inventory proxy tables are
        # unmanaged and may be absent (test DB), and a failed query would
        # otherwise poison the surrounding transaction.
        with transaction.atomic():
            from inventory_reader.models import SupplierRO, CustomerRO
            if party_type == 'Supplier':
                p = SupplierRO.objects.filter(id=party_id).only('company_name').first()
                name = p.company_name if p else fallback
            else:
                p = CustomerRO.objects.filter(id=party_id).only('customer_name').first()
                name = p.customer_name if p else fallback
    except Exception:  # inventory table missing / unreachable
        name = fallback
    return (name or fallback)[:255]


def get_party_ledger(party_type: str, party_id):
    """Non-creating lookup. Returns the ChartOfAccount leaf or None."""
    from core.models import ChartOfAccount
    if party_type not in _PARTY_CFG or not party_id:
        return None
    return (
        ChartOfAccount.objects
        .filter(party_type=party_type, party_id=party_id, location_id__isnull=True)
        .first()
    )


def get_or_create_party_ledger(party_type: str, party_id, *, location_id=None):
    """Resolve (or lazily create) the shared leaf ledger for a party.

    Idempotent and concurrency-safe. Raises ValueError on bad input or when the
    parent group is missing (run seed_coa first).
    """
    from core.models import ChartOfAccount

    if location_id is not None:
        raise ValueError(
            'Party ledgers are shared across locations; pass location_id=None.'
        )
    if party_type not in _PARTY_CFG or not party_id:
        raise ValueError(f'Invalid party for ledger: {party_type!r}/{party_id!r}')

    existing = get_party_ledger(party_type, party_id)
    if existing is not None:
        return existing

    cfg = _PARTY_CFG[party_type]
    group = (
        ChartOfAccount.objects
        .filter(account_code=cfg['group'], location_id__isnull=True)
        .first()
    )
    if group is None:
        raise ValueError(
            f"Parent group {cfg['group']} not found — run `manage.py seed_coa`."
        )
    # First child demotes the group from leaf to a posting group.
    if group.is_leaf:
        group.is_leaf = False
        group.save(update_fields=['is_leaf'])

    try:
        with transaction.atomic():
            acct, _created = ChartOfAccount.objects.get_or_create(
                party_type=party_type,
                party_id=party_id,
                location_id=None,
                defaults={
                    'account_code': party_ledger_code(party_type, party_id),
                    'account_name': _party_name(party_type, party_id),
                    'account_type': cfg['account_type'],
                    'account_subtype': cfg['subtype'],
                    'parent': group,
                    'is_leaf': True,
                    'is_active': True,
                },
            )
        return acct
    except IntegrityError:
        # Lost a create race — the row now exists, re-fetch it.
        return get_party_ledger(party_type, party_id)


def retail_customer_types():
    """customer_type values that do NOT get a proactively-created ledger (B2C /
    walk-in retail). Everything else (B2B, Hospital, Clinic, Corporate, …) is a
    business customer and gets its own ledger. Configurable via
    settings.PARTY_LEDGER_RETAIL_CUSTOMER_TYPES."""
    raw = getattr(settings, 'PARTY_LEDGER_RETAIL_CUSTOMER_TYPES', ('Retail', ''))
    return {str(t).strip().lower() for t in raw}


def provision_all_party_ledgers(*, suppliers=True, customers=True):
    """Idempotently create a ledger for EVERY supplier and every non-retail
    (B2B / institutional) customer in the inventory master.

    Returns {'suppliers_created': n, 'customers_created': n}. Safe to call
    repeatedly — existing ledgers are skipped via a single prefetch, so steady
    state is a couple of queries and no writes. Called automatically from
    sync_all and by the provision_party_ledgers command. Respects the
    PARTY_LEDGERS_ENABLED flag.
    """
    from core.models import ChartOfAccount
    result = {'suppliers_created': 0, 'customers_created': 0}
    if not party_ledgers_enabled():
        return result
    from inventory_reader.models import SupplierRO, CustomerRO

    if suppliers:
        have = set(ChartOfAccount.objects
                   .filter(party_type='Supplier', party_id__isnull=False)
                   .values_list('party_id', flat=True))
        for pid in SupplierRO.objects.values_list('id', flat=True):
            if pid not in have:
                get_or_create_party_ledger('Supplier', pid)
                result['suppliers_created'] += 1

    if customers:
        retail = retail_customer_types()
        have = set(ChartOfAccount.objects
                   .filter(party_type='Customer', party_id__isnull=False)
                   .values_list('party_id', flat=True))
        for cid, ctype in CustomerRO.objects.values_list('id', 'customer_type'):
            if cid in have or (ctype or '').strip().lower() in retail:
                continue
            get_or_create_party_ledger('Customer', cid)
            result['customers_created'] += 1

    return result


def resolve_party_account(party_type, party_id, fallback):
    """The chokepoint posting sites use. Returns the per-party ledger when the
    feature is enabled and the party is concrete; otherwise the fallback control
    account (walk-in/cash, unlinked bills, or flag-off).

    Degrades gracefully: if the per-party ledger can't be resolved/created
    (e.g. the 2105/1125 groups aren't seeded, or the inventory master is
    unreachable), it logs a warning and returns the control account so journal
    posting never crashes. In a correctly-seeded environment this never trips.
    """
    if not party_ledgers_enabled():
        return fallback
    if party_type not in _PARTY_CFG or not party_id:
        return fallback
    try:
        return get_or_create_party_ledger(party_type, party_id)
    except Exception as exc:
        logger.warning(
            'Falling back to control account for %s#%s: %s',
            party_type, party_id, exc,
        )
        return fallback

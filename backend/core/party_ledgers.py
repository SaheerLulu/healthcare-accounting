"""Per-party ledger resolution — the single chokepoint for Tally-style
"Sundry Creditor/Debtor" ledgers (one GL leaf per inventory supplier/customer).

Design (see [[party-ledger-per-party]]):
- Each supplier gets a leaf ledger `2105-S<id>` under group 2105 Sundry Creditors;
  each named customer gets `1125-C<id>` under group 1125 Sundry Debtors.
- The leaf is linked to its inventory party via ChartOfAccount.party_type/party_id
  (a DB-unique pair), NOT by parsing the account_code.
- Party ledgers are PER STORE: each (party, location) gets its own leaf
  (`<group>-<tag><pid>-L<loc>`) under the shared group, so a store's books carry
  only its own balance with that party. The resolver REQUIRES a location_id and
  a UniqueConstraint enforces one leaf per (party, location).
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


def party_ledger_code(party_type: str, party_id: int, location_id: int) -> str:
    cfg = _PARTY_CFG[party_type]
    return f"{cfg['group']}-{cfg['tag']}{party_id}-L{location_id}"


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


def get_party_ledger(party_type: str, party_id, location_id=None):
    """Non-creating lookup of the PER-STORE party leaf. Returns the
    ChartOfAccount leaf or None. `location_id` is required to identify the
    store's leaf (party ledgers are per store)."""
    from core.models import ChartOfAccount
    if party_type not in _PARTY_CFG or not party_id or not location_id:
        return None
    return (
        ChartOfAccount.objects
        .filter(party_type=party_type, party_id=party_id, location_id=location_id)
        .first()
    )


def get_or_create_party_ledger(party_type: str, party_id, *, location_id):
    """Resolve (or lazily create) the PER-STORE leaf ledger for a party.

    Each (party, store) gets its own leaf (code `<group>-<tag><pid>-L<loc>`)
    under the shared group, so a store's books carry only its own balance with
    that party. Idempotent and concurrency-safe. Raises ValueError on bad input
    or when the parent group is missing (run seed_coa first).
    """
    from core.models import ChartOfAccount

    if not location_id:
        raise ValueError('Per-store party ledgers require a location_id.')
    if party_type not in _PARTY_CFG or not party_id:
        raise ValueError(f'Invalid party for ledger: {party_type!r}/{party_id!r}')

    existing = get_party_ledger(party_type, party_id, location_id)
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
                location_id=location_id,
                defaults={
                    'account_code': party_ledger_code(party_type, party_id, location_id),
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
        return get_party_ledger(party_type, party_id, location_id)


def retail_customer_types():
    """customer_type values that do NOT get a proactively-created ledger (B2C /
    walk-in retail). Everything else (B2B, Hospital, Clinic, Corporate, …) is a
    business customer and gets its own ledger. Configurable via
    settings.PARTY_LEDGER_RETAIL_CUSTOMER_TYPES."""
    raw = getattr(settings, 'PARTY_LEDGER_RETAIL_CUSTOMER_TYPES', ('Retail', ''))
    return {str(t).strip().lower() for t in raw}


def provision_all_party_ledgers(*, suppliers=True, customers=True):
    """No-op under per-store party ledgers.

    Pre-creating a leaf for every supplier/customer × every store would explode
    the chart of accounts, so per-store leaves are instead created LAZILY at
    posting time (resolve_party_account) — by the time a party-tagged line is
    posted at a store, its leaf exists. Kept for call-site/flag compatibility
    (sync_all, the provision command); returns zero counts. To split EXISTING
    historical postings into per-store leaves, run
    `manage.py backfill_party_ledgers_per_store`.
    """
    return {'suppliers_created': 0, 'customers_created': 0}


def resolve_party_account(party_type, party_id, fallback, *, location_id=None):
    """The chokepoint posting sites use. Returns the party's PER-STORE ledger
    when the feature is enabled, the party is concrete AND a location is known;
    otherwise the fallback control account (walk-in/cash, unlinked bills, no
    location, or flag-off).

    Degrades gracefully: if the per-store ledger can't be resolved/created
    (e.g. the 2105/1125 groups aren't seeded, or the inventory master is
    unreachable), it logs a warning and returns the control account so journal
    posting never crashes.
    """
    if not party_ledgers_enabled():
        return fallback
    if party_type not in _PARTY_CFG or not party_id or not location_id:
        return fallback
    try:
        return get_or_create_party_ledger(party_type, party_id, location_id=location_id)
    except Exception as exc:
        logger.warning(
            'Falling back to control account for %s#%s @loc%s: %s',
            party_type, party_id, location_id, exc,
        )
        return fallback

"""
Provision for doubtful debts.

Per the Income Tax Act §36(1)(viia) the prescribed provisioning rates only
apply to banks/NBFCs. For ordinary trading concerns the provision is a
matter of accounting prudence (Ind AS 109 ECL). We default to the common
heuristic used by most pharma/healthcare audits:

  • 0–90 days   → 0%
  • 91–180 days → 25%
  • 181–365     → 50%
  • > 365       → 100%

The service computes the *required* provision balance, compares with the
existing balance on the Provision for Doubtful Debts contra-receivable
account, and posts only the delta:

  Dr Bad Debts Expense        delta (if increasing)
      Cr Provision for D/D        delta

If provision is being released (delta negative), the entry reverses.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum

from core.models import AccountMapping
from journals.models import JournalEntry, JournalEntryLine


DEFAULT_BUCKETS = [
    (0,   90,   Decimal('0')),
    (91,  180,  Decimal('25')),
    (181, 365,  Decimal('50')),
    (366, 99999, Decimal('100')),
]


def compute_required_provision(*, as_of: date = None,
                               buckets=None, location_id=None) -> tuple[Decimal, list]:
    """Walk receivables aging and compute the total required provision balance.

    Scoped to `location_id` when given so each store provisions only its own
    receivables (store isolation)."""
    as_of = as_of or date.today()
    buckets = buckets or DEFAULT_BUCKETS

    # Lines on Receivable accounts, posted, with party_type=Customer
    lines = (JournalEntryLine.objects
             .filter(account__account_subtype='Receivable',
                     entry__is_posted=True, entry__date__lte=as_of)
             .select_related('entry'))
    if location_id is not None:
        lines = lines.filter(entry__location_id=location_id)

    # Build per-customer aging
    from collections import defaultdict
    cust_balance = defaultdict(Decimal)
    cust_oldest_invoice_date = {}
    for line in lines:
        net = line.debit - line.credit  # positive = receivable
        cust_balance[line.party_id] += net
        if net > 0:
            current_oldest = cust_oldest_invoice_date.get(line.party_id)
            if not current_oldest or line.entry.date < current_oldest:
                cust_oldest_invoice_date[line.party_id] = line.entry.date

    rows = []
    total_provision = Decimal('0')
    for cust_id, bal in cust_balance.items():
        if bal <= 0:
            continue
        oldest = cust_oldest_invoice_date.get(cust_id, as_of)
        days = (as_of - oldest).days
        # Pick bucket
        rate = Decimal('0')
        for lo, hi, r in buckets:
            if lo <= days <= hi:
                rate = r
                break
        provision = (bal * rate / Decimal('100')).quantize(Decimal('0.01'))
        if provision > 0:
            total_provision += provision
        rows.append({
            'customer_id': cust_id,
            'balance': str(bal),
            'days_outstanding': days,
            'rate_pct': str(rate),
            'provision': str(provision),
        })
    return total_provision, rows


def existing_provision_balance(location_id=None) -> Decimal:
    """Current credit balance on the Provision for Doubtful Debts account.
    Scoped to `location_id` when given (store isolation)."""
    try:
        prov_acct = AccountMapping.get_account('PROVISION_BAD_DEBTS', location_id=location_id)
    except ValueError:
        return Decimal('0')
    qs = JournalEntryLine.objects.filter(account=prov_acct, entry__is_posted=True)
    if location_id is not None:
        qs = qs.filter(entry__location_id=location_id)
    agg = qs.aggregate(d=Sum('debit'), c=Sum('credit'))
    return (agg['c'] or Decimal('0')) - (agg['d'] or Decimal('0'))


@transaction.atomic
def post_provision_adjustment(*, as_of: date = None, location_id: int = None,
                              user=None, narration: str = '') -> dict:
    """
    Compute the required provision, compare with current, and post the delta.
    Returns the computation + JE info.
    """
    as_of = as_of or date.today()
    if location_id is None:
        raise ValueError('location_id is required to post a bad-debts provision (store isolation).')
    required, rows = compute_required_provision(as_of=as_of, location_id=location_id)
    existing = existing_provision_balance(location_id=location_id)
    delta = required - existing

    je_info = None
    if abs(delta) > Decimal('0.005'):
        bd_exp = AccountMapping.get_account('BAD_DEBTS_EXPENSE', location_id=location_id)
        prov = AccountMapping.get_account('PROVISION_BAD_DEBTS', location_id=location_id)
        je = JournalEntry.objects.create(
            date=as_of,
            narration=narration or
                      f'Provision for doubtful debts adjustment as of {as_of}',
            voucher_type='JOURNAL', reference_type='Manual',
            location_id=location_id, created_by=user,
        )
        if delta > 0:
            JournalEntryLine.objects.create(entry=je, account=bd_exp, debit=delta)
            JournalEntryLine.objects.create(entry=je, account=prov, credit=delta)
        else:
            JournalEntryLine.objects.create(entry=je, account=prov, debit=-delta)
            JournalEntryLine.objects.create(entry=je, account=bd_exp, credit=-delta)
        je.post()
        je_info = {'entry_no': je.entry_no, 'amount': str(delta)}

    return {
        'as_of': str(as_of),
        'required_provision': str(required),
        'existing_provision': str(existing),
        'adjustment': str(delta),
        'rows': rows,
        'journal_entry': je_info,
    }

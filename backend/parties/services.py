"""Service layer for the parties feature.

Reads supplier/customer master from inventory_reader (read-only), and aggregates
posted journal entries to compute outstanding balance, transaction history, and
statement of account.
"""
from collections import defaultdict
from decimal import Decimal
from datetime import date

from journals.models import JournalEntryLine
from .models import PartyOpeningBalance


# A line is "settling" (i.e. opposite of an invoice) if it sits on the side
# that reduces the party's outstanding balance.
#   Customer: invoices => Debit on receivable; receipts => Credit on receivable
#   Supplier: bills    => Credit on payable;   payments => Debit on payable
def _signed_open_balance(line, party_type: str) -> Decimal:
    """Net effect of a line on the party's outstanding balance (positive = owed to/by)."""
    if party_type == 'Customer':
        return line.debit - line.credit
    return line.credit - line.debit


def get_opening_balance(party_type: str, party_id: int):
    return (
        PartyOpeningBalance.objects
        .filter(party_type=party_type, party_id=party_id)
        .first()
    )


def opening_balance_map(party_type: str) -> dict:
    """party_id -> (amount, as_of_date) for all stored opening balances of this type."""
    return {
        ob.party_id: (ob.amount, ob.as_of_date)
        for ob in PartyOpeningBalance.objects.filter(party_type=party_type)
    }


def lines_for_party(party_type: str, party_id: int, *, location_id=None,
                    start_date=None, end_date=None):
    qs = (
        JournalEntryLine.objects
        .filter(entry__is_posted=True, party_type=party_type, party_id=party_id)
        # The opening-balance JE is reflected separately via the stored
        # PartyOpeningBalance amount (added arithmetically below); excluding it
        # here keeps the GL ledger card and the tag-based outstanding in sync
        # without double-counting. See parties.opening_balance.
        .exclude(entry__reference_type='PartyOpeningBalance')
        .select_related('entry', 'account')
        .order_by('entry__date', 'entry__id', 'id')
    )
    if location_id:
        qs = qs.filter(entry__location_id=location_id)
    if start_date:
        qs = qs.filter(entry__date__gte=start_date)
    if end_date:
        qs = qs.filter(entry__date__lte=end_date)
    return qs


def party_overview(party_type: str, party_id: int, *, location_id=None) -> dict:
    """Aggregated metrics for the Overview tab and list rows."""
    qs = lines_for_party(party_type, party_id, location_id=location_id)
    total_invoices = Decimal('0.00')
    total_settled = Decimal('0.00')
    outstanding = Decimal('0.00')
    last_txn_date = None
    txn_count = 0

    for line in qs:
        net = _signed_open_balance(line, party_type)
        outstanding += net
        if net > 0:
            total_invoices += net
        elif net < 0:
            total_settled += -net
        if line.entry.voucher_type in ('PURCHASE', 'SALE'):
            txn_count += 1
        if last_txn_date is None or line.entry.date > last_txn_date:
            last_txn_date = line.entry.date

    ob = get_opening_balance(party_type, party_id)
    opening_amount = ob.amount if ob else Decimal('0.00')
    outstanding += opening_amount

    return {
        'total_invoices': str(total_invoices),
        'total_settled': str(total_settled),
        'outstanding': str(outstanding),
        'invoice_count': txn_count,
        'last_transaction_date': last_txn_date.isoformat() if last_txn_date else None,
        'opening_balance': str(opening_amount),
        'opening_balance_as_of': ob.as_of_date.isoformat() if ob else None,
    }


def statement_of_account(party_type: str, party_id: int, *, location_id=None,
                         start_date=None, end_date=None) -> dict:
    """Running-balance statement.

    Opening balance = sum of all lines strictly before start_date (if start_date given),
    otherwise zero.
    """
    ob = get_opening_balance(party_type, party_id)
    stored_opening = ob.amount if ob else Decimal('0.00')
    opening = stored_opening
    if start_date:
        prior = lines_for_party(party_type, party_id, location_id=location_id,
                                end_date=None)
        for line in prior.filter(entry__date__lt=start_date):
            opening += _signed_open_balance(line, party_type)

    rows = []
    running = opening
    qs = lines_for_party(party_type, party_id, location_id=location_id,
                         start_date=start_date, end_date=end_date)

    for line in qs:
        net = _signed_open_balance(line, party_type)
        running += net
        if party_type == 'Customer':
            debit = line.debit
            credit = line.credit
        else:
            # Flip for supplier so the statement reads from the supplier's perspective:
            # invoices show in the credit column, payments in the debit column.
            debit = line.credit
            credit = line.debit
        rows.append({
            'date': line.entry.date.isoformat(),
            'entry_no': line.entry.entry_no,
            'voucher_type': line.entry.voucher_type,
            'reference_type': line.entry.reference_type,
            'reference_id': line.entry.reference_id,
            'narration': line.entry.narration or line.narration,
            'debit': str(debit),
            'credit': str(credit),
            'balance': str(running),
        })

    return {
        'party_type': party_type,
        'party_id': party_id,
        'start_date': start_date.isoformat() if start_date else None,
        'end_date': end_date.isoformat() if end_date else None,
        'opening_balance': str(opening),
        'stored_opening_balance': str(stored_opening),
        'opening_balance_as_of': ob.as_of_date.isoformat() if ob else None,
        'closing_balance': str(running),
        'rows': rows,
    }


def transaction_list(party_type: str, party_id: int, *, location_id=None,
                     start_date=None, end_date=None) -> list:
    """One row per journal entry (deduplicated; multiple lines per entry collapsed)."""
    qs = lines_for_party(party_type, party_id, location_id=location_id,
                         start_date=start_date, end_date=end_date)
    by_entry = {}
    for line in qs:
        e = line.entry
        bucket = by_entry.setdefault(e.id, {
            'entry_id': e.id,
            'date': e.date.isoformat(),
            'entry_no': e.entry_no,
            'voucher_type': e.voucher_type,
            'reference_type': e.reference_type,
            'reference_id': e.reference_id,
            'narration': e.narration,
            'debit': Decimal('0.00'),
            'credit': Decimal('0.00'),
        })
        bucket['debit'] += line.debit
        bucket['credit'] += line.credit

    rows = []
    for b in by_entry.values():
        amount = b['debit'] if b['debit'] else b['credit']
        b['amount'] = str(amount)
        b['debit'] = str(b['debit'])
        b['credit'] = str(b['credit'])
        rows.append(b)
    rows.sort(key=lambda r: (r['date'], r['entry_no']), reverse=True)
    return rows


def list_parties(party_type: str, *, location_id=None, search: str = '') -> list:
    """List all suppliers or customers from inventory with rolled-up balance metrics."""
    from inventory_reader.models import SupplierRO, CustomerRO

    if party_type == 'Supplier':
        qs = SupplierRO.objects.all()
        if location_id:
            qs = qs.filter(location_id=location_id)
        if search:
            qs = qs.filter(company_name__icontains=search)
        qs = qs.order_by('company_name')
    else:
        qs = CustomerRO.objects.all()
        if location_id:
            qs = qs.filter(location_id=location_id)
        if search:
            qs = qs.filter(customer_name__icontains=search)
        qs = qs.order_by('customer_name')

    # One pass over journal lines, then map back to parties. Exclude the
    # opening-balance JE — it's already counted via the stored OB amount below.
    journal_qs = (
        JournalEntryLine.objects
        .filter(entry__is_posted=True, party_type=party_type)
        .exclude(entry__reference_type='PartyOpeningBalance')
        .select_related('entry')
    )
    if location_id:
        journal_qs = journal_qs.filter(entry__location_id=location_id)

    balance_map = defaultdict(Decimal)
    invoice_count_map = defaultdict(int)
    last_date_map = {}
    for line in journal_qs:
        balance_map[line.party_id] += _signed_open_balance(line, party_type)
        if line.entry.voucher_type in ('PURCHASE', 'SALE'):
            invoice_count_map[line.party_id] += 1
        if line.party_id not in last_date_map or line.entry.date > last_date_map[line.party_id]:
            last_date_map[line.party_id] = line.entry.date

    ob_map = opening_balance_map(party_type)
    for pid, (amount, _as_of) in ob_map.items():
        balance_map[pid] += amount

    rows = []
    for p in qs:
        if party_type == 'Supplier':
            base = {
                'id': p.id,
                'name': p.company_name,
                'gst_no': p.gst_no,
                'phone': p.phone,
                'email': p.email,
                'city': p.city,
                'state': p.state,
                'status': p.status,
            }
        else:
            base = {
                'id': p.id,
                'name': p.customer_name,
                'gst_no': p.gst_no,
                'phone': p.phone,
                'email': p.email,
                'city': p.city,
                'state': p.state,
                'status': p.status,
                'customer_type': p.customer_type,
            }
        last_dt = last_date_map.get(p.id)
        ob = ob_map.get(p.id)
        base.update({
            'outstanding': str(balance_map.get(p.id, Decimal('0.00'))),
            'invoice_count': invoice_count_map.get(p.id, 0),
            'last_transaction_date': last_dt.isoformat() if last_dt else None,
            'opening_balance': str(ob[0]) if ob else '0.00',
            'opening_balance_as_of': ob[1].isoformat() if ob else None,
        })
        rows.append(base)
    return rows

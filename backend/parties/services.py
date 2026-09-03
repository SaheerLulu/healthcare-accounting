"""Service layer for the parties feature.

Reads supplier/customer master from inventory_reader (read-only), and aggregates
posted journal entries to compute outstanding balance, transaction history, and
statement of account.
"""
from collections import defaultdict
from decimal import Decimal
from datetime import date

from django.db.models import Q

from journals.models import JournalEntryLine
from .models import PartyOpeningBalance
from .opening_balance import OPENING_BALANCE_REFERENCE


# The control-account subtype that carries a party's outstanding balance. Party
# ledgers copy the control's subtype (core.party_ledgers._PARTY_CFG), so this
# holds with PARTY_LEDGERS_ENABLED either way.
BALANCE_SUBTYPE = {'Supplier': 'Payable', 'Customer': 'Receivable'}


# A line is "settling" (i.e. opposite of an invoice) if it sits on the side
# that reduces the party's outstanding balance.
#   Customer: invoices => Debit on receivable; receipts => Credit on receivable
#   Supplier: bills    => Credit on payable;   payments => Debit on payable
def _signed(debit: Decimal, credit: Decimal, party_type: str) -> Decimal:
    if party_type == 'Customer':
        return debit - credit
    return credit - debit


def _signed_open_balance(line, party_type: str) -> Decimal:
    """Net effect of a line on the party's outstanding balance (positive = owed to/by)."""
    return _signed(line.debit, line.credit, party_type)


def _resolve_as_of(as_of):
    """Reports default their as-of date to today; parties must do the same or a
    post-dated voucher shows here and nowhere else."""
    return as_of or date.today()


def opening_balance_rows(party_type: str, *, party_id=None, location_id=None, as_of=None):
    """Stored opening-balance rows in scope for a balance computation.

    PartyOpeningBalance is unique per (party_type, party_id, location_id), so a
    party trading in two stores has TWO rows. Reading them unscoped returned
    whichever row sorted first by pk — the OLDEST store's — while the journal
    aggregate it was added to WAS store-filtered, so the two halves of one
    number came from different stores. Scope both halves identically:
      location_id given -> that store's row, plus legacy rows (migration 0005
        added location_id NULLABLE with no backfill; post_opening_balance_je
        refuses to post a GL counterpart for a NULL-location row, so those can
        only ever be counted arithmetically here — dropping them would turn
        today's overstatement into a silent understatement);
      location_id None  -> every store's row, summed (the consolidated view).
    """
    qs = PartyOpeningBalance.objects.filter(party_type=party_type)
    if party_id is not None:
        qs = qs.filter(party_id=party_id)
    if location_id:
        qs = qs.filter(Q(location_id=location_id) | Q(location_id__isnull=True))
    if as_of is not None:
        # The GL counterpart JE is dated as_of_date, so an as-of-capped report
        # drops it; cap the arithmetic addition the same way or the two diverge.
        qs = qs.filter(as_of_date__lte=as_of)
    return qs


def get_opening_balance(party_type: str, party_id: int, *, location_id=None, as_of=None):
    """(amount, as_of_date) for one party — summed across stores when unscoped.

    The stored amount is added arithmetically by every caller AND the OB journal
    entry is excluded from the tag aggregation (see parties.opening_balance), so
    this is counted exactly once whether or not the GL counterpart was posted —
    which is what keeps the figure alive under PARTY_LEDGERS_ENABLED=False,
    where no OB journal entry is ever created.
    """
    total = Decimal('0.00')
    latest = None
    for ob in opening_balance_rows(party_type, party_id=party_id,
                                   location_id=location_id, as_of=as_of):
        total += ob.amount
        if latest is None or ob.as_of_date > latest:
            latest = ob.as_of_date
    return total, latest


def opening_balance_map(party_type: str, *, location_id=None, as_of=None) -> dict:
    """party_id -> (amount, as_of_date), summed per party over the stores in scope."""
    out = {}
    for ob in opening_balance_rows(party_type, location_id=location_id, as_of=as_of):
        amount, latest = out.get(ob.party_id, (Decimal('0.00'), None))
        out[ob.party_id] = (
            amount + ob.amount,
            ob.as_of_date if latest is None or ob.as_of_date > latest else latest,
        )
    return out


def lines_for_party(party_type: str, party_id: int, *, location_id=None,
                    start_date=None, end_date=None):
    qs = (
        JournalEntryLine.objects
        .filter(entry__is_posted=True, party_type=party_type, party_id=party_id)
        # The opening-balance JE is reflected separately via the stored
        # PartyOpeningBalance amount (added arithmetically below); excluding it
        # here keeps the GL ledger card and the tag-based outstanding in sync
        # without double-counting. See parties.opening_balance.
        .exclude(entry__reference_type=OPENING_BALANCE_REFERENCE)
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


def balance_lines(party_type: str, party_id=None, *, location_id=None, as_of=None):
    """The lines that COUNT toward a party's outstanding balance.

    Deliberately narrower than lines_for_party, and deliberately NOT folded into
    it: lines_for_party also backs the Transactions register and the Statement,
    where an optional voucher must still be VISIBLE (Tally shows it, it just
    doesn't count it). Only the aggregation sites use this.

    Same four predicates as every other outstanding surface — reports.views AR/
    AP + aging, the dashboard KPIs, ChartOfAccount.get_balance:
      - posted, non-optional, non-memorandum (optional/memo don't affect books)
      - on the party's control account, via account_subtype. Parties used to
        count the party TAG alone, so a supplier-tagged line on any other
        account moved this figure while Payables never saw it — and the repo
        ships exactly that shape: cleanup_untagged_manual_jvs tags the EXPENSE
        debit as well as the payable credit, which netted a bill to zero here.
        The subtype cut also excludes 1310 Advance to Suppliers from the net;
        that is the intended reading (an advance is an asset, not a reduction
        of the creditor) and matches Payables.
      - capped at an as-of date, so post-dated vouchers don't inflate the figure
        ahead of the reports.
    """
    qs = (
        JournalEntryLine.objects
        .filter(
            entry__is_posted=True,
            entry__is_optional=False,
            entry__is_memorandum=False,
            entry__date__lte=_resolve_as_of(as_of),
            party_type=party_type,
            account__account_subtype=BALANCE_SUBTYPE[party_type],
        )
        # The opening-balance JE is reflected separately via the stored
        # PartyOpeningBalance amount — see lines_for_party.
        .exclude(entry__reference_type=OPENING_BALANCE_REFERENCE)
    )
    if party_id is not None:
        qs = qs.filter(party_id=party_id)
    if location_id:
        qs = qs.filter(entry__location_id=location_id)
    return qs


def party_overview(party_type: str, party_id: int, *, location_id=None,
                   as_of=None) -> dict:
    """Aggregated metrics for the Overview tab and list rows."""
    as_of = _resolve_as_of(as_of)
    qs = balance_lines(party_type, party_id, location_id=location_id, as_of=as_of)
    total_invoices = Decimal('0.00')
    total_settled = Decimal('0.00')
    outstanding = Decimal('0.00')
    last_txn_date = None
    txn_count = 0

    for row in qs.values('debit', 'credit', 'entry__date', 'entry__voucher_type'):
        net = _signed(row['debit'], row['credit'], party_type)
        outstanding += net
        if net > 0:
            total_invoices += net
        elif net < 0:
            total_settled += -net
        if row['entry__voucher_type'] in ('PURCHASE', 'SALE'):
            txn_count += 1
        if last_txn_date is None or row['entry__date'] > last_txn_date:
            last_txn_date = row['entry__date']

    opening_amount, opening_as_of = get_opening_balance(
        party_type, party_id, location_id=location_id, as_of=as_of)
    outstanding += opening_amount

    return {
        'total_invoices': str(total_invoices),
        'total_settled': str(total_settled),
        'outstanding': str(outstanding),
        'invoice_count': txn_count,
        'last_transaction_date': last_txn_date.isoformat() if last_txn_date else None,
        'opening_balance': str(opening_amount),
        'opening_balance_as_of': opening_as_of.isoformat() if opening_as_of else None,
    }


def statement_of_account(party_type: str, party_id: int, *, location_id=None,
                         start_date=None, end_date=None) -> dict:
    """Running-balance statement.

    Opening balance = sum of all lines strictly before start_date (if start_date given),
    otherwise zero.
    """
    # Store-scoped like the lines below it — an unscoped read here handed the
    # statement one store's opening figure on top of another store's movements.
    # No as-of cap: the statement carries its own window.
    stored_opening, stored_as_of = get_opening_balance(
        party_type, party_id, location_id=location_id)
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
        'opening_balance_as_of': stored_as_of.isoformat() if stored_as_of else None,
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


def _party_master_in_store(location_id):
    """Which inventory party-master rows belong to a store's list.

    The store's own rows PLUS the store-less ones. `location` is nullable on
    both masters and the shared counterparties every store trades with — the
    'Unregistered Supplier' / walk-in customer rows the pharmacy auto-creates —
    are exactly the ones left NULL. Filtering on `location_id=` alone dropped
    them from Parties, so a supplier that HAD an outstanding balance in this
    store (the balance aggregate below scopes by the ENTRY's location, not the
    master row's) had no row to show it on, and no way to reach a payment from.
    Same widening as the Cash Book's per-store ledger filter.
    """
    return Q(location_id=location_id) | Q(location_id__isnull=True)


def list_parties(party_type: str, *, location_id=None, search: str = '',
                 as_of=None, customer_type: str = '') -> list:
    """List all suppliers or customers from inventory with rolled-up balance metrics.

    `customer_type` filters the Customer list to one or more inventory types
    (comma-separated, e.g. 'Hospital,B2B' — the same shape the pharmacy
    customer API accepts). Ignored for suppliers, which have no such field.
    """
    from inventory_reader.models import SupplierRO, CustomerRO

    as_of = _resolve_as_of(as_of)

    # The pharmacy represents each store as a Customer ('STORE-{n}') and a
    # Supplier ('Store: <name>') so an indent transfer can be a B2B sale on
    # one side and a GRN on the other. Those rows are flagged is_internal and
    # are not counterparties of the business: a transfer posts as a stock
    # relocation (Closing Stock <-> Stock in Transit, see
    # JournalAutoGenerationService.generate_stock_transfer), never as AR/AP,
    # so listing them here showed a permanent 0.00 that no transfer could
    # ever move. The pharmacy's own registers hide them the same way.
    if party_type == 'Supplier':
        qs = SupplierRO.objects.filter(is_internal=False)
        if location_id:
            qs = qs.filter(_party_master_in_store(location_id))
        if search:
            qs = qs.filter(company_name__icontains=search)
        qs = qs.order_by('company_name')
    else:
        qs = CustomerRO.objects.filter(is_internal=False)
        if location_id:
            qs = qs.filter(_party_master_in_store(location_id))
        if search:
            qs = qs.filter(customer_name__icontains=search)
        wanted = [t.strip() for t in (customer_type or '').split(',') if t.strip()]
        if wanted:
            qs = qs.filter(customer_type__in=wanted)
        qs = qs.order_by('customer_name')

    # One pass over the balance-relevant journal lines, then map back to
    # parties. Same predicates as party_overview — the list row and the detail
    # header must not be computed two different ways.
    journal_qs = balance_lines(party_type, location_id=location_id, as_of=as_of)

    balance_map = defaultdict(Decimal)
    invoice_count_map = defaultdict(int)
    last_date_map = {}
    for row in journal_qs.values('party_id', 'debit', 'credit',
                                 'entry__date', 'entry__voucher_type'):
        pid = row['party_id']
        balance_map[pid] += _signed(row['debit'], row['credit'], party_type)
        if row['entry__voucher_type'] in ('PURCHASE', 'SALE'):
            invoice_count_map[pid] += 1
        if pid not in last_date_map or row['entry__date'] > last_date_map[pid]:
            last_date_map[pid] = row['entry__date']

    ob_map = opening_balance_map(party_type, location_id=location_id, as_of=as_of)
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

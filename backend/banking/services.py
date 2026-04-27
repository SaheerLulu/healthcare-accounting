"""Banking service layer — statement import, match suggestions, and reconciliation actions."""
import csv
import io
from datetime import date as date_cls, timedelta
from django.utils import timezone
from decimal import Decimal, InvalidOperation
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from journals.models import JournalEntry, JournalEntryLine
from journals.services import JournalAutoGenerationService

from .models import BankAccount, BankTransaction


# ─── CSV import ─────────────────────────────────────────────────────────────

DATE_FORMATS = [
    '%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y',
    '%d/%m/%y', '%d-%m-%y',
    '%m/%d/%Y',
]


def _parse_date(value: str):
    from datetime import datetime
    value = (value or '').strip()
    if not value:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValidationError(f'Could not parse date "{value}". Use ISO (YYYY-MM-DD) or DD/MM/YYYY.')


def _parse_amount(value: str) -> Decimal:
    value = (value or '').strip().replace(',', '').replace('₹', '')
    if not value:
        return Decimal('0.00')
    try:
        return Decimal(value)
    except (InvalidOperation, ValueError):
        raise ValidationError(f'Invalid amount "{value}".')


def _resolve_columns(headers: list[str]) -> dict:
    """Map known column-name aliases to canonical keys."""
    aliases = {
        'date': ['date', 'transaction date', 'txn date', 'value date'],
        'description': ['description', 'narration', 'particulars', 'details', 'remarks'],
        'reference': ['reference', 'ref no', 'cheque no', 'utr', 'transaction id', 'ref'],
        'debit': ['debit', 'withdrawal', 'withdrawals', 'dr', 'amount out', 'paid out'],
        'credit': ['credit', 'deposit', 'deposits', 'cr', 'amount in', 'paid in'],
        'amount': ['amount'],   # signed single column (positive in, negative out)
        'balance': ['balance', 'running balance', 'closing balance'],
    }
    lower = [h.strip().lower() for h in headers]
    out = {}
    for canonical, names in aliases.items():
        for n in names:
            if n in lower:
                out[canonical] = lower.index(n)
                break
    return out


@transaction.atomic
def import_csv(account: BankAccount, raw_bytes: bytes, *, user=None) -> dict:
    """Parse and persist transactions from a CSV bank statement.

    Returns {'imported': N, 'duplicates': M, 'errors': [...]}.
    Duplicates are skipped using the (account, date, amount, description) constraint.
    """
    text = raw_bytes.decode('utf-8-sig', errors='replace')
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=',;|\t')
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    rows = list(reader)
    if not rows:
        raise ValidationError('CSV file is empty.')

    headers = rows[0]
    cols = _resolve_columns(headers)
    if 'date' not in cols:
        raise ValidationError('CSV must include a Date column. Found: ' + ', '.join(headers))
    if 'amount' not in cols and not ('debit' in cols or 'credit' in cols):
        raise ValidationError('CSV must include either an Amount column or Debit + Credit columns.')

    imported = 0
    duplicates = 0
    errors: list[str] = []
    now = timezone.now()

    for line_no, row in enumerate(rows[1:], start=2):
        if not any((c or '').strip() for c in row):
            continue
        try:
            txn_date = _parse_date(row[cols['date']])
            description = row[cols['description']].strip() if 'description' in cols and len(row) > cols['description'] else ''
            reference = row[cols['reference']].strip() if 'reference' in cols and len(row) > cols['reference'] else ''
            balance = None
            if 'balance' in cols and len(row) > cols['balance']:
                bal_raw = row[cols['balance']].strip()
                if bal_raw:
                    balance = _parse_amount(bal_raw)

            if 'amount' in cols:
                amount = _parse_amount(row[cols['amount']])
            else:
                debit = _parse_amount(row[cols['debit']]) if 'debit' in cols and len(row) > cols['debit'] else Decimal('0.00')
                credit = _parse_amount(row[cols['credit']]) if 'credit' in cols and len(row) > cols['credit'] else Decimal('0.00')
                # Statement convention: debit = money out, credit = money in.
                amount = credit - debit

            if amount == 0:
                continue

            try:
                BankTransaction.objects.create(
                    bank_account=account,
                    date=txn_date,
                    description=description,
                    reference=reference,
                    amount=amount,
                    running_balance=balance,
                    status='unmatched',
                    source='imported',
                    imported_at=now,
                    created_by=user,
                )
                imported += 1
            except Exception as exc:
                # Treat unique-constraint violation as duplicate; anything else bubbles
                if 'banking_transaction_dedupe' in str(exc) or 'UNIQUE' in str(exc).upper():
                    duplicates += 1
                else:
                    errors.append(f'Line {line_no}: {exc}')
        except ValidationError as e:
            errors.append(f'Line {line_no}: {e.messages[0] if hasattr(e, "messages") else e}')

    return {'imported': imported, 'duplicates': duplicates, 'errors': errors}


# ─── Match suggestions ─────────────────────────────────────────────────────

def find_match_suggestions(txn: BankTransaction, *, days_window: int = 7, limit: int = 5) -> list[dict]:
    """Return candidate journal entries that could explain this bank transaction.

    Heuristic: same absolute amount on the matching side of the bank GL account,
    posted, within ±days_window of the transaction date, and not already matched
    to another bank transaction. Closer dates rank higher.
    """
    bank_acct = txn.bank_account.chart_account
    abs_amt = abs(txn.amount)
    start = txn.date - timedelta(days=days_window)
    end = txn.date + timedelta(days=days_window)

    # Money in (positive amount on statement) → bank GL account has Debit > 0 on the JE line.
    # Money out (negative) → bank GL account has Credit > 0.
    if txn.amount > 0:
        line_filter = Q(account=bank_acct, debit=abs_amt, credit=0)
    else:
        line_filter = Q(account=bank_acct, credit=abs_amt, debit=0)

    matched_je_ids = BankTransaction.objects.exclude(id=txn.id).filter(
        matched_journal_entry__isnull=False
    ).values_list('matched_journal_entry_id', flat=True)

    candidates = (
        JournalEntryLine.objects
        .filter(line_filter, entry__is_posted=True,
                entry__date__gte=start, entry__date__lte=end)
        .exclude(entry_id__in=matched_je_ids)
        .select_related('entry', 'entry__created_by')
    )

    seen = {}
    for line in candidates:
        e = line.entry
        if e.id in seen:
            continue
        days = abs((e.date - txn.date).days)
        seen[e.id] = {
            'entry_id': e.id,
            'entry_no': e.entry_no,
            'date': e.date.isoformat(),
            'voucher_type': e.voucher_type,
            'narration': e.narration,
            'amount': str(abs_amt),
            'days_off': days,
        }

    suggestions = sorted(seen.values(), key=lambda r: r['days_off'])[:limit]
    return suggestions


# ─── Match / unmatch / exclude ─────────────────────────────────────────────

@transaction.atomic
def match_transaction(txn: BankTransaction, journal_entry: JournalEntry):
    """Link a bank transaction to a posted journal entry."""
    if txn.status == 'excluded':
        raise ValidationError('Transaction is excluded — un-exclude first.')
    if not journal_entry.is_posted:
        raise ValidationError('Cannot match to a draft journal entry.')
    # Sanity: the JE must touch the bank account on the right side
    bank_acct = txn.bank_account.chart_account
    abs_amt = abs(txn.amount)
    if txn.amount > 0:
        valid = journal_entry.lines.filter(account=bank_acct, debit=abs_amt).exists()
    else:
        valid = journal_entry.lines.filter(account=bank_acct, credit=abs_amt).exists()
    if not valid:
        raise ValidationError(
            f"Journal entry doesn't have a {'debit' if txn.amount > 0 else 'credit'} of "
            f"{abs_amt} on {bank_acct.account_code} — refusing to match."
        )
    txn.matched_journal_entry = journal_entry
    txn.status = 'matched'
    txn.save(update_fields=['matched_journal_entry', 'status', 'updated_at'])
    return txn


@transaction.atomic
def unmatch_transaction(txn: BankTransaction):
    txn.matched_journal_entry = None
    txn.status = 'unmatched'
    txn.save(update_fields=['matched_journal_entry', 'status', 'updated_at'])
    return txn


@transaction.atomic
def set_excluded(txn: BankTransaction, excluded: bool = True):
    if excluded:
        if txn.status == 'matched' and txn.matched_journal_entry_id:
            raise ValidationError('Unmatch this transaction before excluding it.')
        txn.status = 'excluded'
    else:
        txn.status = 'unmatched'
    txn.save(update_fields=['status', 'updated_at'])
    return txn


# ─── Categorize (create JE on the fly) ─────────────────────────────────────

@transaction.atomic
def categorize_transaction(txn: BankTransaction, *, account_id: int,
                           party_type: str = '', party_id: int | None = None,
                           narration: str = '', user=None) -> JournalEntry:
    """Generate a balanced journal entry for this bank transaction and auto-match it.

    For money in (txn.amount > 0): Dr Bank, Cr `account_id`.
    For money out (txn.amount < 0): Dr `account_id`, Cr Bank.
    Optional party_type/party_id let receivable/payable lines stay tagged for outstanding tracking.
    """
    if txn.status == 'matched' and txn.matched_journal_entry_id:
        raise ValidationError('Already matched — unmatch first to re-categorize.')
    if txn.status == 'excluded':
        raise ValidationError('Excluded — un-exclude first to categorize.')

    from core.models import ChartOfAccount
    other = ChartOfAccount.objects.get(pk=account_id)
    bank_gl = txn.bank_account.chart_account
    abs_amt = abs(txn.amount)

    voucher_type = 'RECEIPT' if txn.amount > 0 else 'PAYMENT'
    label = txn.description or ('Receipt' if txn.amount > 0 else 'Payment')

    entry = JournalEntry.objects.create(
        date=txn.date,
        narration=narration or f"{label} via {txn.bank_account.name}",
        voucher_type=voucher_type,
        reference_type='Manual',
        location_id=txn.bank_account.location_id,
        created_by=user,
    )

    if txn.amount > 0:
        # Receipt: Dr Bank, Cr other account
        JournalEntryLine.objects.create(entry=entry, account=bank_gl, debit=abs_amt)
        line2 = dict(entry=entry, account=other, credit=abs_amt)
    else:
        # Payment: Dr other account, Cr Bank
        line2 = dict(entry=entry, account=other, debit=abs_amt)
        JournalEntryLine.objects.create(entry=entry, account=bank_gl, credit=abs_amt)

    if party_type in ('Customer', 'Supplier') and party_id:
        line2['party_type'] = party_type
        line2['party_id'] = party_id
    JournalEntryLine.objects.create(**line2)
    entry.post()

    txn.matched_journal_entry = entry
    txn.status = 'matched'
    txn.save(update_fields=['matched_journal_entry', 'status', 'updated_at'])
    return entry


# ─── Balances ──────────────────────────────────────────────────────────────

def book_balance(account: BankAccount) -> Decimal:
    """Net balance from posted journal entry lines on the linked GL account."""
    from django.db.models import Sum
    agg = JournalEntryLine.objects.filter(
        account=account.chart_account, entry__is_posted=True
    ).aggregate(dr=Sum('debit'), cr=Sum('credit'))
    return (agg['dr'] or Decimal('0.00')) - (agg['cr'] or Decimal('0.00'))


def statement_balance(account: BankAccount) -> Decimal:
    """Sum of all imported transactions on this account (running)."""
    from django.db.models import Sum
    agg = account.transactions.aggregate(s=Sum('amount'))
    return (account.opening_balance or Decimal('0.00')) + (agg['s'] or Decimal('0.00'))

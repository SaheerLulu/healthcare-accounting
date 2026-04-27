"""Bills service layer — turns Bill / BillPayment records into journal entries.

A bill is created in 'draft' status with line items (and optional GST). When the
user "approves" it, this service generates a balanced journal entry crediting the
Trade Payables account and debiting each line's expense account plus any tax
inputs. Status moves draft → open. Recording a payment generates another journal
entry (Dr Payables, Cr Bank/Cash) and updates amount_paid + status.
"""
from calendar import monthrange
from datetime import date as date_cls, timedelta
from decimal import Decimal
from django.db import transaction
from django.core.exceptions import ValidationError

from core.models import AccountMapping
from journals.models import JournalEntry, JournalEntryLine
from .models import Bill, BillLine, BillPayment, RecurringBill


def _acct(key: str):
    return AccountMapping.get_account(key)


@transaction.atomic
def post_bill(bill: Bill, user=None) -> JournalEntry:
    """Post a draft bill: create JE, link it, advance status to 'open'."""
    if bill.journal_entry_id is not None:
        raise ValidationError('Bill is already posted.')
    if bill.status == 'cancelled':
        raise ValidationError('Cancelled bills cannot be posted.')
    lines = list(bill.lines.all())
    if not lines:
        raise ValidationError('Add at least one line item before approving.')

    line_total = sum((l.amount for l in lines), Decimal('0.00'))
    tax_total = (bill.tax_cgst or Decimal('0.00')) + (bill.tax_sgst or Decimal('0.00')) + (bill.tax_igst or Decimal('0.00'))
    expected = line_total + tax_total
    # Trust user-entered total for reconciliation; expected is for sanity.
    if bill.total_amount <= 0:
        raise ValidationError('Bill total must be greater than zero.')

    entry = JournalEntry.objects.create(
        date=bill.bill_date,
        narration=f"Bill {bill.bill_no or '#' + str(bill.id)} — {bill.vendor_name}",
        voucher_type='PURCHASE',
        reference_type='Manual',
        location_id=bill.location_id,
        created_by=user,
    )

    # Debit each expense line
    for line in lines:
        if line.amount <= 0:
            continue
        JournalEntryLine.objects.create(
            entry=entry,
            account=line.account,
            debit=line.amount,
            narration=line.description,
        )

    # Debit GST inputs (if any)
    if bill.tax_cgst > 0:
        JournalEntryLine.objects.create(entry=entry, account=_acct('INPUT_CGST'), debit=bill.tax_cgst)
    if bill.tax_sgst > 0:
        JournalEntryLine.objects.create(entry=entry, account=_acct('INPUT_SGST'), debit=bill.tax_sgst)
    if bill.tax_igst > 0:
        JournalEntryLine.objects.create(entry=entry, account=_acct('INPUT_IGST'), debit=bill.tax_igst)

    # Credit Trade Payables
    payable_args = dict(entry=entry, account=_acct('TRADE_PAYABLES'), credit=bill.total_amount)
    if bill.vendor_id:
        payable_args.update(party_type='Supplier', party_id=bill.vendor_id)
    JournalEntryLine.objects.create(**payable_args)

    # Adjust for any rounding difference between (lines + tax) and total
    diff = bill.total_amount - (line_total + tax_total)
    if diff != 0:
        # Post the rounding to ROUND_OFF so the entry balances
        try:
            round_acct = _acct('ROUND_OFF')
        except ValueError:
            # If ROUND_OFF isn't mapped, force the user to fix the totals
            entry.delete()
            raise ValidationError(
                f'Bill total {bill.total_amount} does not equal lines {line_total} + tax {tax_total} '
                f'and ROUND_OFF account is not mapped. Fix totals or configure ROUND_OFF mapping.'
            )
        if diff > 0:
            JournalEntryLine.objects.create(entry=entry, account=round_acct, debit=diff)
        else:
            JournalEntryLine.objects.create(entry=entry, account=round_acct, credit=-diff)

    entry.post()

    bill.journal_entry = entry
    bill.status = bill.recalc_status()
    bill.save(update_fields=['journal_entry', 'status', 'updated_at'])
    return entry


@transaction.atomic
def record_payment(bill: Bill, *, date, amount, mode='bank',
                   reference='', notes='', user=None) -> BillPayment:
    """Record a payment against a posted bill and create the matching JE."""
    if bill.status == 'cancelled':
        raise ValidationError('Cannot pay a cancelled bill.')
    if bill.journal_entry_id is None:
        raise ValidationError('Approve the bill before recording a payment.')

    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValidationError('Payment amount must be greater than zero.')
    if amount > bill.balance_due + Decimal('0.005'):
        raise ValidationError(
            f'Payment {amount} exceeds outstanding balance {bill.balance_due}.'
        )

    pay_entry = JournalEntry.objects.create(
        date=date,
        narration=f"Payment for bill {bill.bill_no or '#' + str(bill.id)} — {bill.vendor_name}",
        voucher_type='PAYMENT',
        reference_type='Manual',
        location_id=bill.location_id,
        created_by=user,
    )

    # Debit Trade Payables (matched to the same vendor for outstanding tracking)
    payable_args = dict(entry=pay_entry, account=_acct('TRADE_PAYABLES'), debit=amount)
    if bill.vendor_id:
        payable_args.update(party_type='Supplier', party_id=bill.vendor_id)
    JournalEntryLine.objects.create(**payable_args)

    # Credit Bank or Cash
    credit_acct = _acct('BANK') if mode == 'bank' else _acct('CASH')
    JournalEntryLine.objects.create(entry=pay_entry, account=credit_acct, credit=amount)

    pay_entry.post()

    payment = BillPayment.objects.create(
        bill=bill, date=date, amount=amount, mode=mode,
        reference=reference, notes=notes,
        journal_entry=pay_entry, created_by=user,
    )

    bill.amount_paid = (bill.amount_paid or Decimal('0.00')) + amount
    bill.status = bill.recalc_status()
    bill.save(update_fields=['amount_paid', 'status', 'updated_at'])
    return payment


# ─── Recurring bills ────────────────────────────────────────────────────────

def _add_months(d: date_cls, n: int) -> date_cls:
    month = d.month - 1 + n
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date_cls(year, month, day)


def advance_date(d: date_cls, frequency: str) -> date_cls:
    if frequency == 'daily':
        return d + timedelta(days=1)
    if frequency == 'weekly':
        return d + timedelta(days=7)
    if frequency == 'monthly':
        return _add_months(d, 1)
    if frequency == 'quarterly':
        return _add_months(d, 3)
    if frequency == 'yearly':
        return _add_months(d, 12)
    raise ValueError(f'Unknown frequency: {frequency}')


def _format_bill_no(pattern: str, d: date_cls, seq: int) -> str:
    if not pattern:
        return ''
    return (pattern
            .replace('{YYYY-MM}', d.strftime('%Y-%m'))
            .replace('{YYYY}', d.strftime('%Y'))
            .replace('{MM}', d.strftime('%m'))
            .replace('{DD}', d.strftime('%d'))
            .replace('{MON}', d.strftime('%b').upper())
            .replace('{SEQ}', f'{seq:04d}'))


@transaction.atomic
def generate_one(rb: RecurringBill, *, user=None) -> Bill:
    """Create a single Bill from this recurring template at rb.next_run_date.

    Advances next_run_date and stops the profile if past end_date.
    """
    if rb.status != 'active':
        raise ValidationError(f'Recurring bill is {rb.status}, not active.')
    items = list(rb.items.all())
    if not items:
        raise ValidationError('Add at least one line item to the recurring profile.')

    bill_date = rb.next_run_date
    due_date = bill_date + timedelta(days=rb.due_days or 30)

    seq = Bill.objects.filter(notes__contains=f'recurring:{rb.id}').count() + 1
    bill_no = _format_bill_no(rb.bill_no_pattern, bill_date, seq) or ''

    notes_parts = [f'Auto-generated from recurring profile "{rb.profile_name}" (recurring:{rb.id})']
    if rb.notes:
        notes_parts.append(rb.notes)

    bill = Bill.objects.create(
        bill_no=bill_no,
        bill_date=bill_date,
        due_date=due_date,
        vendor_id=rb.vendor_id,
        vendor_name=rb.vendor_name,
        subtotal=rb.subtotal,
        tax_cgst=rb.tax_cgst,
        tax_sgst=rb.tax_sgst,
        tax_igst=rb.tax_igst,
        total_amount=rb.total_amount,
        notes='\n'.join(notes_parts),
        location_id=rb.location_id,
        created_by=user,
    )
    for it in items:
        BillLine.objects.create(
            bill=bill, account=it.account,
            description=it.description, amount=it.amount,
        )

    if rb.auto_approve:
        try:
            post_bill(bill, user=user)
        except ValidationError as e:
            # Auto-approve failed — keep the draft, surface the error
            rb.last_error = (e.messages[0] if hasattr(e, 'messages') else str(e))
        else:
            rb.last_error = ''
    else:
        rb.last_error = ''

    rb.last_run_date = bill_date
    rb.next_run_date = advance_date(bill_date, rb.frequency)
    if rb.end_date and rb.next_run_date > rb.end_date:
        rb.status = 'stopped'
    rb.save()
    return bill


def generate_due(*, today: date_cls | None = None, user=None) -> dict:
    """Generate every overdue bill for every active recurring profile.

    A profile that's many cycles behind will fire multiple times in one run
    (e.g. you didn't run cron for a month, then it catches up).
    """
    today = today or date_cls.today()
    created = []
    errors: list[dict] = []
    profiles = list(RecurringBill.objects.filter(status='active', next_run_date__lte=today))
    for rb in profiles:
        # Refresh in case multi-cycle catch-up; cap at 60 cycles so runaway profiles
        # can't lock the system if dates are misconfigured.
        guard = 0
        while rb.status == 'active' and rb.next_run_date <= today and guard < 60:
            try:
                bill = generate_one(rb, user=user)
                created.append({'recurring_id': rb.id, 'bill_id': bill.id})
            except ValidationError as e:
                msg = e.messages[0] if hasattr(e, 'messages') else str(e)
                errors.append({'recurring_id': rb.id, 'error': msg})
                rb.last_error = msg
                rb.status = 'paused'
                rb.save(update_fields=['last_error', 'status', 'updated_at'])
                break
            guard += 1
    return {'created': len(created), 'created_details': created, 'errors': errors,
            'today': today.isoformat()}


@transaction.atomic
def cancel_bill(bill: Bill, user=None):
    """Mark a bill cancelled. Reverses the bill JE and any payment JEs."""
    from datetime import date as date_cls
    if bill.status == 'cancelled':
        return bill
    if bill.amount_paid > 0:
        raise ValidationError(
            'Cannot cancel a bill with recorded payments. Reverse the payments first.'
        )

    if bill.journal_entry_id and bill.journal_entry.is_posted:
        # Build a reversal directly so we don't depend on the view layer.
        original = bill.journal_entry
        reversal = JournalEntry.objects.create(
            date=date_cls.today(),
            narration=f"Cancellation of {original.entry_no}",
            voucher_type=original.voucher_type,
            reference_type=original.reference_type,
            reference_id=original.reference_id,
            location_id=original.location_id,
            created_by=user,
        )
        for line in original.lines.all():
            JournalEntryLine.objects.create(
                entry=reversal,
                account=line.account,
                debit=line.credit,
                credit=line.debit,
                narration=line.narration,
                party_type=line.party_type,
                party_id=line.party_id,
            )
        reversal.post()

    bill.status = 'cancelled'
    bill.save(update_fields=['status', 'updated_at'])
    return bill

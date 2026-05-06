"""Loan disbursement, EMI schedule generation, and EMI payment posting."""
from calendar import monthrange
from datetime import date as date_cls
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import transaction

from core.models import AccountMapping
from journals.models import JournalEntry, JournalEntryLine

from .models import EMISchedule, Loan


def compute_emi(principal: Decimal, annual_rate_pct: Decimal,
                tenure_months: int) -> Decimal:
    """Standard EMI formula: P × r × (1+r)^n / ((1+r)^n - 1).

    Returns 0 when rate is 0 (interest-free loan: just principal/n).
    """
    p = Decimal(str(principal))
    n = int(tenure_months)
    r_annual = Decimal(str(annual_rate_pct))
    if n <= 0:
        raise ValidationError('Tenure must be > 0 months.')
    if r_annual == 0:
        return (p / Decimal(n)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    r = r_annual / Decimal('100') / Decimal('12')
    factor = (Decimal('1') + r) ** n
    emi = p * r * factor / (factor - Decimal('1'))
    return emi.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _add_one_month(d: date_cls) -> date_cls:
    if d.month == 12:
        nm = date_cls(d.year + 1, 1, 1)
    else:
        nm = date_cls(d.year, d.month + 1, 1)
    last = monthrange(nm.year, nm.month)[1]
    day = min(d.day, last)
    return date_cls(nm.year, nm.month, day)


@transaction.atomic
def generate_schedule(loan: Loan) -> int:
    """Create the full amortization schedule. Idempotent via uniqueness on
    (loan, installment_no) — re-calling won't create duplicates."""
    if loan.emi_schedule.exists():
        return 0

    p = loan.principal_amount
    n = loan.tenure_months
    r_annual = loan.interest_rate_pct
    r = r_annual / Decimal('100') / Decimal('12') if r_annual else Decimal('0')

    emi = compute_emi(p, r_annual, n)
    balance = p
    due = date_cls(loan.start_date.year, loan.start_date.month,
                   min(loan.emi_day, monthrange(loan.start_date.year, loan.start_date.month)[1]))
    if due <= loan.start_date:
        due = _add_one_month(due)

    rows = []
    for i in range(1, n + 1):
        interest = (balance * r).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        principal = emi - interest
        # Last installment absorbs rounding drift
        if i == n:
            principal = balance
            emi_amt = principal + interest
        else:
            emi_amt = emi
        balance = balance - principal
        rows.append(EMISchedule(
            loan=loan, installment_no=i, due_date=due,
            principal=principal, interest=interest,
            balance_principal=max(balance, Decimal('0.00')),
        ))
        due = _add_one_month(due)

    EMISchedule.objects.bulk_create(rows)
    return len(rows)


@transaction.atomic
def post_disbursement(loan: Loan, *, mode: str = 'bank', user=None) -> JournalEntry:
    """Dr Bank/Cash, Cr Loan Liability — when the loan amount is received."""
    if loan.disbursement_journal_entry_id:
        raise ValidationError('Disbursement JE already posted for this loan.')

    debit_acct = (AccountMapping.get_account('BANK') if mode == 'bank'
                  else AccountMapping.get_account('CASH'))
    je = JournalEntry.objects.create(
        date=loan.start_date,
        narration=f'Loan disbursement — {loan.loan_no} from {loan.lender_name}',
        voucher_type='RECEIPT', reference_type='Manual',
        location_id=loan.location_id,
        created_by=user,
    )
    JournalEntryLine.objects.create(entry=je, account=debit_acct,
                                    debit=loan.principal_amount)
    JournalEntryLine.objects.create(entry=je, account=loan.liability_account,
                                    credit=loan.principal_amount)
    je.post()
    loan.disbursement_journal_entry = je
    loan.save(update_fields=['disbursement_journal_entry', 'updated_at'])
    return je


@transaction.atomic
def pay_emi(emi: EMISchedule, *, payment_date: date_cls = None,
            mode: str = 'bank', user=None) -> JournalEntry:
    """Pay one scheduled EMI. Posts:
        Dr Loan Liability   (principal portion)
        Dr Interest Expense (interest portion)
        Cr Bank/Cash        (total EMI)
    """
    if emi.status == 'paid':
        raise ValidationError(f'EMI #{emi.installment_no} already paid.')

    payment_date = payment_date or date_cls.today()
    credit_acct = (AccountMapping.get_account('BANK') if mode == 'bank'
                   else AccountMapping.get_account('CASH'))
    je = JournalEntry.objects.create(
        date=payment_date,
        narration=f'EMI #{emi.installment_no}/{emi.loan.tenure_months} '
                  f'on {emi.loan.loan_no}',
        voucher_type='PAYMENT', reference_type='Manual',
        location_id=emi.loan.location_id,
        created_by=user,
    )
    if emi.principal > 0:
        JournalEntryLine.objects.create(
            entry=je, account=emi.loan.liability_account, debit=emi.principal,
        )
    if emi.interest > 0:
        JournalEntryLine.objects.create(
            entry=je, account=emi.loan.interest_expense_account, debit=emi.interest,
        )
    JournalEntryLine.objects.create(
        entry=je, account=credit_acct, credit=emi.total_emi,
    )
    je.post()

    emi.status = 'paid'
    emi.paid_date = payment_date
    emi.journal_entry = je
    emi.save(update_fields=['status', 'paid_date', 'journal_entry'])

    # Auto-close loan when last EMI is paid
    if not emi.loan.emi_schedule.filter(status__in=['pending', 'overdue']).exists():
        emi.loan.status = 'closed'
        emi.loan.save(update_fields=['status', 'updated_at'])

    return je

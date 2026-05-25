"""Expense service layer — turns Expense records into journal entries.

A draft expense is just data; "recording" it generates a balanced JE that
debits each line's expense account (and any GST inputs) and credits the
paid-through bank/cash GL account in a single line.
"""
from decimal import Decimal
from django.core.exceptions import ValidationError
from django.db import transaction

from core.models import AccountMapping
from journals.models import JournalEntry, JournalEntryLine
from .models import Expense


def _acct(key: str, location_id=None):
    """Resolve role key → ChartOfAccount with per-location preference.
    See [[per-location-coa]]."""
    return AccountMapping.get_account(key, location_id=location_id)


@transaction.atomic
def record_expense(expense: Expense, *, user=None) -> JournalEntry:
    if expense.journal_entry_id is not None:
        raise ValidationError('Expense is already recorded.')
    items = list(expense.items.all())
    if not items:
        raise ValidationError('Add at least one expense line.')
    if expense.total_amount <= 0:
        raise ValidationError('Total must be greater than zero.')

    line_total = sum((i.amount for i in items), Decimal('0.00'))
    tax_total = (expense.tax_cgst or Decimal('0.00')) + (expense.tax_sgst or Decimal('0.00')) + (expense.tax_igst or Decimal('0.00'))

    label = expense.vendor_name or 'Expense'
    loc = expense.location_id
    entry = JournalEntry.objects.create(
        date=expense.expense_date,
        narration=f"{label} via {expense.paid_through_account.account_name}",
        voucher_type='PAYMENT',
        reference_type='Manual',
        location_id=loc,
        created_by=user,
    )

    # Debit each item account
    for item in items:
        if item.amount <= 0:
            continue
        JournalEntryLine.objects.create(
            entry=entry, account=item.account,
            debit=item.amount, narration=item.description,
        )

    # Debit GST inputs
    if expense.tax_cgst > 0:
        JournalEntryLine.objects.create(entry=entry, account=_acct('INPUT_CGST', loc), debit=expense.tax_cgst)
    if expense.tax_sgst > 0:
        JournalEntryLine.objects.create(entry=entry, account=_acct('INPUT_SGST', loc), debit=expense.tax_sgst)
    if expense.tax_igst > 0:
        JournalEntryLine.objects.create(entry=entry, account=_acct('INPUT_IGST', loc), debit=expense.tax_igst)

    # Credit paid-through (single line)
    JournalEntryLine.objects.create(
        entry=entry, account=expense.paid_through_account,
        credit=expense.total_amount,
    )

    # Round-off if total ≠ items + tax
    diff = expense.total_amount - (line_total + tax_total)
    if diff != 0:
        try:
            round_acct = _acct('ROUND_OFF', loc)
        except ValueError:
            entry.delete()
            raise ValidationError(
                f'Total {expense.total_amount} != items {line_total} + tax {tax_total}; '
                'configure ROUND_OFF mapping or fix totals.'
            )
        if diff > 0:
            JournalEntryLine.objects.create(entry=entry, account=round_acct, debit=diff)
        else:
            JournalEntryLine.objects.create(entry=entry, account=round_acct, credit=-diff)

    entry.post()
    expense.journal_entry = entry
    expense.status = 'recorded'
    expense.save(update_fields=['journal_entry', 'status', 'updated_at'])
    return entry


@transaction.atomic
def reverse_expense(expense: Expense, *, user=None):
    """Reverse a recorded expense — creates a reversal JE and resets to draft."""
    from datetime import date as date_cls
    if not expense.journal_entry_id:
        raise ValidationError('Expense has no journal entry to reverse.')
    original = expense.journal_entry
    if original.is_posted:
        reversal = JournalEntry.objects.create(
            date=date_cls.today(),
            narration=f"Reversal of {original.entry_no} (expense)",
            voucher_type=original.voucher_type,
            reference_type=original.reference_type,
            location_id=original.location_id,
            created_by=user,
        )
        for line in original.lines.all():
            JournalEntryLine.objects.create(
                entry=reversal, account=line.account,
                debit=line.credit, credit=line.debit,
                narration=line.narration,
                party_type=line.party_type, party_id=line.party_id,
            )
        reversal.post()
    expense.journal_entry = None
    expense.status = 'draft'
    expense.save(update_fields=['journal_entry', 'status', 'updated_at'])
    return expense

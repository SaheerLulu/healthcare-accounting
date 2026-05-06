"""
Year-end close: transfer P&L to Retained Earnings, lock the FY,
and (optionally) carry-forward Balance-Sheet account opening balances.
"""
from datetime import date
from decimal import Decimal
from django.db import transaction

from .models import AccountingSettings, AccountMapping, ChartOfAccount
from journals.models import JournalEntry, JournalEntryLine


def fy_label(start_year: int) -> str:
    """2025 → '2025-26'."""
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def fy_window(fy_start_year: int, fy_start_month: int = 4):
    start = date(fy_start_year, fy_start_month, 1)
    if fy_start_month == 1:
        end = date(fy_start_year, 12, 31)
    else:
        end = date(fy_start_year + 1, fy_start_month, 1)
        end = date(end.year, end.month - 1, 28)
        # walk to last day of that month
        from calendar import monthrange
        end = date(end.year, end.month, monthrange(end.year, end.month)[1])
    return start, end


@transaction.atomic
def close_fiscal_year(fy_start_year: int, *, location_id: int = None,
                      generate_opening: bool = True, user=None,
                      closing_stock_value: Decimal = None):
    """
    Close the fiscal year that begins on `fy_start_year` (April by default).

    Order of operations:
      1. **Closing-stock JV** (if `closing_stock_value` is provided): post
         the period-end Dr Closing Stock / Cr Purchases entry FIRST, so the
         subsequent P&L→Retained-Earnings transfer captures the corrected
         net profit.
      2. Post the YEAR-END CLOSE JV that zeros all Revenue and Expense
         accounts into RETAINED_EARNINGS.
      3. Set AccountingSettings.is_fy_closed=True and last_closed_fy.
      4. If generate_opening: post an OPENING BALANCES JV on day 1 of the
         next FY that re-instates all Asset/Liability/Equity balances
         (Closing Stock carried forward automatically).

    Returns a dict with the created entry numbers + totals.
    """
    settings = AccountingSettings.get_settings()
    label = fy_label(fy_start_year)

    if settings.last_closed_fy == label:
        raise ValueError(f'Fiscal year {label} is already closed.')

    fy_start, fy_end = fy_window(fy_start_year, settings.financial_year_start or 4)

    # Step 1 — closing-stock JV (period-end physical-count adjustment)
    closing_stock_entry_no = None
    if closing_stock_value is not None:
        from journals.services import JournalAutoGenerationService
        cs_je = JournalAutoGenerationService().post_closing_stock_adjustment(
            date=fy_end, value=closing_stock_value,
            location_id=location_id, user=user,
            narration=f'Year-end closing stock for FY {label}',
        )
        if cs_je:
            closing_stock_entry_no = cs_je.entry_no

    retained = AccountMapping.get_account('RETAINED_EARNINGS')

    # Build line list — close every Revenue and Expense leaf account.
    pl_accounts = ChartOfAccount.objects.filter(
        is_leaf=True, is_active=True,
        account_type__in=('REVENUE', 'EXPENSE'),
    )

    close_lines = []
    net_profit = Decimal('0.00')
    for acct in pl_accounts:
        bal = acct.get_balance(end_date=fy_end)  # debit-positive
        if bal == 0:
            continue
        # Revenue accounts have credit balances (bal < 0); Expense accounts have debit balances (bal > 0).
        # To zero them: post the opposite sign.
        if bal < 0:  # credit balance — debit it to close
            close_lines.append({'account': acct, 'debit': -bal, 'credit': Decimal('0')})
            net_profit += -bal  # revenue increases profit
        else:        # debit balance — credit it to close
            close_lines.append({'account': acct, 'debit': Decimal('0'), 'credit': bal})
            net_profit -= bal  # expense reduces profit

    if not close_lines:
        raise ValueError('No revenue or expense activity to close for this FY.')

    # Balancing line: net profit goes to Retained Earnings.
    if net_profit > 0:
        close_lines.append({'account': retained, 'debit': Decimal('0'), 'credit': net_profit})
    elif net_profit < 0:
        close_lines.append({'account': retained, 'debit': -net_profit, 'credit': Decimal('0')})

    close_entry = JournalEntry.objects.create(
        date=fy_end,
        narration=f'Year-end close for FY {label} — net P&L transferred to Retained Earnings',
        voucher_type='JOURNAL',
        reference_type='Manual',
        location_id=location_id,
        created_by=user,
    )
    for ln in close_lines:
        JournalEntryLine.objects.create(entry=close_entry, **ln)
    close_entry.post()

    opening_entry_no = None
    if generate_opening:
        # On day 1 of next FY, re-state all Asset/Liability/Equity balances as opening.
        next_fy_start = date(fy_end.year + (1 if fy_end.month == 12 else 0),
                             1 if fy_end.month == 12 else fy_end.month + 1, 1)

        bs_accounts = ChartOfAccount.objects.filter(
            is_leaf=True, is_active=True,
            account_type__in=('ASSET', 'LIABILITY', 'EQUITY'),
        )

        opening_lines = []
        total_dr = Decimal('0.00')
        total_cr = Decimal('0.00')
        for acct in bs_accounts:
            bal = acct.get_balance(end_date=fy_end)
            if bal == 0:
                continue
            if bal > 0:  # debit balance (typical for Asset)
                opening_lines.append({'account': acct, 'debit': bal, 'credit': Decimal('0')})
                total_dr += bal
            else:        # credit balance (typical for Liability/Equity)
                opening_lines.append({'account': acct, 'debit': Decimal('0'), 'credit': -bal})
                total_cr += -bal

        if opening_lines:
            opening_entry = JournalEntry.objects.create(
                date=next_fy_start,
                narration=f'Opening balances for FY {fy_label(fy_start_year + 1)} '
                          f'(carried forward from FY {label})',
                voucher_type='JOURNAL',
                reference_type='Manual',
                location_id=location_id,
                created_by=user,
            )
            for ln in opening_lines:
                JournalEntryLine.objects.create(entry=opening_entry, **ln)
            # Sanity: should already balance (Assets = Liab + Equity), but guard the rounding gap.
            diff = total_dr - total_cr
            if abs(diff) > JournalEntry.BALANCE_TOLERANCE:
                # Push the gap into Retained Earnings to match.
                if diff < 0:
                    JournalEntryLine.objects.create(entry=opening_entry, account=retained,
                                                    debit=-diff, credit=Decimal('0'))
                else:
                    JournalEntryLine.objects.create(entry=opening_entry, account=retained,
                                                    debit=Decimal('0'), credit=diff)
            opening_entry.post()
            opening_entry_no = opening_entry.entry_no

    settings.is_fy_closed = True
    settings.last_closed_fy = label
    settings.save()

    return {
        'fy': label,
        'close_entry_no': close_entry.entry_no,
        'opening_entry_no': opening_entry_no,
        'closing_stock_entry_no': closing_stock_entry_no,
        'net_profit': str(net_profit),
    }

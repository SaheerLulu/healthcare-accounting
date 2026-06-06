"""
Year-end close: transfer P&L to Retained Earnings, lock the FY,
and (optionally) carry-forward Balance-Sheet account opening balances.
"""
from datetime import date
from decimal import Decimal
from django.db import transaction

from .models import AccountingSettings, AccountMapping, ChartOfAccount
from journals.models import JournalEntry, JournalEntryLine


# Marker for the day-1 opening-balance JV so cumulative reports (Balance Sheet)
# can exclude it — it restates balances the continuous ledger already carries,
# and counting both doubles every Asset/Liability/Equity. Windowed reports
# (Trial Balance) keep including it as their brought-forward opening.
OPENING_CARRY_FORWARD = 'OpeningCarryForward'


def fy_label(start_year: int) -> str:
    """2025 → '2025-26'."""
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def _carryforward_basis(acct, end_date, location_id=None):
    """Closing balance of a Balance-Sheet account from the *real* continuous
    ledger — i.e. excluding any prior opening carry-forward JV. Using
    acct.get_balance() here would fold in last year's carry-forward (which sits
    in the same account), so each successive close would compound the
    restatement. Debit-positive, like get_balance(). Scoped to `location_id`
    when given so each store carries forward only its own balances."""
    from journals.models import JournalEntryLine
    from django.db.models import Sum
    qs = (JournalEntryLine.objects
          .filter(account=acct, entry__is_posted=True,
                  entry__is_optional=False, entry__is_memorandum=False,
                  entry__date__lte=end_date)
          .exclude(entry__reference_type=OPENING_CARRY_FORWARD))
    if location_id is not None:
        qs = qs.filter(entry__location_id=location_id)
    agg = qs.aggregate(dr=Sum('debit'), cr=Sum('credit'))
    return (agg['dr'] or Decimal('0.00')) - (agg['cr'] or Decimal('0.00'))


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
                      generate_opening: bool = True, user=None):
    """
    Close the fiscal year that begins on `fy_start_year` (April by default).

    Order of operations:
      1. Post the YEAR-END CLOSE JV that zeros all Revenue and Expense
         accounts into RETAINED_EARNINGS. Perpetual inventory means 1190
         Closing Stock already reflects on-hand value — no period-end
         closing-stock JV is needed.
      2. Set AccountingSettings.is_fy_closed=True and last_closed_fy.
      3. If generate_opening: post an OPENING BALANCES JV on day 1 of the
         next FY that re-instates all Asset/Liability/Equity balances
         (Closing Stock carried forward automatically).

    Returns a dict with the created entry numbers + totals.
    """
    if location_id is None:
        raise ValueError('location_id is required to close a fiscal year (store isolation).')

    settings = AccountingSettings.get_settings()
    label = fy_label(fy_start_year)

    if settings.last_closed_fy == label:
        raise ValueError(f'Fiscal year {label} is already closed.')

    fy_start, fy_end = fy_window(fy_start_year, settings.financial_year_start or 4)

    retained = AccountMapping.get_account('RETAINED_EARNINGS')

    # Build line list — close every Revenue and Expense leaf account.
    pl_accounts = ChartOfAccount.objects.filter(
        is_leaf=True, is_active=True,
        account_type__in=('REVENUE', 'EXPENSE'),
    )

    close_lines = []
    net_profit = Decimal('0.00')
    for acct in pl_accounts:
        bal = acct.get_balance(end_date=fy_end, location_id=location_id)  # debit-positive
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
            bal = _carryforward_basis(acct, fy_end, location_id=location_id)
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
                reference_type=OPENING_CARRY_FORWARD,
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

    # Lock every month of the closed FY. `last_closed_fy` only ever names the
    # MOST-RECENT close, so closing a later FY used to silently re-open this one
    # (assert_unlocked's FY check stopped matching it). These cumulative month
    # locks keep every previously-closed year shut. get_or_create is idempotent
    # and won't clobber an existing month lock (e.g. a filed-return lock).
    from .period_lock import LockedPeriod
    y, m = fy_start.year, fy_start.month
    while date(y, m, 1) <= fy_end:
        LockedPeriod.objects.get_or_create(
            period=f'{y:04d}-{m:02d}',
            defaults={'locked_by': user, 'reason': f'FY {label} year-end close'},
        )
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)

    return {
        'fy': label,
        'close_entry_no': close_entry.entry_no,
        'opening_entry_no': opening_entry_no,
        'net_profit': str(net_profit),
    }

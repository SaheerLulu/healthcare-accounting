"""Budget vs actual computation."""
from decimal import Decimal

from django.db.models import Sum

from core.models import ChartOfAccount
from journals.models import JournalEntryLine

from .models import Budget


def _period_dates(period: str, period_kind: str):
    """Convert a period label to (start_date, end_date)."""
    from calendar import monthrange
    from datetime import date

    if period_kind == 'annual':
        # 'YYYY' or 'YYYY-YY' (FY label)
        if '-' in period:
            year = int(period.split('-')[0])
            return date(year, 4, 1), date(year + 1, 3, 31)
        year = int(period)
        return date(year, 1, 1), date(year, 12, 31)
    if period_kind == 'quarterly':
        year, q = period.split('-Q')
        year = int(year); q = int(q)
        start_month = (q - 1) * 3 + 1
        start = date(year, start_month, 1)
        end_month = start_month + 2
        end = date(year, end_month, monthrange(year, end_month)[1])
        return start, end
    # monthly
    year, month = map(int, period.split('-'))
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def variance_report(*, period: str, period_kind: str = 'monthly',
                    location_id: int = None, cost_center: str = None) -> dict:
    """For each budget row in the period, compute actual + variance."""
    start, end = _period_dates(period, period_kind)

    bq = Budget.objects.filter(period=period, period_kind=period_kind)
    if location_id is not None:
        bq = bq.filter(location_id=location_id)
    if cost_center:
        bq = bq.filter(cost_center=cost_center)

    rows = []
    for budget in bq.select_related('account'):
        # Actuals = net debit on Expense accounts; net credit on Revenue
        line_qs = JournalEntryLine.objects.filter(
            account=budget.account, entry__is_posted=True,
            entry__date__gte=start, entry__date__lte=end,
        )
        if budget.location_id is not None:
            line_qs = line_qs.filter(entry__location_id=budget.location_id)
        if budget.cost_center:
            line_qs = line_qs.filter(entry__cost_center=budget.cost_center)
        agg = line_qs.aggregate(d=Sum('debit'), c=Sum('credit'))
        dr = agg['d'] or Decimal('0.00')
        cr = agg['c'] or Decimal('0.00')

        if budget.account.account_type in ('REVENUE',):
            actual = cr - dr
        else:
            actual = dr - cr

        variance = actual - budget.amount
        variance_pct = (
            (variance / budget.amount * 100).quantize(Decimal('0.01'))
            if budget.amount else Decimal('0')
        )
        acct_type = budget.account.account_type
        if acct_type == 'EXPENSE':
            status = ('over' if variance > 0 else
                      'under' if variance < 0 else 'on_track')
        elif acct_type == 'REVENUE':
            # A collection shortfall is the alarm case for revenue budgets;
            # collecting more than budget is on track (M22 — these rows used
            # to always read 'on_track').
            status = 'under' if variance < 0 else 'on_track'
        else:
            status = 'on_track'
        rows.append({
            'account_code': budget.account.account_code,
            'account_name': budget.account.account_name,
            'account_type': budget.account.account_type,
            'cost_center': budget.cost_center,
            'budget': str(budget.amount),
            'actual': str(actual),
            'variance': str(variance),
            'variance_pct': str(variance_pct),
            'status': status,
        })
    return {
        'period': period, 'period_kind': period_kind,
        'start_date': str(start), 'end_date': str(end),
        'rows': rows,
        'totals': {
            'budget': str(sum(Decimal(r['budget']) for r in rows)),
            'actual': str(sum(Decimal(r['actual']) for r in rows)),
        },
    }

"""
Alert-generator rules. Run via `manage.py generate_alerts` (cron-friendly).

Each rule queries for the trigger condition and creates Notification rows.
The `unique_open_per_target` constraint prevents duplicates — re-running
the rules every hour is safe.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction

from .models import Notification


def _create_or_skip(**kwargs):
    """Create a notification only if no matching unread notification already
    exists for the same target. Belt-and-braces: we check first (handles
    NULL-user-id case where the partial unique constraint can't fire), then
    fall back to catching IntegrityError under a savepoint."""
    dedup_filter = {
        'kind': kwargs.get('kind'),
        'related_model': kwargs.get('related_model', ''),
        'related_id': kwargs.get('related_id'),
        'is_read': False,
    }
    if 'user' in kwargs:
        dedup_filter['user'] = kwargs.get('user')
    if Notification.objects.filter(**dedup_filter).exists():
        return None
    try:
        with transaction.atomic():
            return Notification.objects.create(**kwargs)
    except IntegrityError:
        return None


def alert_overdue_bills(*, today=None):
    from bills.models import Bill
    today = today or date.today()
    overdue = Bill.objects.filter(
        status__in=['open', 'partially_paid'],
        due_date__lt=today,
    )
    n = 0
    for bill in overdue:
        days_late = (today - bill.due_date).days
        priority = ('critical' if days_late > 30
                    else 'high' if days_late > 7 else 'normal')
        if _create_or_skip(
            kind='bill_overdue', priority=priority, role_code='BOOKKEEPER',
            title=f'Bill {bill.bill_no or "#"+str(bill.id)} overdue by {days_late} days',
            body=f'Vendor: {bill.vendor_name}. '
                 f'Balance: ₹{bill.balance_due}. '
                 f'Due: {bill.due_date}.',
            related_model='Bill', related_id=bill.id,
            link_url=f'/bills/{bill.id}/',
        ):
            n += 1
    return n


def alert_pending_approvals():
    from bills.models import Bill
    pending = Bill.objects.filter(approval_status='pending')
    n = 0
    for bill in pending:
        if _create_or_skip(
            kind='approval_required', priority='high', role_code='SENIOR_ACCOUNTANT',
            title=f'Bill {bill.bill_no or "#"+str(bill.id)} awaiting approval',
            body=f'Vendor: {bill.vendor_name}. Amount: ₹{bill.total_amount}.',
            related_model='Bill', related_id=bill.id,
            link_url=f'/bills/{bill.id}/',
        ):
            n += 1
    return n


def alert_emi_due(*, today=None, lookahead_days=7):
    today = today or date.today()
    horizon = today + timedelta(days=lookahead_days)
    try:
        from loans.models import EMISchedule
    except ImportError:
        return 0
    upcoming = EMISchedule.objects.filter(
        status='pending', due_date__lte=horizon,
    ).select_related('loan')
    n = 0
    for emi in upcoming:
        days_to_due = (emi.due_date - today).days
        priority = 'critical' if days_to_due < 0 else 'high'
        title = (f'EMI due {"today" if days_to_due == 0 else "in "+str(days_to_due)+" days"}'
                 if days_to_due >= 0
                 else f'EMI overdue by {-days_to_due} days')
        if _create_or_skip(
            kind='emi_due', priority=priority, role_code='BOOKKEEPER',
            title=f'{title}: {emi.loan.loan_no} #{emi.installment_no}',
            body=f'Lender: {emi.loan.lender_name}. EMI ₹{emi.total_emi}. Due {emi.due_date}.',
            related_model='EMISchedule', related_id=emi.id,
            link_url=f'/loans/{emi.loan_id}/',
        ):
            n += 1
    return n


def alert_gst_filing_due(*, today=None):
    """GSTR-3B due on 20th of every month for the previous month."""
    today = today or date.today()
    if today.day < 18:
        return 0  # don't bother before 2 days out
    if today.day > 22:
        return 0
    prev_month = today.replace(day=1) - timedelta(days=1)
    period = prev_month.strftime('%Y-%m')
    n = 0
    if _create_or_skip(
        kind='gstr3b_due', priority='high', role_code='SENIOR_ACCOUNTANT',
        title=f'GSTR-3B for {period} due by {today.year}-{today.month:02d}-20',
        body='Generate GSTR-3B from sales journals and file on the GST portal.',
        related_model='GSTR3BSummary', related_id=None,
        link_url=f'/gst/gstr3b/?period={period}',
    ):
        n += 1
    return n


def alert_msme_window(*, today=None):
    """Suppliers approaching the 45-day MSME payment limit."""
    from parties.models import PartyMetadata
    from journals.models import JournalEntryLine
    today = today or date.today()
    msme_ids = list(
        PartyMetadata.objects.filter(party_type='Supplier')
        .exclude(msme_category='').values_list('party_id', flat=True)
    )
    if not msme_ids:
        return 0
    cutoff = today - timedelta(days=35)  # 10 days before 45-day limit
    deadline_low = today - timedelta(days=45)
    lines = (JournalEntryLine.objects
             .filter(party_type='Supplier', party_id__in=msme_ids,
                     entry__is_posted=True,
                     entry__date__gte=deadline_low,
                     entry__date__lte=cutoff,
                     credit__gt=0)
             .select_related('entry'))
    n = 0
    for line in lines:
        days_old = (today - line.entry.date).days
        days_left = 45 - days_old
        if days_left < 0:
            priority = 'critical'
            title = f'MSME bill OVERDUE by {-days_left} days (interest accruing)'
        else:
            priority = 'high'
            title = f'MSME bill nearing 45-day limit ({days_left} days left)'
        if _create_or_skip(
            kind='msme_45_day', priority=priority, role_code='SENIOR_ACCOUNTANT',
            title=title,
            body=f'{line.entry.entry_no}: ₹{line.credit} payable to MSME supplier #{line.party_id}.',
            related_model='JournalEntry', related_id=line.entry.id,
            link_url=f'/journals/{line.entry.id}/',
        ):
            n += 1
    return n


def alert_pending_cheques(*, today=None, days=30):
    today = today or date.today()
    try:
        from banking.models import Cheque
    except ImportError:
        return 0
    cutoff = today - timedelta(days=days)
    pending = Cheque.objects.filter(status='pending', cheque_date__lt=cutoff)
    n = 0
    for cheque in pending:
        days_old = (today - cheque.cheque_date).days
        if _create_or_skip(
            kind='cheque_pending_long', priority='normal', role_code='BOOKKEEPER',
            title=f'Cheque {cheque.cheque_no} pending {days_old} days',
            body=f'{cheque.kind.title()} cheque for ₹{cheque.amount}.',
            related_model='Cheque', related_id=cheque.id,
            link_url=f'/banking/cheques/{cheque.id}/',
        ):
            n += 1
    return n


def alert_sync_failures(*, now=None):
    """Flag any SyncError that has been unresolved for over an hour.
    Operationally important — silent inventory sync failures eventually
    drift the books out of sync with the source data."""
    from django.utils import timezone
    from sync.models import SyncError
    now = now or timezone.now()
    cutoff = now - timedelta(hours=1)
    stale = SyncError.objects.filter(resolved=False, created_at__lt=cutoff)
    n = 0
    for err in stale:
        if _create_or_skip(
            kind='sync_failure', priority='high', role_code='BOOKKEEPER',
            title=f'Sync failure: {err.sync_type} #{err.source_id}',
            body=(f'Unresolved for {(now - err.created_at).total_seconds() // 3600:.0f}h+. '
                  f'Error: {err.error_message[:200]}'),
            related_model='SyncError', related_id=err.id,
            link_url='/sync',
        ):
            n += 1
    return n


def alert_period_lock_change(*, since=None):
    """Notify CFO/Senior Accountant of period-lock additions in the last
    24h. Lock changes are sensitive — finance leadership should be aware."""
    from django.utils import timezone
    from core.period_lock import LockedPeriod
    since = since or (timezone.now() - timedelta(hours=24))
    locks = LockedPeriod.objects.filter(locked_at__gte=since)
    n = 0
    for lock in locks:
        if _create_or_skip(
            kind='period_lock_change', priority='critical', role_code='CFO',
            title=f'Period locked: {lock.period}',
            body=(f'{lock.locked_by.username if lock.locked_by else "system"} '
                  f'locked {lock.period} at {lock.locked_at:%Y-%m-%d %H:%M}. '
                  f'Reason: {lock.reason or "—"}'),
            related_model='LockedPeriod', related_id=lock.id,
            link_url='/settings',
        ):
            n += 1
    return n


def generate_alerts(*, today=None) -> dict:
    """Run every alert rule and return per-rule counts."""
    return {
        'overdue_bills': alert_overdue_bills(today=today),
        'pending_approvals': alert_pending_approvals(),
        'emi_due': alert_emi_due(today=today),
        'gstr3b_due': alert_gst_filing_due(today=today),
        'msme_window': alert_msme_window(today=today),
        'pending_cheques': alert_pending_cheques(today=today),
        'sync_failures': alert_sync_failures(),
        'period_lock_change': alert_period_lock_change(),
    }

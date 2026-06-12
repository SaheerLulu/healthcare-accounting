"""
Period locking — prevent JV mutation in closed fiscal years and explicitly
locked periods.

Two layers:

1. **FY-wide lock** — `AccountingSettings.last_closed_fy` ('YYYY-YY'). Once set,
   any date that falls inside that FY is rejected.

2. **Period lock** — `LockedPeriod` rows ('YYYY-MM' month locks) for finer
   control after a return is filed. Use these when you've filed a GSTR-3B for
   the month and don't want anyone touching that month's JVs anymore.

The `assert_unlocked(d)` helper raises `PeriodLockedError` (a `ValidationError`
subclass) so DRF surfaces a clean 400.

For bulk posting runs (sync), wrap the run in `period_lock_snapshot()` — it
caches the settings row and the locked-period set for the duration of the
block so the per-entry checks stop costing two queries each.
"""
import threading
from contextlib import contextmanager
from datetime import date

from django.core.exceptions import ValidationError
from django.db import models


class PeriodLockedError(ValidationError):
    """Raised when an operation targets a date inside a locked period."""

    def __init__(self, msg, *, locked_date=None, lock_kind=None):
        super().__init__(msg)
        self.locked_date = locked_date
        self.lock_kind = lock_kind  # 'fy' or 'period'


class LockedPeriod(models.Model):
    """A locked monthly period — created when a return is finalized."""

    period = models.CharField(max_length=7, unique=True,
                              help_text="YYYY-MM, e.g. '2026-04'")
    locked_at = models.DateTimeField(auto_now_add=True)
    locked_by = models.ForeignKey('auth.User', null=True, blank=True,
                                  on_delete=models.SET_NULL,
                                  related_name='locked_periods')
    reason = models.CharField(max_length=255, blank=True,
                              help_text='Why this period was locked '
                                        '(e.g. "GSTR-3B filed").')

    class Meta:
        ordering = ['-period']
        app_label = 'core'

    def __str__(self):
        return f'LockedPeriod {self.period}'


def _date_in_fy(d: date, fy_label: str, fy_start_month: int) -> bool:
    """Does `d` fall inside the given fiscal year?"""
    if not fy_label or '-' not in fy_label:
        return False
    try:
        start_year = int(fy_label.split('-')[0])
    except ValueError:
        return False
    fy_start = date(start_year, fy_start_month, 1)
    if fy_start_month == 1:
        fy_end = date(start_year, 12, 31)
    else:
        # last day of month preceding fy_start_month, next year
        from calendar import monthrange
        end_month = fy_start_month - 1
        end_year = start_year + 1
        fy_end = date(end_year, end_month, monthrange(end_year, end_month)[1])
    return fy_start <= d <= fy_end


# Run-scoped cache for assert_unlocked. JournalEntry.save() runs the check on
# EVERY save — a sync run posting N entries pays it at least 2N times (create
# + post), at two queries per call. The lock set cannot change mid-run, so a
# snapshot taken at run start is both correct and ~4N queries cheaper.
#
# Deliberately a context-managed thread-local, NOT a module-global cache with
# save/delete invalidation: TestCase rollbacks (and any out-of-band writer,
# e.g. a second app process locking a period) never fire model save/delete
# hooks, so a process-global cache could serve stale locks indefinitely. The
# snapshot dies with the `with` block — nothing can outlive its run.
_snapshot = threading.local()


@contextmanager
def period_lock_snapshot():
    """Cache AccountingSettings + the locked-period set for a bulk run.

    Nested use keeps the outermost snapshot (re-entering is a no-op), so a
    caller can wrap a whole pipeline without caring whether a callee already
    did. Locks created INSIDE the block are intentionally not seen until the
    block exits — a run validates against the lock state it started with.
    """
    if getattr(_snapshot, 'active', False):
        yield
        return
    from .models import AccountingSettings
    _snapshot.settings = AccountingSettings.get_settings()
    _snapshot.periods = frozenset(
        LockedPeriod.objects.values_list('period', flat=True))
    _snapshot.active = True
    try:
        yield
    finally:
        _snapshot.active = False
        _snapshot.settings = None
        _snapshot.periods = None


def assert_unlocked(d):
    """Raise PeriodLockedError if `d` is in a closed FY or locked month."""
    if d is None:
        return
    if isinstance(d, str):
        from django.utils.dateparse import parse_date
        d = parse_date(d) or None
        if d is None:
            return  # caller will fail validation elsewhere

    # Lazy imports — this module is loaded by app startup paths.
    from .models import AccountingSettings

    snapshot_active = getattr(_snapshot, 'active', False)
    settings = _snapshot.settings if snapshot_active \
        else AccountingSettings.get_settings()

    # FY-level lock
    if settings.is_fy_closed and settings.last_closed_fy:
        if _date_in_fy(d, settings.last_closed_fy,
                       settings.financial_year_start or 4):
            raise PeriodLockedError(
                f'Fiscal year {settings.last_closed_fy} is closed; '
                f'no entries allowed on {d.isoformat()}.',
                locked_date=d, lock_kind='fy',
            )

    # Month-level lock
    period_str = d.strftime('%Y-%m')
    locked = (period_str in _snapshot.periods) if snapshot_active \
        else LockedPeriod.objects.filter(period=period_str).exists()
    if locked:
        raise PeriodLockedError(
            f'Period {period_str} is locked; '
            f'no entries allowed on {d.isoformat()}.',
            locked_date=d, lock_kind='period',
        )

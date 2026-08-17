"""Calendar-date helpers for turning inventory source timestamps into the
accounting date a voucher must carry.

The shared inventory DB stores every timestamp UTC-aware (USE_TZ=True), so a
bare `.date()` on one of those values yields the UTC calendar day. For the
5.5-hour IST offset that is wrong for every event between 00:00 and 05:30 local
time: a reversal keyed at 2026-08-18 03:30 IST is 2026-08-17 22:00 UTC and was
being booked into the PREVIOUS day — silently shifting it across a month/FY
boundary and out of the period the pharmacy reported it in.
"""
from datetime import date, datetime

from django.utils import timezone


def as_local_date(value):
    """Return the Asia/Kolkata calendar date for `value`.

    Accepts a `date` (returned unchanged), a `datetime` (converted to the
    active timezone first when aware, then truncated), or None (passed
    through so `x or fallback` call sites keep working).
    """
    if value is None:
        return None
    # datetime subclasses date, so the datetime check has to come first.
    if isinstance(value, datetime):
        if timezone.is_aware(value):
            value = timezone.localtime(value)
        return value.date()
    if isinstance(value, date):
        return value
    return value

"""Tests for period-lock enforcement (WP 678)."""
from datetime import date

from django.test import TestCase

from core.period_lock import (
    LockedPeriod, PeriodLockedError, _date_in_fy, assert_unlocked,
)
from core.tests.utils import make_settings, seed_chart_and_mappings


class PeriodLockHelpersTests(TestCase):
    def test_date_in_fy_april_start(self):
        # FY 2025-26 = 1 Apr 2025 → 31 Mar 2026
        self.assertTrue(_date_in_fy(date(2025, 4, 1), '2025-26', 4))
        self.assertTrue(_date_in_fy(date(2026, 3, 31), '2025-26', 4))
        self.assertFalse(_date_in_fy(date(2026, 4, 1), '2025-26', 4))
        self.assertFalse(_date_in_fy(date(2025, 3, 31), '2025-26', 4))

    def test_date_in_fy_january_start(self):
        # FY 2025 = 1 Jan 2025 → 31 Dec 2025 when fy_start_month=1
        self.assertTrue(_date_in_fy(date(2025, 6, 15), '2025-26', 1))
        self.assertFalse(_date_in_fy(date(2026, 1, 1), '2025-26', 1))


class AssertUnlockedTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def test_no_locks_passes(self):
        # No FY closed, no period locked — any date is fine
        assert_unlocked(date(2026, 5, 1))  # should not raise

    def test_closed_fy_blocks_dates_inside(self):
        s = make_settings(is_fy_closed=True, last_closed_fy='2025-26')
        with self.assertRaises(PeriodLockedError) as ctx:
            assert_unlocked(date(2025, 8, 15))
        self.assertEqual(ctx.exception.lock_kind, 'fy')

    def test_closed_fy_allows_dates_outside(self):
        make_settings(is_fy_closed=True, last_closed_fy='2025-26')
        assert_unlocked(date(2026, 4, 1))  # next FY — OK
        assert_unlocked(date(2025, 3, 31))  # prior FY — OK

    def test_locked_period_blocks(self):
        LockedPeriod.objects.create(period='2026-04', reason='GSTR-3B filed')
        with self.assertRaises(PeriodLockedError) as ctx:
            assert_unlocked(date(2026, 4, 15))
        self.assertEqual(ctx.exception.lock_kind, 'period')

    def test_locked_period_only_affects_that_month(self):
        LockedPeriod.objects.create(period='2026-04')
        assert_unlocked(date(2026, 5, 1))  # different month — OK

    def test_string_date_accepted(self):
        LockedPeriod.objects.create(period='2026-04')
        with self.assertRaises(PeriodLockedError):
            assert_unlocked('2026-04-15')

    def test_none_passes(self):
        assert_unlocked(None)  # no error


class LockedPeriodModelTests(TestCase):
    def test_unique_period(self):
        LockedPeriod.objects.create(period='2026-04')
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            LockedPeriod.objects.create(period='2026-04')

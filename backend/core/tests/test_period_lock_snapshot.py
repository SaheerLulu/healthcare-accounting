"""Tests for the run-scoped period-lock snapshot (perf: JournalEntry.save()
checks assert_unlocked on every create AND post — two queries per call —
so a sync run posting N entries paid ~4N queries for a lock set that cannot
change mid-run)."""
from datetime import date

from django.test import TestCase

from core.period_lock import (
    LockedPeriod, PeriodLockedError, assert_unlocked, period_lock_snapshot,
)
from core.tests.utils import make_settings


class PeriodLockSnapshotTests(TestCase):
    def setUp(self):
        make_settings()

    def test_snapshot_answers_without_queries_and_blocks_locked_month(self):
        LockedPeriod.objects.create(period='2026-03', reason='GSTR-3B filed')
        with period_lock_snapshot():
            with self.assertNumQueries(0):
                assert_unlocked(date(2026, 4, 15))  # open month — passes
                with self.assertRaises(PeriodLockedError):
                    assert_unlocked(date(2026, 3, 2))

    def test_snapshot_honours_fy_close(self):
        make_settings(is_fy_closed=True, last_closed_fy='2025-26')
        with period_lock_snapshot():
            with self.assertNumQueries(0):
                with self.assertRaises(PeriodLockedError):
                    assert_unlocked(date(2025, 6, 1))   # inside closed FY
                assert_unlocked(date(2026, 5, 1))       # next FY — passes

    def test_snapshot_dies_with_the_block(self):
        # Cache must not outlive its run: a lock created after one snapshot
        # is enforced both un-snapshotted and by the next snapshot.
        with period_lock_snapshot():
            assert_unlocked(date(2026, 5, 2))
        LockedPeriod.objects.create(period='2026-05')
        with self.assertRaises(PeriodLockedError):
            assert_unlocked(date(2026, 5, 2))
        with period_lock_snapshot():
            with self.assertRaises(PeriodLockedError):
                assert_unlocked(date(2026, 5, 2))

    def test_nested_snapshot_keeps_outermost(self):
        LockedPeriod.objects.create(period='2026-03')
        with period_lock_snapshot():
            with period_lock_snapshot():
                with self.assertRaises(PeriodLockedError):
                    assert_unlocked(date(2026, 3, 2))
            # Inner exit must NOT tear down the outer snapshot.
            with self.assertNumQueries(0):
                assert_unlocked(date(2026, 4, 15))
                with self.assertRaises(PeriodLockedError):
                    assert_unlocked(date(2026, 3, 2))

    def test_unsnapshotted_path_unchanged(self):
        LockedPeriod.objects.create(period='2026-03')
        with self.assertRaises(PeriodLockedError):
            assert_unlocked(date(2026, 3, 2))
        assert_unlocked(date(2026, 4, 15))

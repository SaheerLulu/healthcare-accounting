"""Regression test for H16: closing a second fiscal year must NOT silently
re-open a previously-closed one.

last_closed_fy only ever names the most-recent close, so assert_unlocked's
FY check stopped matching the older year once a newer one closed. The fix locks
every month of each closed FY, so the older year stays shut cumulatively.
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.period_lock import PeriodLockedError, assert_unlocked
from core.tests.utils import make_journal_entry, make_settings, seed_chart_and_mappings
from core.year_end import close_fiscal_year


class MultiYearLockTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()

    def _book_revenue(self, amount, on):
        make_journal_entry(d=on, lines=[
            (self.coa['1110'], amount, Decimal('0.00')),
            (self.coa['4100'], Decimal('0.00'), amount),
        ])

    def test_closing_second_fy_keeps_first_locked(self):
        # Close FY 2025-26.
        self._book_revenue(Decimal('100000'), date(2025, 6, 15))
        close_fiscal_year(2025, location_id=1, generate_opening=False)
        with self.assertRaises(PeriodLockedError):
            assert_unlocked(date(2025, 6, 15))

        # Book + close FY 2026-27 (2026-06 is not in the FY2025 lock range).
        self._book_revenue(Decimal('50000'), date(2026, 6, 15))
        close_fiscal_year(2026, location_id=1, generate_opening=False)

        # The H16 bug: FY 2025-26 must STILL be locked after closing FY 2026-27.
        with self.assertRaises(PeriodLockedError):
            assert_unlocked(date(2025, 6, 15))
        # …and the newly-closed year is locked too.
        with self.assertRaises(PeriodLockedError):
            assert_unlocked(date(2026, 6, 15))

    def test_open_year_remains_postable(self):
        self._book_revenue(Decimal('100000'), date(2025, 6, 15))
        close_fiscal_year(2025, location_id=1, generate_opening=False)
        # A date in the still-open FY 2026-27 must not be locked.
        assert_unlocked(date(2026, 6, 15))  # no raise

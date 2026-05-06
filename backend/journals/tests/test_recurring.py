"""Tests for recurring journals."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import seed_chart_and_mappings, make_settings
from journals.models import RecurringJournal, RecurringJournalLine
from journals.services import (
    advance_journal_date, generate_due_recurring_journals,
    generate_one_recurring_journal,
)


class CadenceTests(TestCase):
    def test_advance_monthly(self):
        self.assertEqual(advance_journal_date(date(2026, 4, 15), 'monthly'),
                         date(2026, 5, 15))

    def test_advance_quarterly(self):
        self.assertEqual(advance_journal_date(date(2026, 4, 15), 'quarterly'),
                         date(2026, 7, 15))

    def test_advance_yearly(self):
        self.assertEqual(advance_journal_date(date(2026, 4, 15), 'yearly'),
                         date(2027, 4, 15))

    def test_advance_clamps_to_month_end(self):
        # Jan 31 + monthly → Feb 28 (or 29 in leap years)
        self.assertEqual(advance_journal_date(date(2026, 1, 31), 'monthly'),
                         date(2026, 2, 28))


class RecurringGenerationTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        rent = ChartOfAccount.objects.get(account_code='5410')
        cash = ChartOfAccount.objects.get(account_code='1110')

        self.rj = RecurringJournal.objects.create(
            profile_name='Monthly rent', voucher_type='JOURNAL',
            narration_template='Rent for {YYYY-MM}',
            frequency='monthly', start_date=date(2026, 4, 1),
            next_run_date=date(2026, 4, 1), location_id=1,
        )
        RecurringJournalLine.objects.create(recurring_journal=self.rj, account=rent,
                                            debit=Decimal('20000'))
        RecurringJournalLine.objects.create(recurring_journal=self.rj, account=cash,
                                            credit=Decimal('20000'))

    def test_generate_one_advances_next_run(self):
        e = generate_one_recurring_journal(self.rj)
        self.rj.refresh_from_db()
        self.assertEqual(e.date, date(2026, 4, 1))
        self.assertEqual(self.rj.next_run_date, date(2026, 5, 1))
        self.assertEqual(self.rj.last_run_date, date(2026, 4, 1))
        self.assertTrue(e.is_posted)

    def test_narration_template_substitution(self):
        e = generate_one_recurring_journal(self.rj)
        self.assertEqual(e.narration, 'Rent for 2026-04')

    def test_generate_due_creates_only_due(self):
        # Advance one month to today
        result = generate_due_recurring_journals(today=date(2026, 4, 1))
        self.assertEqual(result['created'], 1)

    def test_generate_due_catches_up(self):
        # Run for 3 months — should create 3 entries
        result = generate_due_recurring_journals(today=date(2026, 6, 1))
        self.assertEqual(result['created'], 3)

    def test_paused_skipped(self):
        self.rj.status = 'paused'
        self.rj.save()
        result = generate_due_recurring_journals(today=date(2026, 5, 1))
        self.assertEqual(result['created'], 0)

    def test_end_date_stops_profile(self):
        self.rj.end_date = date(2026, 5, 31)
        self.rj.save()
        result = generate_due_recurring_journals(today=date(2026, 7, 1))
        self.rj.refresh_from_db()
        self.assertEqual(self.rj.status, 'stopped')

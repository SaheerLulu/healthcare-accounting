"""Tests for JournalEntry: numbering, balance, post, reverse, period lock."""
from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from core.models import ChartOfAccount
from core.period_lock import LockedPeriod, PeriodLockedError
from core.tests.utils import (
    make_journal_entry, make_settings, seed_chart_and_mappings,
)
from journals.models import JournalEntry, JournalEntryLine


class EntryNumberingTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def test_first_entry_format(self):
        e = make_journal_entry()
        self.assertRegex(e.entry_no, r'JV-\d{4}-\d{6}')

    def test_sequential_numbering(self):
        e1 = make_journal_entry()
        e2 = make_journal_entry()
        seq1 = int(e1.entry_no.split('-')[-1])
        seq2 = int(e2.entry_no.split('-')[-1])
        self.assertEqual(seq2, seq1 + 1)


class BalanceValidationTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def test_unbalanced_post_raises(self):
        cash = ChartOfAccount.objects.get(account_code='1110')
        sales = ChartOfAccount.objects.get(account_code='4100')
        e = JournalEntry.objects.create(
            date=date(2026, 4, 15), narration='Bad', voucher_type='JOURNAL',
            reference_type='Manual', location_id=1,
        )
        JournalEntryLine.objects.create(entry=e, account=cash, debit=100)
        JournalEntryLine.objects.create(entry=e, account=sales, credit=99)
        with self.assertRaises(ValidationError):
            e.post()
        e.refresh_from_db()
        self.assertFalse(e.is_posted)

    def test_balanced_post_succeeds(self):
        e = make_journal_entry()
        e.refresh_from_db()
        self.assertTrue(e.is_posted)

    def test_paisa_tolerance(self):
        # Half-paisa drift should be tolerated (BALANCE_TOLERANCE = 0.005)
        cash = ChartOfAccount.objects.get(account_code='1110')
        sales = ChartOfAccount.objects.get(account_code='4100')
        e = JournalEntry.objects.create(
            date=date(2026, 4, 15), narration='Edge', voucher_type='JOURNAL',
            reference_type='Manual', location_id=1,
        )
        JournalEntryLine.objects.create(entry=e, account=cash, debit=Decimal('100.00'))
        JournalEntryLine.objects.create(entry=e, account=sales, credit=Decimal('100.00'))
        e.post()  # exactly balanced — no error


class PeriodLockOnSaveTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings(is_fy_closed=True, last_closed_fy='2025-26')

    def test_save_blocked_for_closed_fy(self):
        with self.assertRaises(PeriodLockedError):
            JournalEntry.objects.create(
                date=date(2025, 8, 1),  # inside closed FY
                narration='Stuck', voucher_type='JOURNAL',
                reference_type='Manual', location_id=1,
            )

    def test_save_allowed_outside_closed_fy(self):
        e = JournalEntry.objects.create(
            date=date(2026, 4, 15),  # next FY
            narration='OK', voucher_type='JOURNAL',
            reference_type='Manual', location_id=1,
        )
        self.assertIsNotNone(e.pk)

    def test_save_blocked_for_locked_period(self):
        LockedPeriod.objects.create(period='2026-05')
        with self.assertRaises(PeriodLockedError):
            JournalEntry.objects.create(
                date=date(2026, 5, 10),
                narration='Locked', voucher_type='JOURNAL',
                reference_type='Manual', location_id=1,
            )


class ReverseTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def test_reverse_creates_swapped_entry(self):
        original = make_journal_entry()
        from rest_framework.test import APIRequestFactory
        from rest_framework.test import force_authenticate
        from journals.views import JournalEntryViewSet
        from core.tests.utils import make_admin

        # Use the viewset directly — exercises the reverse action's lock guard.
        factory = APIRequestFactory()
        admin = make_admin()
        request = factory.post(f'/api/journals/journal-entries/{original.id}/reverse/',
                               data={'date': '2026-06-01'}, format='json')
        force_authenticate(request, user=admin)
        view = JournalEntryViewSet.as_view({'post': 'reverse_entry'})
        response = view(request, pk=original.id)
        self.assertEqual(response.status_code, 201, response.data)
        # New entry has swapped Dr/Cr
        rev_no = response.data['entry_no']
        rev = JournalEntry.objects.get(entry_no=rev_no)
        for orig_line, rev_line in zip(original.lines.all(), rev.lines.all()):
            self.assertEqual(orig_line.debit, rev_line.credit)
            self.assertEqual(orig_line.credit, rev_line.debit)

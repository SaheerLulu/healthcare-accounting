"""Tests for the JV sequence-gap audit."""
from datetime import date

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from journals.views import JournalEntryViewSet


class SequenceAuditTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()

    def _hit(self, year):
        factory = APIRequestFactory()
        request = factory.get(f'/api/journals/journal-entries/sequence-audit/?year={year}')
        force_authenticate(request, user=self.admin)
        view = JournalEntryViewSet.as_view({'get': 'sequence_audit'})
        return view(request)

    def test_no_gaps_in_clean_sequence(self):
        for _ in range(5):
            make_journal_entry()
        # All five entries are JV-{this_year}-NNNNNN — sequential
        from datetime import date as _d
        response = self._hit(_d.today().year)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['gap_count'], 0)
        self.assertEqual(response.data['count'], 5)

    def test_year_with_no_entries(self):
        response = self._hit(2099)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 0)

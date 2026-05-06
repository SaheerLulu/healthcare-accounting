"""Tests: a posted JV can be reversed at most once."""
from datetime import date

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from journals.views import JournalEntryViewSet


class ReverseOnceTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()
        self.original = make_journal_entry()

    def _reverse(self, entry_id, dt='2026-06-01'):
        request = self.factory.post(
            f'/api/journals/journal-entries/{entry_id}/reverse/',
            data={'date': dt}, format='json',
        )
        force_authenticate(request, user=self.admin)
        view = JournalEntryViewSet.as_view({'post': 'reverse_entry'})
        return view(request, pk=entry_id)

    def test_first_reversal_succeeds(self):
        response = self._reverse(self.original.id)
        self.assertEqual(response.status_code, 201, response.data)
        # Original now has reversal_entry related
        self.original.refresh_from_db()
        self.assertTrue(hasattr(self.original, 'reversal_entry'))
        self.assertEqual(self.original.reversal_entry.entry_no,
                         response.data['entry_no'])

    def test_second_reversal_blocked(self):
        self._reverse(self.original.id)
        response = self._reverse(self.original.id)
        self.assertEqual(response.status_code, 400)
        self.assertIn('already reversed', response.data['detail'])

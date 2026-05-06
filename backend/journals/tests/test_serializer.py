"""Tests for the JournalEntryCreateSerializer (WP 615 AC: ≥2 lines, balance to paisa)."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import seed_chart_and_mappings, make_settings
from journals.serializers import JournalEntryCreateSerializer


class CreateSerializerTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.cash = ChartOfAccount.objects.get(account_code='1110')
        self.sales = ChartOfAccount.objects.get(account_code='4100')

    def _payload(self, lines, dt=date(2026, 4, 15)):
        return {
            'date': dt, 'narration': 'Test',
            'voucher_type': 'JOURNAL', 'reference_type': 'Manual',
            'location_id': 1, 'lines': lines,
        }

    def test_rejects_single_line(self):
        ser = JournalEntryCreateSerializer(data=self._payload([
            {'account': self.cash.id, 'debit': '100.00', 'credit': '0.00'},
        ]))
        self.assertFalse(ser.is_valid())
        self.assertIn('two lines', str(ser.errors).lower())

    def test_rejects_unbalanced(self):
        ser = JournalEntryCreateSerializer(data=self._payload([
            {'account': self.cash.id, 'debit': '100.00', 'credit': '0.00'},
            {'account': self.sales.id, 'debit': '0.00', 'credit': '99.00'},
        ]))
        self.assertFalse(ser.is_valid())
        self.assertIn('unbalanced', str(ser.errors).lower())

    def test_rejects_zero_total(self):
        ser = JournalEntryCreateSerializer(data=self._payload([
            {'account': self.cash.id, 'debit': '0.00', 'credit': '0.00'},
            {'account': self.sales.id, 'debit': '0.00', 'credit': '0.00'},
        ]))
        self.assertFalse(ser.is_valid())

    def test_accepts_balanced_two_lines(self):
        ser = JournalEntryCreateSerializer(data=self._payload([
            {'account': self.cash.id, 'debit': '100.00', 'credit': '0.00'},
            {'account': self.sales.id, 'debit': '0.00', 'credit': '100.00'},
        ]))
        self.assertTrue(ser.is_valid(), ser.errors)

    def test_balanced_to_paisa(self):
        ser = JournalEntryCreateSerializer(data=self._payload([
            {'account': self.cash.id, 'debit': '99.99', 'credit': '0.00'},
            {'account': self.sales.id, 'debit': '0.00', 'credit': '99.99'},
        ]))
        self.assertTrue(ser.is_valid(), ser.errors)

    def test_period_lock_blocks_save(self):
        from core.period_lock import LockedPeriod
        LockedPeriod.objects.create(period='2026-04')
        ser = JournalEntryCreateSerializer(data=self._payload([
            {'account': self.cash.id, 'debit': '100.00', 'credit': '0.00'},
            {'account': self.sales.id, 'debit': '0.00', 'credit': '100.00'},
        ]))
        self.assertFalse(ser.is_valid())
        self.assertIn('date', ser.errors)

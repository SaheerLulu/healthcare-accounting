"""Regression tests for systemic root-cause fixes:

  RC1 — JournalEntryLine.save() now enforces the non-negative / not-both-sided
        sign invariant, so service-layer .objects.create() can no longer post
        balanced-but-malformed lines (negative payroll/petty-cash/asset entries).
  RC4 — _get_supply_type now uses the counterparty state as a fallback when the
        GSTIN is blank, so the posted GL tax head matches GSTR-1's classification.
"""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from django.core.exceptions import ValidationError
from django.test import TestCase

from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry, JournalEntryLine
from journals.services import JournalAutoGenerationService


class LineSignGuardTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.cash = ChartOfAccount.objects.get(account_code='1110')
        self.entry = JournalEntry.objects.create(
            date=date(2026, 4, 1), voucher_type='JOURNAL',
            reference_type='Manual', location_id=1,
        )

    def test_negative_debit_rejected_on_create(self):
        with self.assertRaises(ValidationError):
            JournalEntryLine.objects.create(
                entry=self.entry, account=self.cash, debit=Decimal('-100.00'))

    def test_negative_credit_rejected_on_create(self):
        with self.assertRaises(ValidationError):
            JournalEntryLine.objects.create(
                entry=self.entry, account=self.cash, credit=Decimal('-100.00'))

    def test_both_sided_line_rejected_on_create(self):
        with self.assertRaises(ValidationError):
            JournalEntryLine.objects.create(
                entry=self.entry, account=self.cash,
                debit=Decimal('100.00'), credit=Decimal('50.00'))

    def test_valid_line_still_saves(self):
        line = JournalEntryLine.objects.create(
            entry=self.entry, account=self.cash, debit=Decimal('100.00'))
        self.assertEqual(line.debit, Decimal('100.00'))


class SupplyTypeResolverTests(TestCase):
    """Company state is 27 (Maharashtra) via make_settings."""

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()  # gstin 27AABCT…, state_code '27'
        self.svc = JournalAutoGenerationService()

    def _resolve(self, gst_no, state):
        party = SimpleNamespace(gst_no=gst_no, state=state)
        return self.svc._get_supply_type(party.gst_no, self.svc._counterparty_state_code(party))

    def test_no_gstin_other_state_is_inter_state(self):
        # The old code defaulted intra → posted CGST+SGST while GSTR-1 said IGST.
        self.assertEqual(self._resolve('', 'Karnataka'), 'inter_state')

    def test_no_gstin_same_state_is_intra_state(self):
        self.assertEqual(self._resolve('', 'Maharashtra'), 'intra_state')

    def test_gstin_takes_precedence_over_state(self):
        # GSTIN 29 (Karnataka) beats a stale 'Maharashtra' state string.
        self.assertEqual(self._resolve('29ABCDE1234A1Z5', 'Maharashtra'), 'inter_state')

    def test_no_party_defaults_intra(self):
        self.assertEqual(self.svc._counterparty_state_code(None), '')
        self.assertEqual(self.svc._get_supply_type('', ''), 'intra_state')

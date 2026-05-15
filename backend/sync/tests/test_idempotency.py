"""Idempotency / dedup tests for the auto-generation service (WP 627)."""
from unittest.mock import patch

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.models import JournalEntry
from journals.services import JournalAutoGenerationService


class EntryExistsGuardTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def test_entry_exists_check(self):
        # Create a stub JE that mimics a previously synced PO
        from datetime import date
        from decimal import Decimal
        from core.models import ChartOfAccount
        cash = ChartOfAccount.objects.get(account_code='1110')
        sales = ChartOfAccount.objects.get(account_code='4100')
        e = JournalEntry.objects.create(
            date=date(2026, 4, 1), narration='already synced',
            voucher_type='PURCHASE', reference_type='PurchaseOrder',
            reference_id=42, location_id=1,
        )
        from journals.models import JournalEntryLine
        JournalEntryLine.objects.create(entry=e, account=cash, debit=Decimal('100'))
        JournalEntryLine.objects.create(entry=e, account=sales, credit=Decimal('100'))
        e.post()

        # Re-running should detect the duplicate and return None
        # without ever touching PurchaseOrderRO (we don't have one in test DB).
        self.assertTrue(self.svc._entry_exists('PurchaseOrder', 42))
        self.assertFalse(self.svc._entry_exists('PurchaseOrder', 999))


class MissingAccountFailsGracefullyTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        # Remove the CLOSING_STOCK mapping — this is the account every
        # purchase now debits, so a missing mapping should surface clearly.
        from core.models import AccountMapping
        AccountMapping.objects.filter(key='CLOSING_STOCK').delete()

    def test_missing_mapping_raises_clear_error(self):
        # Re-instantiating the service after mapping deletion should still
        # raise a clean ValueError when the missing key is requested.
        svc = JournalAutoGenerationService()
        with self.assertRaises(ValueError) as ctx:
            svc._acct('CLOSING_STOCK')
        self.assertIn('CLOSING_STOCK', str(ctx.exception))

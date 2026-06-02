"""Regression test for M10: closing a fiscal year whose closing month sits in a
locked period must return a clean 400 (not an unhandled HTTP 500)."""
import json
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.period_lock import LockedPeriod
from core.tests.utils import (
    make_admin, make_journal_entry, make_settings, seed_chart_and_mappings,
)
from core.views import CloseFiscalYearView


class CloseLockedPeriodTests(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def test_close_with_locked_closing_month_returns_400(self):
        # P&L activity so the close has something to do.
        make_journal_entry(d=date(2025, 6, 15), lines=[
            (self.coa['1110'], Decimal('1000'), Decimal('0')),
            (self.coa['4100'], Decimal('0'), Decimal('1000'))])
        # Lock the FY-end month (close JV is dated 2026-03-31).
        LockedPeriod.objects.create(period='2026-03', reason='GSTR-3B filed')

        request = self.factory.post(
            '/api/accounts/fy-close/',
            data=json.dumps({'fy_start_year': 2025, 'generate_opening': False}),
            content_type='application/json',
        )
        force_authenticate(request, self.admin)
        resp = CloseFiscalYearView.as_view()(request)

        self.assertEqual(resp.status_code, 400)
        self.assertIn('lock', str(resp.data).lower())

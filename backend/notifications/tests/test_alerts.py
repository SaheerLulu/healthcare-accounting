"""Tests for the alerting service."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from bills.models import Bill, BillLine
from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from notifications.models import Notification
from notifications.services import (
    alert_overdue_bills, alert_pending_approvals, generate_alerts,
)


class AlertTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.rent = ChartOfAccount.objects.get(account_code='5410')

    def test_overdue_bills_creates_notification(self):
        bill = Bill.objects.create(
            bill_no='V-1', bill_date=date(2026, 1, 1),
            due_date=date(2026, 1, 15), vendor_name='X',
            total_amount=Decimal('10000'), status='open',
        )
        BillLine.objects.create(bill=bill, account=self.rent, amount=Decimal('10000'))
        n = alert_overdue_bills(today=date(2026, 5, 1))
        self.assertEqual(n, 1)
        self.assertEqual(Notification.objects.filter(kind='bill_overdue').count(), 1)

    def test_dedup_on_repeat(self):
        bill = Bill.objects.create(
            bill_no='V-2', bill_date=date(2026, 1, 1),
            due_date=date(2026, 1, 15), vendor_name='X',
            total_amount=Decimal('10000'), status='open',
        )
        BillLine.objects.create(bill=bill, account=self.rent, amount=Decimal('10000'))
        alert_overdue_bills(today=date(2026, 5, 1))
        alert_overdue_bills(today=date(2026, 5, 1))
        self.assertEqual(Notification.objects.filter(
            kind='bill_overdue', related_id=bill.id).count(), 1)

    def test_pending_approval_alert(self):
        bill = Bill.objects.create(
            bill_no='V-3', bill_date=date(2026, 4, 1),
            vendor_name='X', total_amount=Decimal('100000'),
            approval_status='pending',
        )
        BillLine.objects.create(bill=bill, account=self.rent, amount=Decimal('100000'))
        n = alert_pending_approvals()
        self.assertEqual(n, 1)

    def test_generate_alerts_returns_per_rule_counts(self):
        result = generate_alerts(today=date(2026, 5, 1))
        for kind in ('overdue_bills', 'pending_approvals', 'emi_due',
                     'gstr3b_due', 'msme_window', 'pending_cheques'):
            self.assertIn(kind, result)

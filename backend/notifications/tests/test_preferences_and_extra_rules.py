"""Mute preferences hide notifications from the user's queryset; new alert
rules fire on stale SyncErrors and recent period-lock changes."""
from datetime import datetime, timedelta, timezone as tz
from unittest.mock import patch

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from core.tests.utils import make_admin
from notifications.models import Notification, NotificationPreference
from notifications.services import alert_sync_failures, alert_period_lock_change
from sync.models import SyncError


class MuteFilterTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='alice', password='x')
        self.client.force_authenticate(user=self.user)
        Notification.objects.create(
            user=self.user, kind='bill_overdue', title='Bill #1 overdue', priority='high',
        )
        Notification.objects.create(
            user=self.user, kind='emi_due', title='EMI #1 due', priority='normal',
        )

    def test_default_shows_all_kinds(self):
        res = self.client.get('/api/notifications/')
        rows = res.data.get('results', res.data) if hasattr(res.data, 'get') else res.data
        kinds = {n['kind'] for n in rows}
        self.assertEqual(kinds, {'bill_overdue', 'emi_due'})

    def test_muted_kind_is_hidden(self):
        NotificationPreference.objects.create(user=self.user, kind='emi_due', muted=True)
        res = self.client.get('/api/notifications/')
        rows = res.data.get('results', res.data) if hasattr(res.data, 'get') else res.data
        kinds = {n['kind'] for n in rows}
        self.assertEqual(kinds, {'bill_overdue'},
                         'muted kind must drop out of the queryset')

    def test_set_pref_upsert(self):
        # First call creates the row.
        res = self.client.post('/api/notifications/preferences/set/',
                               data={'kind': 'bill_overdue', 'muted': True},
                               format='json')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['muted'])
        # Second call updates the same row.
        res = self.client.post('/api/notifications/preferences/set/',
                               data={'kind': 'bill_overdue', 'muted': False},
                               format='json')
        self.assertFalse(res.data['muted'])
        self.assertEqual(
            NotificationPreference.objects.filter(user=self.user, kind='bill_overdue').count(),
            1, 'set should upsert, not duplicate',
        )

    def test_all_kinds_returns_full_list(self):
        NotificationPreference.objects.create(user=self.user, kind='emi_due', muted=True)
        res = self.client.get('/api/notifications/preferences/all-kinds/')
        # Every KIND_CHOICES entry is in the response.
        kinds = {row['kind'] for row in res.data}
        self.assertIn('bill_overdue', kinds)
        self.assertIn('sync_failure', kinds)
        self.assertIn('period_lock_change', kinds)
        muted = next(r for r in res.data if r['kind'] == 'emi_due')
        self.assertTrue(muted['muted'])


class StaleSyncFailureAlertTests(APITestCase):
    def setUp(self):
        make_admin()

    def test_fresh_error_does_not_fire(self):
        SyncError.objects.create(
            sync_type='b2b', source_id=1, error_message='boom',
        )
        n = alert_sync_failures(now=timezone.now())
        self.assertEqual(n, 0, 'errors under 1h old should not alert yet')

    def test_stale_error_fires(self):
        # Use update() to bypass auto_now_add and backdate created_at.
        SyncError.objects.create(sync_type='b2b', source_id=2, error_message='boom')
        two_hrs_ago = timezone.now() - timedelta(hours=2)
        SyncError.objects.filter(source_id=2).update(created_at=two_hrs_ago)
        n = alert_sync_failures(now=timezone.now())
        self.assertEqual(n, 1)
        self.assertTrue(
            Notification.objects.filter(kind='sync_failure', related_model='SyncError').exists()
        )

    def test_resolved_error_does_not_fire(self):
        SyncError.objects.create(
            sync_type='pos', source_id=3, error_message='resolved boom',
            resolved=True,
        )
        SyncError.objects.filter(source_id=3).update(
            created_at=timezone.now() - timedelta(hours=2),
        )
        n = alert_sync_failures(now=timezone.now())
        self.assertEqual(n, 0)


class PeriodLockChangeAlertTests(APITestCase):
    def test_recent_lock_fires_alert(self):
        from core.period_lock import LockedPeriod
        admin = make_admin()
        LockedPeriod.objects.create(
            period='2026-04', locked_by=admin, reason='FY closing',
        )
        n = alert_period_lock_change(since=timezone.now() - timedelta(hours=24))
        self.assertEqual(n, 1)
        notif = Notification.objects.get(kind='period_lock_change')
        self.assertEqual(notif.priority, 'critical')
        self.assertIn('2026-04', notif.title)

    def test_old_lock_does_not_fire(self):
        from core.period_lock import LockedPeriod
        admin = make_admin()
        lock = LockedPeriod.objects.create(
            period='2025-12', locked_by=admin, reason='old close',
        )
        # Backdate the lock to 48h ago.
        LockedPeriod.objects.filter(pk=lock.pk).update(
            locked_at=timezone.now() - timedelta(hours=48),
        )
        n = alert_period_lock_change(since=timezone.now() - timedelta(hours=24))
        self.assertEqual(n, 0)

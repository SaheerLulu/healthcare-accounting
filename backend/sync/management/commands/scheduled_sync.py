"""
Cron-friendly inventory sync. WP 670.

Holds an exclusive flock on a lock file so two cron firings 5 min apart
won't stack: if a previous run is still in progress, this one exits with
status 0 and a log line. Missed runs are simply absorbed by the next
incremental window — `last_synced_id` makes that safe.

Recommended cron:
    */5 * * * * cd /app/backend && .venv/bin/python manage.py scheduled_sync \\
                    >> /var/log/seefmed-sync.log 2>&1
"""
import errno
import fcntl
import sys
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from sync.services import InventorySyncService


class Command(BaseCommand):
    help = 'Run an incremental inventory sync. Idempotent. Cron-safe.'

    def add_arguments(self, parser):
        parser.add_argument('--lock-file', default=None,
                            help='Path to lock file (default <BASE_DIR>/.sync.lock)')

    def handle(self, *args, **opts):
        lock_path = Path(opts['lock_file'] or (Path(settings.BASE_DIR) / '.sync.lock'))
        # Open / create the lock file. Keep handle for the lifetime of the run.
        fh = open(lock_path, 'w')
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if exc.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                self.stdout.write(self.style.WARNING(
                    'scheduled_sync: previous run still active — skipping.'))
                sys.exit(0)
            raise

        try:
            svc = InventorySyncService()
            result = svc.sync_all()
            self.stdout.write(self.style.SUCCESS(
                f'scheduled_sync: ok — {result}'
            ))
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
            fh.close()

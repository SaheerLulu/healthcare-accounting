"""Cron-friendly alert generator.

Cron suggestion: `*/30 * * * * cd /app/backend && .venv/bin/python manage.py generate_alerts`
"""
from django.core.management.base import BaseCommand

from notifications.services import generate_alerts


class Command(BaseCommand):
    help = 'Run all notification rules and create new alerts.'

    def handle(self, *args, **opts):
        result = generate_alerts()
        for kind, count in result.items():
            self.stdout.write(f'  {kind}: {count}')
        total = sum(result.values())
        self.stdout.write(self.style.SUCCESS(f'Total: {total} new notifications.'))

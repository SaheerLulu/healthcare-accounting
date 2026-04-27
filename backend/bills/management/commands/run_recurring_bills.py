"""Cron entry point for generating due recurring bills.

    Run daily, e.g. via crontab:
        0 6 * * *  cd /opt/seefmed/backend && DJANGO_SETTINGS_MODULE=accounting_project.settings.prod \\
                  .venv/bin/python manage.py run_recurring_bills
"""
from datetime import date as date_cls
from django.core.management.base import BaseCommand
from bills.services import generate_due


class Command(BaseCommand):
    help = 'Generate bills for any active recurring profile whose next run date has arrived.'

    def add_arguments(self, parser):
        parser.add_argument('--date', type=str, default=None,
                            help='ISO date to run for (defaults to today). Useful for backfill.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Print what would be generated without creating bills.')

    def handle(self, *args, **options):
        target = options.get('date')
        today = date_cls.fromisoformat(target) if target else date_cls.today()
        if options.get('dry_run'):
            from bills.models import RecurringBill
            due = RecurringBill.objects.filter(status='active', next_run_date__lte=today)
            self.stdout.write(f'Would process {due.count()} profile(s) up to {today}:')
            for rb in due:
                self.stdout.write(f'  • #{rb.id} {rb.profile_name}: next_run={rb.next_run_date}, freq={rb.frequency}')
            return
        result = generate_due(today=today)
        self.stdout.write(self.style.SUCCESS(
            f"[{today}] generated {result['created']} bill(s); errors: {len(result['errors'])}"))
        for err in result['errors']:
            self.stdout.write(self.style.WARNING(f"  • profile {err['recurring_id']}: {err['error']}"))

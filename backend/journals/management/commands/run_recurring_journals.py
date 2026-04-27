"""Cron entry point for generating due recurring journal entries."""
from datetime import date as date_cls
from django.core.management.base import BaseCommand
from journals.services import generate_due_recurring_journals


class Command(BaseCommand):
    help = 'Generate journal entries for any active recurring profile whose next run date has arrived.'

    def add_arguments(self, parser):
        parser.add_argument('--date', type=str, default=None)
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        target = options.get('date')
        today = date_cls.fromisoformat(target) if target else date_cls.today()
        if options.get('dry_run'):
            from journals.models import RecurringJournal
            due = RecurringJournal.objects.filter(status='active', next_run_date__lte=today)
            self.stdout.write(f'Would process {due.count()} profile(s) up to {today}:')
            for rj in due:
                self.stdout.write(f'  • #{rj.id} {rj.profile_name}: next_run={rj.next_run_date}, freq={rj.frequency}')
            return
        result = generate_due_recurring_journals(today=today)
        self.stdout.write(self.style.SUCCESS(
            f"[{today}] generated {result['created']} entry(ies); errors: {len(result['errors'])}"))
        for err in result['errors']:
            self.stdout.write(self.style.WARNING(f"  • profile {err['recurring_id']}: {err['error']}"))

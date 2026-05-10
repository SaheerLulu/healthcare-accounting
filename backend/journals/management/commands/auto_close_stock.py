"""Auto-post Closing Stock JVs across every location.

Reads live inventory valuation from the inventory app (StockMovementRO ×
last-purchase-rate) and posts a Closing-Stock adjustment per location so the
GL `1190 Closing Stock` balance always tracks the physical inventory. Idempotent:
re-running on the same day is a no-op when GL already matches.

Run via cron once a day (e.g. 23:55 IST):

    DJANGO_SETTINGS_MODULE=accounting_project.settings.prod \
        python manage.py auto_close_stock
"""
from datetime import date as _date_cls

from django.core.management.base import BaseCommand

from journals.services import auto_close_stock_run


class Command(BaseCommand):
    help = 'Post a Closing-Stock JV for every location to match live inventory valuation.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--as-of', type=str,
            help='Run as if today were YYYY-MM-DD (default: today).',
        )

    def handle(self, *args, **opts):
        as_of_str = opts.get('as_of')
        as_of = _date_cls.fromisoformat(as_of_str) if as_of_str else _date_cls.today()

        result = auto_close_stock_run(as_of=as_of)

        for row in result['created']:
            self.stdout.write(
                f"  posted {row['entry_no']}  {row['location_name']:<30}  ₹{row['value']}"
            )
        for row in result['skipped']:
            self.stdout.write(
                f"  skipped {row['location_name']:<30}  ({row['reason']})"
            )
        for row in result['errors']:
            self.stdout.write(self.style.ERROR(
                f"  failed  {row['location_name']:<30}  {row['error']}"
            ))

        self.stdout.write(self.style.SUCCESS(
            f"auto_close_stock: {len(result['created'])} posted, "
            f"{len(result['skipped'])} skipped, {len(result['errors'])} errors "
            f"(as-of {result['as_of']})"
        ))

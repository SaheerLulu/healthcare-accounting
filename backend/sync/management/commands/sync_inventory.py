from django.core.management.base import BaseCommand
from sync.services import InventorySyncService


class Command(BaseCommand):
    help = 'Sync inventory transactions and generate journal entries'

    def handle(self, *args, **options):
        self.stdout.write('Starting inventory sync...')
        service = InventorySyncService()
        result = service.sync_all()
        self.stdout.write(self.style.SUCCESS(
            f"Sync complete: {result['total']} entries created "
            f"(purchases={result['purchases']}, pos={result['pos']}, "
            f"b2b={result['b2b']}, returns={result['returns']})"
        ))

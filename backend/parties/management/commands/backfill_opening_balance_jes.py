"""Post GL entries for existing PartyOpeningBalance rows that don't have one.

Run once after enabling per-party ledgers so legacy opening balances (which were
previously arithmetic-only) get a real JE against 3300 Opening Balance Equity.
Idempotent — rows that already have a journal_entry are skipped. Rows whose
as_of_date falls in a locked period are skipped and reported (post them manually
in an open period if needed).
"""
from django.core.management.base import BaseCommand

from parties.models import PartyOpeningBalance
from parties.opening_balance import post_opening_balance_je


class Command(BaseCommand):
    help = 'Post GL entries for opening balances that lack one.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Report what would be posted without writing.')

    def handle(self, *args, **opts):
        dry = opts['dry_run']
        rows = PartyOpeningBalance.objects.filter(journal_entry__isnull=True)
        posted = skipped = failed = 0
        for ob in rows:
            if (ob.amount or 0) == 0:
                skipped += 1
                continue
            if dry:
                posted += 1
                continue
            try:
                post_opening_balance_je(ob)
                posted += 1
            except Exception as e:  # locked period, missing master, etc.
                failed += 1
                self.stdout.write(self.style.WARNING(
                    f'  skip {ob.party_type}#{ob.party_id}: {e}'
                ))
        self.stdout.write(self.style.SUCCESS(
            f'Opening-balance JEs — posted {posted}, zero/skipped {skipped}, '
            f'failed {failed}' + ('  [DRY-RUN]' if dry else '')
        ))

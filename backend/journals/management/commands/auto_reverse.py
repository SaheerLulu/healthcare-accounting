"""Process due reversing journals.

Tally lets you mark a voucher as a "Reversing Journal" with a reversal date.
On the reversal date, an offsetting (reversal) entry is created automatically.

Run via cron once a day:
    DJANGO_SETTINGS_MODULE=accounting_project.settings.prod \
      python manage.py auto_reverse
"""
from datetime import date as _date

from django.core.management.base import BaseCommand
from django.db import transaction

from journals.models import JournalEntry, JournalEntryLine


def _build_reversal(entry):
    """Create the offsetting reversal entry for a posted JournalEntry.

    Mirrors the per-line debit/credit swap done by the API's
    `journals/entries/{id}/reverse/` action so behaviour is consistent.
    """
    reversal = JournalEntry.objects.create(
        date=entry.reversal_date,
        narration=f'Auto-reversal of {entry.entry_no}: {entry.narration}'.strip(': '),
        voucher_type=entry.voucher_type,
        reference_type=entry.reference_type,
        reference_id=entry.reference_id,
        location_id=entry.location_id,
        reversal_of=entry,
        created_by=entry.created_by,
    )
    for line in entry.lines.all():
        JournalEntryLine.objects.create(
            entry=reversal,
            account=line.account,
            debit=line.credit,
            credit=line.debit,
            narration=line.narration,
            party_type=line.party_type,
            party_id=line.party_id,
        )
    reversal.is_posted = True
    reversal.save()
    return reversal


class Command(BaseCommand):
    help = 'Create reversal entries for posted journal entries whose reversal_date has passed.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--as-of', type=str,
            help='Run as if today were YYYY-MM-DD (default: today).',
        )

    def handle(self, *args, **opts):
        as_of_str = opts.get('as_of')
        as_of = _date.fromisoformat(as_of_str) if as_of_str else _date.today()

        candidates = JournalEntry.objects.filter(
            is_posted=True,
            auto_reversed=False,
            reversal_date__isnull=False,
            reversal_date__lte=as_of,
            reversal_of__isnull=True,  # don't reverse a reversal
        )

        created = 0
        errors = []
        for entry in candidates:
            try:
                with transaction.atomic():
                    if hasattr(entry, 'reversal_entry'):
                        # Already reversed manually — skip silently.
                        entry.auto_reversed = True
                        entry.save(update_fields=['auto_reversed'])
                        continue
                    reversal = _build_reversal(entry)
                    entry.auto_reversed = True
                    entry.save(update_fields=['auto_reversed'])
                    created += 1
                    self.stdout.write(
                        f'  reversed {entry.entry_no} → {reversal.entry_no}'
                    )
            except Exception as exc:
                errors.append({'entry_no': entry.entry_no, 'error': str(exc)})
                self.stdout.write(self.style.ERROR(
                    f'  failed {entry.entry_no}: {exc}'
                ))

        self.stdout.write(self.style.SUCCESS(
            f'auto_reverse: {created} reversals created, {len(errors)} errors '
            f'(as-of {as_of.isoformat()})'
        ))

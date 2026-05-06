"""Seed the five default accounting roles with their capability flags."""
from django.core.management.base import BaseCommand
from core.models import AccountingRole


class Command(BaseCommand):
    help = 'Create the default accounting roles (READ_ONLY/BOOKKEEPER/SENIOR_ACCOUNTANT/CFO/AUDITOR).'

    def handle(self, *args, **opts):
        for code, label in AccountingRole.CODE_CHOICES:
            perms = AccountingRole.DEFAULT_PERMISSIONS[code]
            obj, created = AccountingRole.objects.update_or_create(
                code=code,
                defaults={'name': label, **perms},
            )
            verb = 'created' if created else 'updated'
            self.stdout.write(self.style.SUCCESS(f'  {verb}: {label} ({code})'))
        self.stdout.write(self.style.SUCCESS(
            f'\nDone. {AccountingRole.objects.count()} roles total.'
        ))

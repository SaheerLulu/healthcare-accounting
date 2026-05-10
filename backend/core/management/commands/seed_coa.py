from django.core.management.base import BaseCommand
from core.models import ChartOfAccount, AccountMapping
from core.coa_data import GROUPS, LEAVES


class Command(BaseCommand):
    help = 'Seed the comprehensive Tally-style Chart of Accounts and AccountMapping rows.'

    def handle(self, *args, **options):
        groups_created = 0
        leaves_created = 0
        mappings_created = 0
        parents_linked = 0

        # Pass 1: groups (parents). GROUPS is in topological order so the
        # parent FK always resolves on lookup.
        for code, name, acct_type, subtype, parent_code in GROUPS:
            parent = None
            if parent_code:
                parent = ChartOfAccount.objects.filter(account_code=parent_code).first()
            account, created = ChartOfAccount.objects.get_or_create(
                account_code=code,
                defaults={
                    'account_name': name,
                    'account_type': acct_type,
                    'account_subtype': subtype,
                    'parent': parent,
                    'is_leaf': False,
                },
            )
            if created:
                groups_created += 1
            elif account.parent_id is None and parent is not None:
                # Re-home an existing top-level account under the new group.
                account.parent = parent
                account.is_leaf = False
                account.save(update_fields=['parent', 'is_leaf'])
                parents_linked += 1

        # Pass 2: leaves with parent FK set.
        for code, name, acct_type, subtype, parent_code, _mapping_key in LEAVES:
            parent = None
            if parent_code:
                parent = ChartOfAccount.objects.filter(account_code=parent_code).first()
            account, created = ChartOfAccount.objects.get_or_create(
                account_code=code,
                defaults={
                    'account_name': name,
                    'account_type': acct_type,
                    'account_subtype': subtype,
                    'parent': parent,
                    'is_leaf': True,
                },
            )
            if created:
                leaves_created += 1
            elif account.parent_id is None and parent is not None:
                account.parent = parent
                account.save(update_fields=['parent'])
                parents_linked += 1

        # Pass 3: account mappings.
        for code, _name, _t, _s, _p, mapping_key in LEAVES:
            if not mapping_key:
                continue
            account = ChartOfAccount.objects.filter(account_code=code).first()
            if not account:
                continue
            _, mapping_created = AccountMapping.objects.get_or_create(
                key=mapping_key,
                defaults={'account': account},
            )
            if mapping_created:
                mappings_created += 1

        self.stdout.write(self.style.SUCCESS(
            f'COA seeded: {groups_created} groups + {leaves_created} leaves new, '
            f'{parents_linked} parents linked, {mappings_created} mappings new'
        ))

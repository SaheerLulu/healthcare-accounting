"""Backfill any chart-of-accounts row that's defined in the canonical
`core.coa_data` list but never created (older installs ran an earlier
seed_coa with fewer codes). After ensuring every group + leaf exists, we
re-run the mapping seed so any newly-created leaf carrying a `mapping_key`
gets its AccountMapping row.

Idempotent — uses get_or_create / update_or_create throughout.
"""
from django.db import migrations


def backfill_chart_of_accounts(apps, schema_editor):
    # Late import — coa_data has no Django model dependency, so this is safe
    # at migration-replay time. If the module is later removed, the migration
    # has already run on every existing install and won't re-execute.
    from core.coa_data import GROUPS, LEAVES

    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    AccountMapping = apps.get_model('core', 'AccountMapping')

    # Pass 1: groups, top-down (already topological in the source list).
    for code, name, acct_type, subtype, parent_code in GROUPS:
        parent = None
        if parent_code:
            parent = ChartOfAccount.objects.filter(account_code=parent_code).first()
        ChartOfAccount.objects.get_or_create(
            account_code=code,
            defaults={
                'account_name': name,
                'account_type': acct_type,
                'account_subtype': subtype,
                'parent': parent,
                'is_leaf': False,
            },
        )

    # Pass 2: leaves with parent FK.
    for code, name, acct_type, subtype, parent_code, _mapping_key in LEAVES:
        parent = None
        if parent_code:
            parent = ChartOfAccount.objects.filter(account_code=parent_code).first()
        ChartOfAccount.objects.get_or_create(
            account_code=code,
            defaults={
                'account_name': name,
                'account_type': acct_type,
                'account_subtype': subtype,
                'parent': parent,
                'is_leaf': True,
            },
        )

    # Pass 3: ensure every leaf with a mapping_key has an AccountMapping row.
    for code, _name, _t, _s, _p, mapping_key in LEAVES:
        if not mapping_key:
            continue
        acct = ChartOfAccount.objects.filter(account_code=code).first()
        if not acct:
            continue
        AccountMapping.objects.update_or_create(
            key=mapping_key, defaults={'account': acct},
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0015_seed_missing_account_mappings'),
    ]

    operations = [
        migrations.RunPython(backfill_chart_of_accounts, reverse_code=migrations.RunPython.noop),
    ]

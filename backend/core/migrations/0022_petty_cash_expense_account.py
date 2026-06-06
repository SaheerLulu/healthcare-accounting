from django.db import migrations


def add_petty_expense_account(apps, schema_editor):
    """Seed the Petty Cash Expenses (5475) leaf + its PETTY_EXPENSE mapping.

    Petty expenses recorded at the pharmacy counter post to this single
    INDIRECT expense account (per client choice: one generic account, free-text
    note). Shared (location_id NULL) so the mapping resolver falls back to it
    for every store. Idempotent.
    """
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    AccountMapping = apps.get_model('core', 'AccountMapping')

    indirect = ChartOfAccount.objects.filter(
        account_code='5700', location_id__isnull=True
    ).first()
    if indirect is None:
        # COA not seeded yet (fresh DB seeds from coa_data directly); nothing to do.
        return
    if indirect.is_leaf:
        indirect.is_leaf = False
        indirect.save(update_fields=['is_leaf'])

    acct, _ = ChartOfAccount.objects.get_or_create(
        account_code='5475', location_id=None,
        defaults={
            'account_name': 'Petty Cash Expenses',
            'account_type': 'EXPENSE',
            'account_subtype': 'Other_Expense',
            'parent': indirect,
            'is_leaf': True,
            'is_active': True,
        },
    )
    AccountMapping.objects.get_or_create(
        key='PETTY_EXPENSE', location_id=None,
        defaults={'account': acct},
    )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0021_losses_to_indirect_expenses'),
    ]

    operations = [
        migrations.RunPython(add_petty_expense_account, noop_reverse),
    ]

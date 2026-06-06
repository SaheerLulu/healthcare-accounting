from django.db import migrations


def add_stock_audit_variance_account(apps, schema_editor):
    """Seed the dedicated Stock Audit Variance (5490) leaf + its mapping.

    Stock audit (physical-count) variances post to this INDIRECT expense,
    kept separate from write-off losses (Inventory Loss 5540 / Expiry Loss
    5550), which retain their existing classification. Shared (location_id
    NULL) — the mapping resolver falls back to this for every store.
    Idempotent so re-running is a no-op.
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
        account_code='5490', location_id=None,
        defaults={
            'account_name': 'Stock Audit Variance',
            'account_type': 'EXPENSE',
            'account_subtype': 'Other_Expense',
            'parent': indirect,
            'is_leaf': True,
            'is_active': True,
        },
    )
    AccountMapping.objects.get_or_create(
        key='STOCK_AUDIT_VARIANCE', location_id=None,
        defaults={'account': acct},
    )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0020_chartofaccount_party_id_chartofaccount_party_type_and_more'),
    ]

    operations = [
        migrations.RunPython(add_stock_audit_variance_account, noop_reverse),
    ]

from django.db import migrations


def reparent_losses_to_indirect(apps, schema_editor):
    """Move Inventory Loss (5540) / Expiry Loss (5550) from Direct Expenses
    (5500) to Indirect Expenses (5700).

    Abnormal losses — stock audit variances and damage/expiry write-offs — are
    indirect expenses, not part of the trading (direct) cost of goods. This
    aligns deployed DBs with the updated coa_data seed. Resolves the target
    5700 group per location scope (so per-store clones reparent to their own
    store's group), falling back to the shared NULL-location group.
    """
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    AccountMapping = apps.get_model('core', 'AccountMapping')

    # Collect loss leaves via their semantic mapping so per-store clones with
    # suffixed codes (e.g. 5540-MUM) are caught too…
    loss_ids = set(
        AccountMapping.objects.filter(key__in=['INVENTORY_LOSS', 'EXPIRY_LOSS'])
        .values_list('account_id', flat=True)
    )
    # …and belt-and-braces by code for any unmapped row.
    loss_ids |= set(
        ChartOfAccount.objects.filter(account_code__in=['5540', '5550'])
        .values_list('id', flat=True)
    )

    indirect_shared = ChartOfAccount.objects.filter(
        account_code='5700', location_id__isnull=True
    ).first()

    touched_parents = set()
    for acct in ChartOfAccount.objects.filter(id__in=loss_ids):
        target = ChartOfAccount.objects.filter(
            account_code='5700', location_id=acct.location_id
        ).first() or indirect_shared
        if target is None or acct.parent_id == target.id:
            continue
        if acct.parent_id:
            touched_parents.add(acct.parent_id)
        acct.parent_id = target.id
        acct.save(update_fields=['parent'])
        touched_parents.add(target.id)

    # Keep is_leaf honest on every parent we moved an account off of / onto.
    for pid in touched_parents:
        has_children = ChartOfAccount.objects.filter(parent_id=pid).exists()
        ChartOfAccount.objects.filter(id=pid).update(is_leaf=not has_children)


def noop_reverse(apps, schema_editor):
    # One-way classification alignment; reverting is not meaningful.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0020_chartofaccount_party_id_chartofaccount_party_type_and_more'),
    ]

    operations = [
        migrations.RunPython(reparent_losses_to_indirect, noop_reverse),
    ]

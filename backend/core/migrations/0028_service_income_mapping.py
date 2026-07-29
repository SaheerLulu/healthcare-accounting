"""Bind SERVICE_INCOME → 4330 for taxable clinical services billed at the counter.

The pharmacy POS can now sell clinical services. Exempt ones (a consultation, a
dressing — Notification 12/2017-CT(R) Sl. 74) post to 4320 CONSULTATION_INCOME, the
same head reception's fee collections already use, so GSTR-3B 3.1(c) exempt outward
supplies picks them up with no further change.

Taxable ones (a cosmetic or aesthetic procedure at 18%) must NOT go there: 4320 is
declared GST-exempt, and mixing a taxable supply into it would misstate the exempt
figure in 3B. They get their own head.

Shared (location_id NULL) rows only — ensure_locations_bootstrapped() clones them per
store on the next sync. Idempotent, and modelled on 0025_sales_income_mappings.
"""
from django.db import migrations


def add_service_income_mapping(apps, schema_editor):
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    AccountMapping = apps.get_model('core', 'AccountMapping')

    acct = ChartOfAccount.objects.filter(
        account_code='4330', location_id__isnull=True,
    ).first()
    if acct is None:
        parent_4000 = ChartOfAccount.objects.filter(
            account_code='4000', location_id__isnull=True,
        ).first()
        acct = ChartOfAccount.objects.create(
            account_code='4330', location_id=None,
            account_name='Sales - Procedure / Day-care',
            account_type='REVENUE',
            account_subtype='Sales',
            parent=parent_4000,
            is_leaf=True,
            is_active=True,
        )

    AccountMapping.objects.get_or_create(
        key='SERVICE_INCOME', location_id=None, defaults={'account': acct},
    )


def drop_service_income_mapping(apps, schema_editor):
    AccountMapping = apps.get_model('core', 'AccountMapping')
    AccountMapping.objects.filter(key='SERVICE_INCOME').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0027_chartofaccount_is_shared'),
    ]

    operations = [
        migrations.RunPython(add_service_income_mapping, drop_service_income_mapping),
    ]

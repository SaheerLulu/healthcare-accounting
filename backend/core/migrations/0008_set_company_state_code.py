from django.db import migrations


def set_state_code(apps, schema_editor):
    """Populate the singleton AccountingSettings with the company's state code.

    The Indian GST classifier uses this 2-digit code as the anchor for
    intra/inter-state determination when the GSTIN is not yet filled in. The
    user can later set gstin/pan/tan via /settings → Company Info.
    """
    AccountingSettings = apps.get_model('core', 'AccountingSettings')
    obj, _ = AccountingSettings.objects.get_or_create(
        pk=1,
        defaults={'company_name': 'Seefmed'},
    )
    if not obj.state_code:
        obj.state_code = '32'  # Kerala
        obj.save(update_fields=['state_code'])


def reverse_state_code(apps, schema_editor):
    AccountingSettings = apps.get_model('core', 'AccountingSettings')
    AccountingSettings.objects.filter(pk=1, state_code='32').update(state_code='')


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0007_seed_payroll_rent_electricity'),
    ]

    operations = [
        migrations.RunPython(set_state_code, reverse_state_code),
    ]

from django.db import migrations


def fix_sales_returns_type(apps, schema_editor):
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    ChartOfAccount.objects.filter(account_code='5200').update(account_type='REVENUE')


def restore_sales_returns_type(apps, schema_editor):
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    ChartOfAccount.objects.filter(account_code='5200').update(account_type='EXPENSE')


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0005_alter_accountmapping_key'),
    ]

    operations = [
        migrations.RunPython(fix_sales_returns_type, restore_sales_returns_type),
    ]

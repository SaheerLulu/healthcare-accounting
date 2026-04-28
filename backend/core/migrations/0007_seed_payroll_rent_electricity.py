from django.db import migrations


NEW_ACCOUNTS = [
    # (code, name, type, subtype, mapping_key)
    ('2170', 'PF Payable',               'LIABILITY', 'Payable',       'PF_PAYABLE'),
    ('2180', 'ESI Payable',              'LIABILITY', 'Payable',       'ESI_PAYABLE'),
    ('2190', 'Professional Tax Payable', 'LIABILITY', 'Payable',       'PT_PAYABLE'),
    ('2200', 'Net Salary Payable',       'LIABILITY', 'Payable',       'NET_SALARY_PAYABLE'),
    ('5400', 'Salary Expense',           'EXPENSE',   'Other_Expense', 'SALARY_EXPENSE'),
    ('5410', 'Rent Expense',             'EXPENSE',   'Other_Expense', 'RENT_EXPENSE'),
    ('5420', 'Electricity Expense',      'EXPENSE',   'Other_Expense', 'ELECTRICITY_EXPENSE'),
]


def seed_payroll_rent_electricity(apps, schema_editor):
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    AccountMapping = apps.get_model('core', 'AccountMapping')

    for code, name, acct_type, subtype, _key in NEW_ACCOUNTS:
        ChartOfAccount.objects.get_or_create(
            account_code=code,
            defaults={
                'account_name': name,
                'account_type': acct_type,
                'account_subtype': subtype,
                'is_leaf': True,
            },
        )

    for code, _name, _t, _s, key in NEW_ACCOUNTS:
        account = ChartOfAccount.objects.filter(account_code=code).first()
        if account:
            AccountMapping.objects.get_or_create(
                key=key,
                defaults={'account': account},
            )


def reverse_payroll_rent_electricity(apps, schema_editor):
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    AccountMapping = apps.get_model('core', 'AccountMapping')

    keys = [k for _c, _n, _t, _s, k in NEW_ACCOUNTS]
    AccountMapping.objects.filter(key__in=keys).delete()

    codes = [c for c, _n, _t, _s, _k in NEW_ACCOUNTS]
    ChartOfAccount.objects.filter(account_code__in=codes).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0006_fix_sales_returns_type'),
    ]

    operations = [
        migrations.RunPython(seed_payroll_rent_electricity, reverse_payroll_rent_electricity),
    ]

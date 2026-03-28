from django.db import migrations


DEFAULT_CODES = {
    'PURCHASES': '5100',
    'INPUT_CGST': '1140',
    'INPUT_SGST': '1150',
    'INPUT_IGST': '1160',
    'TRADE_PAYABLES': '2110',
    'SALES_POS': '4100',
    'SALES_B2B': '4200',
    'OUTPUT_CGST': '2120',
    'OUTPUT_SGST': '2130',
    'OUTPUT_IGST': '2140',
    'CASH': '1110',
    'TRADE_RECEIVABLES': '1130',
    'SALES_RETURNS': '5200',
    'PURCHASE_RETURNS': '5300',
    'TDS_RECEIVABLE': '1170',
    'TDS_PAYABLE': '2150',
    'RETAINED_EARNINGS': '3200',
    'ROUND_OFF': '6100',
    'RCM_LIABILITY': '2160',
    'BANK': '1120',
}

NEW_ACCOUNTS = {
    '5100': {'name': 'Purchases', 'type': 'EXPENSE', 'subtype': 'Purchases'},
    '1140': {'name': 'Input CGST', 'type': 'ASSET', 'subtype': 'Input_GST'},
    '1150': {'name': 'Input SGST', 'type': 'ASSET', 'subtype': 'Input_GST'},
    '1160': {'name': 'Input IGST', 'type': 'ASSET', 'subtype': 'Input_GST'},
    '2110': {'name': 'Trade Payables', 'type': 'LIABILITY', 'subtype': 'Payable'},
    '4100': {'name': 'Sales - POS', 'type': 'REVENUE', 'subtype': 'Sales'},
    '4200': {'name': 'Sales - B2B', 'type': 'REVENUE', 'subtype': 'Sales'},
    '2120': {'name': 'Output CGST', 'type': 'LIABILITY', 'subtype': 'Output_GST'},
    '2130': {'name': 'Output SGST', 'type': 'LIABILITY', 'subtype': 'Output_GST'},
    '2140': {'name': 'Output IGST', 'type': 'LIABILITY', 'subtype': 'Output_GST'},
    '1110': {'name': 'Cash', 'type': 'ASSET', 'subtype': 'Cash'},
    '1130': {'name': 'Trade Receivables', 'type': 'ASSET', 'subtype': 'Receivable'},
    '5200': {'name': 'Sales Returns', 'type': 'EXPENSE', 'subtype': 'Other_Expense'},
    '5300': {'name': 'Purchase Returns', 'type': 'EXPENSE', 'subtype': 'Purchases'},
    '1170': {'name': 'TDS Receivable', 'type': 'ASSET', 'subtype': 'TDS_Receivable'},
    '2150': {'name': 'TDS Payable', 'type': 'LIABILITY', 'subtype': 'TDS_Payable'},
    '3200': {'name': 'Retained Earnings', 'type': 'EQUITY', 'subtype': 'Retained_Earnings'},
    '6100': {'name': 'Round Off', 'type': 'EXPENSE', 'subtype': 'Other_Expense'},
    '2160': {'name': 'RCM GST Liability', 'type': 'LIABILITY', 'subtype': 'Output_GST'},
    '1120': {'name': 'Bank Account', 'type': 'ASSET', 'subtype': 'Bank'},
}


def populate_mappings(apps, schema_editor):
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    AccountMapping = apps.get_model('core', 'AccountMapping')

    for code, info in NEW_ACCOUNTS.items():
        ChartOfAccount.objects.get_or_create(
            account_code=code,
            defaults={
                'account_name': info['name'],
                'account_type': info['type'],
                'account_subtype': info['subtype'],
                'is_leaf': True,
            }
        )

    for key, code in DEFAULT_CODES.items():
        account = ChartOfAccount.objects.filter(account_code=code).first()
        if account:
            AccountMapping.objects.get_or_create(
                key=key,
                defaults={'account': account}
            )


def reverse_mappings(apps, schema_editor):
    AccountMapping = apps.get_model('core', 'AccountMapping')
    AccountMapping.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0002_accountingsettings_is_fy_closed_and_more'),
    ]

    operations = [
        migrations.RunPython(populate_mappings, reverse_mappings),
    ]

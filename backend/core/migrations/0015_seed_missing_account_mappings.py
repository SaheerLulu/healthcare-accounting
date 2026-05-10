"""Backfill any AccountMapping row that's defined in KEY_CHOICES but never
seeded into the database. Uses the DEFAULT_CODES dict on the model to pick
the target ChartOfAccount; skips silently when the code is missing (the
follow-up `seed_coa` run will fill it in).

Idempotent: re-running this migration creates nothing new because each row
is added with `update_or_create`.
"""
from django.db import migrations


def seed_missing_mappings(apps, schema_editor):
    AccountMapping = apps.get_model('core', 'AccountMapping')
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')

    # Mirror of AccountMapping.DEFAULT_CODES — kept inline so the migration
    # never breaks if the model dict is renamed/removed in future.
    defaults = {
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
        'SALARY_EXPENSE': '5400',
        'PF_PAYABLE': '2170',
        'ESI_PAYABLE': '2180',
        'PT_PAYABLE': '2190',
        'NET_SALARY_PAYABLE': '2200',
        'RENT_EXPENSE': '5410',
        'ELECTRICITY_EXPENSE': '5420',
        'CLOSING_STOCK': '1190',
        'INVENTORY_LOSS': '5540',
        'EXPIRY_LOSS': '5550',
        'STOCK_TRANSFER_TRANSIT': '1191',
        'TCS_PAYABLE': '2210',
        'BAD_DEBTS_EXPENSE': '5480',
        'PROVISION_BAD_DEBTS': '2156',
        'PETTY_CASH': '1115',
        'BANK_CHARGES': '5450',
        'INTEREST_EXPENSE': '5451',
        'INTEREST_INCOME': '4910',
        'DOCTOR_FEES': '5441',
        'DISCOUNT_ALLOWED': '5210',
        'DISCOUNT_RECEIVED': '5310',
        'GST_LATE_FEE': '5454',
        'DEPRECIATION_EXPENSE': '5481',
        'PROFESSIONAL_FEES': '5440',
        'AUDIT_FEES': '5442',
        'LEGAL_FEES': '5443',
        'INSURANCE_EXPENSE': '5430',
        'TRAVEL_CONVEYANCE': '5472',
        'AMC_CHARGES': '5426',
        'REPAIRS_MAINTENANCE': '5424',
        'OFFICE_MAINTENANCE': '5423',
        'PRINTING_STATIONERY': '5460',
        'POSTAGE_COURIER': '5461',
        'INTERNET_TELEPHONE': '5422',
        'STAFF_WELFARE': '5404',
        'STAFF_ADVANCE': '1320',
        'SUPPLIER_ADVANCE': '1310',
        'CUSTOMER_ADVANCE': '2196',
        'CHEQUES_OUTSTANDING': '2113',
        'SUSPENSE': '6200',
        'COGS': '5560',
    }

    for key, code in defaults.items():
        acct = ChartOfAccount.objects.filter(account_code=code).first()
        if not acct:
            continue
        AccountMapping.objects.update_or_create(
            key=key, defaults={'account': acct},
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0014_perpetual_inventory'),
    ]

    operations = [
        migrations.RunPython(seed_missing_mappings, reverse_code=migrations.RunPython.noop),
    ]

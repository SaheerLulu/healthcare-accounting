from django.db import migrations, models


def add_cogs_mapping(apps, schema_editor):
    """Wire AccountMapping['COGS'] to the existing 5560 ledger so perpetual
    sales JVs have a target right after this migration runs. No-op when 5560
    isn't seeded yet (will be picked up by the next `seed_coa` run).
    """
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    AccountMapping = apps.get_model('core', 'AccountMapping')
    cogs = ChartOfAccount.objects.filter(account_code='5560').first()
    if cogs:
        AccountMapping.objects.update_or_create(
            key='COGS', defaults={'account': cogs},
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0013_alter_accountmapping_key_activity_coverage'),
    ]

    operations = [
        migrations.AddField(
            model_name='accountingsettings',
            name='stock_method',
            field=models.CharField(
                choices=[
                    ('periodic', 'Periodic (purchases → 5100; closing stock at period end)'),
                    ('perpetual', 'Perpetual (purchases → 1190; COGS posted per sale)'),
                ],
                default='periodic',
                help_text='How inventory hits the GL. Periodic is Tally default; '
                          'perpetual posts stock + COGS in real time.',
                max_length=10,
            ),
        ),
        migrations.AlterField(
            model_name='accountmapping',
            name='key',
            field=models.CharField(
                choices=[
                    ('PURCHASES', 'Purchases'),
                    ('INPUT_CGST', 'Input CGST'),
                    ('INPUT_SGST', 'Input SGST'),
                    ('INPUT_IGST', 'Input IGST'),
                    ('TRADE_PAYABLES', 'Trade Payables'),
                    ('SALES_POS', 'Sales - POS'),
                    ('SALES_B2B', 'Sales - B2B'),
                    ('OUTPUT_CGST', 'Output CGST'),
                    ('OUTPUT_SGST', 'Output SGST'),
                    ('OUTPUT_IGST', 'Output IGST'),
                    ('CASH', 'Cash'),
                    ('TRADE_RECEIVABLES', 'Trade Receivables'),
                    ('SALES_RETURNS', 'Sales Returns'),
                    ('PURCHASE_RETURNS', 'Purchase Returns'),
                    ('TDS_RECEIVABLE', 'TDS Receivable'),
                    ('TDS_PAYABLE', 'TDS Payable'),
                    ('RETAINED_EARNINGS', 'Retained Earnings'),
                    ('ROUND_OFF', 'Round Off'),
                    ('RCM_LIABILITY', 'RCM GST Liability'),
                    ('BANK', 'Bank'),
                    ('SALARY_EXPENSE', 'Salary Expense'),
                    ('PF_PAYABLE', 'PF Payable'),
                    ('ESI_PAYABLE', 'ESI Payable'),
                    ('PT_PAYABLE', 'Professional Tax Payable'),
                    ('NET_SALARY_PAYABLE', 'Net Salary Payable'),
                    ('RENT_EXPENSE', 'Rent Expense'),
                    ('ELECTRICITY_EXPENSE', 'Electricity Expense'),
                    ('CLOSING_STOCK', 'Closing Stock'),
                    ('INVENTORY_LOSS', 'Inventory Loss / Shrinkage'),
                    ('EXPIRY_LOSS', 'Expired Stock Write-off'),
                    ('STOCK_TRANSFER_TRANSIT', 'Stock In Transit (inter-branch)'),
                    ('TCS_PAYABLE', 'TCS Payable'),
                    ('BAD_DEBTS_EXPENSE', 'Bad Debts Expense (P&L)'),
                    ('PROVISION_BAD_DEBTS', 'Provision for Doubtful Debts (contra-receivable)'),
                    ('PETTY_CASH', 'Petty Cash'),
                    ('BANK_CHARGES', 'Bank Charges'),
                    ('INTEREST_EXPENSE', 'Interest on Loans / Borrowings'),
                    ('INTEREST_INCOME', 'Interest Received'),
                    ('DOCTOR_FEES', 'Doctor / Consultant Fees'),
                    ('DISCOUNT_ALLOWED', 'Discount Allowed (to customers)'),
                    ('DISCOUNT_RECEIVED', 'Discount Received (from suppliers)'),
                    ('GST_LATE_FEE', 'GST Late Fee Expense'),
                    ('DEPRECIATION_EXPENSE', 'Depreciation Expense'),
                    ('PROFESSIONAL_FEES', 'Professional / Consulting Fees'),
                    ('AUDIT_FEES', 'Audit Fees'),
                    ('LEGAL_FEES', 'Legal Fees'),
                    ('INSURANCE_EXPENSE', 'Insurance Expense'),
                    ('TRAVEL_CONVEYANCE', 'Travel & Conveyance'),
                    ('AMC_CHARGES', 'AMC Charges'),
                    ('REPAIRS_MAINTENANCE', 'Repairs & Maintenance'),
                    ('OFFICE_MAINTENANCE', 'Office Maintenance'),
                    ('PRINTING_STATIONERY', 'Printing & Stationery'),
                    ('POSTAGE_COURIER', 'Postage & Courier'),
                    ('INTERNET_TELEPHONE', 'Internet & Telephone'),
                    ('STAFF_WELFARE', 'Staff Welfare'),
                    ('STAFF_ADVANCE', 'Advance to Employees'),
                    ('SUPPLIER_ADVANCE', 'Advance to Suppliers'),
                    ('CUSTOMER_ADVANCE', 'Customer Advance Received'),
                    ('CHEQUES_OUTSTANDING', 'Cheques Issued (Outstanding)'),
                    ('SUSPENSE', 'Suspense Account'),
                    ('COGS', 'Cost of Goods Sold (perpetual mode)'),
                ],
                max_length=30, unique=True,
            ),
        ),
        migrations.RunPython(add_cogs_mapping, reverse_code=migrations.RunPython.noop),
    ]

from django.db import migrations, models


def reseat_obsolete_mappings(apps, schema_editor):
    """Move AccountMapping rows that pointed at the *old* code-numbering
    (5510 / 5520 / 5530 / 1131) onto the *new* canonical codes (5540 / 5550
    / 5480 / 2156) created by the comprehensive seed_coa rewrite. No-op when
    the new code is missing or the mapping was never seeded.
    """
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    AccountMapping = apps.get_model('core', 'AccountMapping')

    moves = [
        ('INVENTORY_LOSS',    '5540'),
        ('EXPIRY_LOSS',       '5550'),
        ('BAD_DEBTS_EXPENSE', '5480'),
        ('PROVISION_BAD_DEBTS', '2156'),
    ]
    for key, new_code in moves:
        target = ChartOfAccount.objects.filter(account_code=new_code).first()
        if not target:
            continue
        AccountMapping.objects.filter(key=key).update(account=target)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0012_costcategory_costcentre'),
    ]

    operations = [
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
                ],
                max_length=30, unique=True,
            ),
        ),
        migrations.RunPython(reseat_obsolete_mappings, reverse_code=migrations.RunPython.noop),
    ]

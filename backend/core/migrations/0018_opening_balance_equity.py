"""Seed 3300 Opening Balance Equity + OPENING_BALANCE_EQUITY mapping.

This is the counter-leg account for the opening-stock JV that sync now
auto-posts: Dr 1190 Closing Stock / Cr 3300 Opening Balance Equity. Kept
separate from Retained Earnings so opening seed value is visually
distinct from real profit retention in equity reports.
"""
from django.db import migrations, models


CHOICES = [
    ('PURCHASES', 'Purchases'), ('INPUT_CGST', 'Input CGST'),
    ('INPUT_SGST', 'Input SGST'), ('INPUT_IGST', 'Input IGST'),
    ('TRADE_PAYABLES', 'Trade Payables'), ('SALES_POS', 'Sales - POS'),
    ('SALES_B2B', 'Sales - B2B'), ('OUTPUT_CGST', 'Output CGST'),
    ('OUTPUT_SGST', 'Output SGST'), ('OUTPUT_IGST', 'Output IGST'),
    ('CASH', 'Cash'), ('TRADE_RECEIVABLES', 'Trade Receivables'),
    ('SALES_RETURNS', 'Sales Returns'), ('PURCHASE_RETURNS', 'Purchase Returns'),
    ('TDS_RECEIVABLE', 'TDS Receivable'), ('TDS_PAYABLE', 'TDS Payable'),
    ('RETAINED_EARNINGS', 'Retained Earnings'), ('ROUND_OFF', 'Round Off'),
    ('RCM_LIABILITY', 'RCM GST Liability'), ('BANK', 'Bank'),
    ('SALARY_EXPENSE', 'Salary Expense'), ('PF_PAYABLE', 'PF Payable'),
    ('ESI_PAYABLE', 'ESI Payable'), ('PT_PAYABLE', 'Professional Tax Payable'),
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
    ('PETTY_CASH', 'Petty Cash'), ('BANK_CHARGES', 'Bank Charges'),
    ('INTEREST_EXPENSE', 'Interest on Loans / Borrowings'),
    ('INTEREST_INCOME', 'Interest Received'),
    ('DOCTOR_FEES', 'Doctor / Consultant Fees'),
    ('DISCOUNT_ALLOWED', 'Discount Allowed (to customers)'),
    ('DISCOUNT_RECEIVED', 'Discount Received (from suppliers)'),
    ('GST_LATE_FEE', 'GST Late Fee Expense'),
    ('DEPRECIATION_EXPENSE', 'Depreciation Expense'),
    ('PROFESSIONAL_FEES', 'Professional / Consulting Fees'),
    ('AUDIT_FEES', 'Audit Fees'), ('LEGAL_FEES', 'Legal Fees'),
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
    ('OPENING_BALANCE_EQUITY', 'Opening Balance Equity'),
]


def seed_opening_balance_equity(apps, schema_editor):
    """Create the 3300 account if missing, then wire the mapping. Idempotent."""
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    AccountMapping = apps.get_model('core', 'AccountMapping')

    capital_parent = ChartOfAccount.objects.filter(account_code='3000').first()
    account, _ = ChartOfAccount.objects.get_or_create(
        account_code='3300',
        defaults={
            'account_name': 'Opening Balance Equity',
            'account_type': 'EQUITY',
            'account_subtype': 'Capital',
            'parent': capital_parent,
            'is_leaf': True,
            'is_active': True,
        },
    )
    AccountMapping.objects.update_or_create(
        key='OPENING_BALANCE_EQUITY',
        defaults={'account': account},
    )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0017_drop_stock_method'),
    ]

    operations = [
        migrations.AlterField(
            model_name='accountmapping',
            name='key',
            field=models.CharField(max_length=30, unique=True, choices=CHOICES),
        ),
        migrations.RunPython(seed_opening_balance_equity,
                             reverse_code=migrations.RunPython.noop),
    ]

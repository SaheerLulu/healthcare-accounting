from django.db import migrations, models


def add_income_accounts(apps, schema_editor):
    """Seed mappings for the two income heads the inventory sync now posts:

    - OTHER_CHARGES_RECOVERED → 4520 (new leaf under 4500 Direct Income):
      freight / service / packing / transport / other charges billed on B2B
      sales invoices. Without this the JE for any order carrying charges was
      unbalanced and the whole sale silently failed to post.
    - CONSULTATION_INCOME → 4320 Sales - Consultation (existing leaf):
      front-office OPD / consultation fees, booked as GST-exempt income.

    Shared (location_id NULL) rows only — ensure_locations_bootstrapped()
    clones them per store on the next sync. Idempotent.
    """
    ChartOfAccount = apps.get_model('core', 'ChartOfAccount')
    AccountMapping = apps.get_model('core', 'AccountMapping')

    def _bind(key, account):
        AccountMapping.objects.get_or_create(
            key=key, location_id=None, defaults={'account': account},
        )

    # 4520 Freight & Charges Recovered — under 4500 Direct Income when present.
    parent_4500 = ChartOfAccount.objects.filter(
        account_code='4500', location_id__isnull=True
    ).first()
    if parent_4500 is not None and parent_4500.is_leaf:
        parent_4500.is_leaf = False
        parent_4500.save(update_fields=['is_leaf'])
    acct_4520, _ = ChartOfAccount.objects.get_or_create(
        account_code='4520', location_id=None,
        defaults={
            'account_name': 'Freight & Charges Recovered',
            'account_type': 'REVENUE',
            'account_subtype': 'Other_Income',
            'parent': parent_4500,
            'is_leaf': True,
            'is_active': True,
        },
    )
    _bind('OTHER_CHARGES_RECOVERED', acct_4520)

    # 4320 Sales - Consultation — bind if it exists, else create under 4000.
    acct_4320 = ChartOfAccount.objects.filter(
        account_code='4320', location_id__isnull=True
    ).first()
    if acct_4320 is None:
        parent_4000 = ChartOfAccount.objects.filter(
            account_code='4000', location_id__isnull=True
        ).first()
        acct_4320 = ChartOfAccount.objects.create(
            account_code='4320',
            account_name='Sales - Consultation',
            account_type='REVENUE',
            account_subtype='Sales',
            parent=parent_4000,
            is_leaf=True,
            is_active=True,
        )
    _bind('CONSULTATION_INCOME', acct_4320)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0024_remove_chartofaccount_uniq_party_ledger_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='accountmapping',
            name='key',
            field=models.CharField(choices=[('PURCHASES', 'Purchases'), ('INPUT_CGST', 'Input CGST'), ('INPUT_SGST', 'Input SGST'), ('INPUT_IGST', 'Input IGST'), ('TRADE_PAYABLES', 'Trade Payables'), ('SALES_POS', 'Sales - POS'), ('SALES_B2B', 'Sales - B2B'), ('OUTPUT_CGST', 'Output CGST'), ('OUTPUT_SGST', 'Output SGST'), ('OUTPUT_IGST', 'Output IGST'), ('CASH', 'Cash'), ('TRADE_RECEIVABLES', 'Trade Receivables'), ('SALES_RETURNS', 'Sales Returns'), ('PURCHASE_RETURNS', 'Purchase Returns'), ('TDS_RECEIVABLE', 'TDS Receivable'), ('TDS_PAYABLE', 'TDS Payable'), ('RETAINED_EARNINGS', 'Retained Earnings'), ('ROUND_OFF', 'Round Off'), ('RCM_LIABILITY', 'RCM GST Liability'), ('BANK', 'Bank'), ('SALARY_EXPENSE', 'Salary Expense'), ('PF_PAYABLE', 'PF Payable'), ('ESI_PAYABLE', 'ESI Payable'), ('PT_PAYABLE', 'Professional Tax Payable'), ('NET_SALARY_PAYABLE', 'Net Salary Payable'), ('RENT_EXPENSE', 'Rent Expense'), ('ELECTRICITY_EXPENSE', 'Electricity Expense'), ('CLOSING_STOCK', 'Closing Stock'), ('INVENTORY_LOSS', 'Inventory Loss / Shrinkage'), ('EXPIRY_LOSS', 'Expired Stock Write-off'), ('STOCK_TRANSFER_TRANSIT', 'Stock In Transit (inter-branch)'), ('TCS_PAYABLE', 'TCS Payable'), ('BAD_DEBTS_EXPENSE', 'Bad Debts Expense (P&L)'), ('PROVISION_BAD_DEBTS', 'Provision for Doubtful Debts (contra-receivable)'), ('PETTY_CASH', 'Petty Cash'), ('BANK_CHARGES', 'Bank Charges'), ('INTEREST_EXPENSE', 'Interest on Loans / Borrowings'), ('INTEREST_INCOME', 'Interest Received'), ('DOCTOR_FEES', 'Doctor / Consultant Fees'), ('DISCOUNT_ALLOWED', 'Discount Allowed (to customers)'), ('DISCOUNT_RECEIVED', 'Discount Received (from suppliers)'), ('GST_LATE_FEE', 'GST Late Fee Expense'), ('DEPRECIATION_EXPENSE', 'Depreciation Expense'), ('PROFESSIONAL_FEES', 'Professional / Consulting Fees'), ('AUDIT_FEES', 'Audit Fees'), ('LEGAL_FEES', 'Legal Fees'), ('INSURANCE_EXPENSE', 'Insurance Expense'), ('TRAVEL_CONVEYANCE', 'Travel & Conveyance'), ('AMC_CHARGES', 'AMC Charges'), ('REPAIRS_MAINTENANCE', 'Repairs & Maintenance'), ('OFFICE_MAINTENANCE', 'Office Maintenance'), ('PRINTING_STATIONERY', 'Printing & Stationery'), ('POSTAGE_COURIER', 'Postage & Courier'), ('INTERNET_TELEPHONE', 'Internet & Telephone'), ('STAFF_WELFARE', 'Staff Welfare'), ('STAFF_ADVANCE', 'Advance to Employees'), ('SUPPLIER_ADVANCE', 'Advance to Suppliers'), ('CUSTOMER_ADVANCE', 'Customer Advance Received'), ('CHEQUES_OUTSTANDING', 'Cheques Issued (Outstanding)'), ('SUSPENSE', 'Suspense Account'), ('COGS', 'Cost of Goods Sold (perpetual mode)'), ('OPENING_BALANCE_EQUITY', 'Opening Balance Equity'), ('STOCK_AUDIT_VARIANCE', 'Stock Audit Variance (Indirect Expense)'), ('PETTY_EXPENSE', 'Petty Cash Expenses (Indirect Expense)'), ('OTHER_CHARGES_RECOVERED', 'Freight / Other Charges Recovered (on sales)'), ('CONSULTATION_INCOME', 'Consultation / OPD Fee Income (GST-exempt)')], max_length=30),
        ),
        migrations.RunPython(add_income_accounts, noop_reverse),
    ]

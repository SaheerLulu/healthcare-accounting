from django.core.management.base import BaseCommand
from core.models import ChartOfAccount, AccountMapping


# Tally-style Chart of Accounts for a healthcare/pharmacy business with Indian
# GST/TDS compliance. Hierarchical: parents (groups) carry is_leaf=False, leaves
# carry is_leaf=True. The seed is fully idempotent — re-runs only create
# missing rows and never overwrite existing ones.
#
# Code numbering (loosely):
#   1xxx Assets · 2xxx Liabilities · 3xxx Equity
#   4xxx Revenue/Income · 5xxx Direct/Indirect Expenses
#   6xxx Other (Round-off etc.)
#
# Groups go first (topologically — parent before child) so the parent FK
# resolves on create.

# (code, name, account_type, account_subtype, parent_code or None)
GROUPS = [
    # ── Equity (Capital Account) ─────────────────────────────────────────────
    ('3000', 'Capital Account',                'EQUITY',    '',                  None),
    ('3100', 'Reserves & Surplus',             'EQUITY',    '',                  '3000'),

    # ── Liabilities (Loans + Current) ───────────────────────────────────────
    ('2000', 'Loans (Liability)',              'LIABILITY', '',                  None),
    ('2010', 'Secured Loans',                  'LIABILITY', 'Payable',           '2000'),
    ('2020', 'Unsecured Loans',                'LIABILITY', 'Payable',           '2000'),
    ('2030', 'Bank OD / CC',                   'LIABILITY', 'Payable',           '2000'),

    ('2100', 'Current Liabilities',            'LIABILITY', '',                  None),
    ('2105', 'Sundry Creditors',               'LIABILITY', 'Payable',           '2100'),
    ('2115', 'Duties & Taxes',                 'LIABILITY', '',                  '2100'),
    ('2155', 'Provisions',                     'LIABILITY', '',                  '2100'),
    ('2165', 'Statutory Payables',             'LIABILITY', '',                  '2100'),
    ('2195', 'Other Current Liabilities',      'LIABILITY', '',                  '2100'),

    # ── Assets ──────────────────────────────────────────────────────────────
    ('1000', 'Current Assets',                 'ASSET',     '',                  None),
    ('1100', 'Cash & Bank',                    'ASSET',     '',                  '1000'),
    ('1125', 'Sundry Debtors',                 'ASSET',     'Receivable',        '1000'),
    ('1135', 'Duties & Taxes Receivable',      'ASSET',     '',                  '1000'),
    ('1180', 'Stock-in-Hand',                  'ASSET',     '',                  '1000'),
    ('1300', 'Loans & Advances',               'ASSET',     '',                  '1000'),

    ('1600', 'Fixed Assets',                   'ASSET',     '',                  None),
    ('1690', 'Accumulated Depreciation',       'ASSET',     '',                  '1600'),
    ('1700', 'Investments',                    'ASSET',     '',                  None),
    ('1800', 'Misc Expenses (Asset)',          'ASSET',     '',                  None),

    # ── Revenue ─────────────────────────────────────────────────────────────
    ('4000', 'Sales Accounts',                 'REVENUE',   '',                  None),
    ('4500', 'Direct Income',                  'REVENUE',   '',                  None),
    ('4900', 'Indirect Income',                'REVENUE',   '',                  None),

    # ── Expenses ────────────────────────────────────────────────────────────
    ('5000', 'Purchase Accounts',              'EXPENSE',   '',                  None),
    ('5500', 'Direct Expenses',                'EXPENSE',   '',                  None),
    ('5700', 'Indirect Expenses',              'EXPENSE',   '',                  None),

    # ── Other ───────────────────────────────────────────────────────────────
    ('6000', 'Suspense / Round-off',           'EXPENSE',   '',                  None),
]

# (code, name, account_type, account_subtype, parent_code, mapping_key_or_None)
LEAVES = [
    # ── Capital (3xxx) ──────────────────────────────────────────────────────
    ('3110', 'Owner\'s Capital',               'EQUITY',    'Capital',           '3000', None),
    ('3120', 'Drawings',                       'EQUITY',    'Capital',           '3000', None),
    ('3200', 'Retained Earnings',              'EQUITY',    'Retained_Earnings', '3100', 'RETAINED_EARNINGS'),
    ('3210', 'General Reserve',                'EQUITY',    'Retained_Earnings', '3100', None),

    # ── Loans (2xxx) ────────────────────────────────────────────────────────
    ('2011', 'Term Loan - Bank',               'LIABILITY', 'Payable',           '2010', None),
    ('2012', 'Vehicle Loan',                   'LIABILITY', 'Payable',           '2010', None),
    ('2013', 'Equipment Loan',                 'LIABILITY', 'Payable',           '2010', None),
    ('2021', 'Loan from Director',             'LIABILITY', 'Payable',           '2020', None),
    ('2022', 'Loan from Related Party',        'LIABILITY', 'Payable',           '2020', None),
    ('2031', 'Bank Overdraft',                 'LIABILITY', 'Payable',           '2030', None),
    ('2032', 'Cash Credit Limit',              'LIABILITY', 'Payable',           '2030', None),

    # ── Current Liabilities → Sundry Creditors (2105) ──────────────────────
    ('2110', 'Trade Payables',                 'LIABILITY', 'Payable',           '2105', 'TRADE_PAYABLES'),
    ('2111', 'Creditors for Expenses',         'LIABILITY', 'Payable',           '2105', None),
    ('2112', 'Creditors for Capital Goods',    'LIABILITY', 'Payable',           '2105', None),
    ('2113', 'Cheques Issued (Outstanding)',   'LIABILITY', 'Payable',           '2105', 'CHEQUES_OUTSTANDING'),

    # ── Current Liabilities → Duties & Taxes (2115) ────────────────────────
    ('2120', 'Output CGST',                    'LIABILITY', 'Output_GST',        '2115', 'OUTPUT_CGST'),
    ('2130', 'Output SGST',                    'LIABILITY', 'Output_GST',        '2115', 'OUTPUT_SGST'),
    ('2140', 'Output IGST',                    'LIABILITY', 'Output_GST',        '2115', 'OUTPUT_IGST'),
    ('2145', 'Output Cess',                    'LIABILITY', 'Output_GST',        '2115', None),
    ('2150', 'TDS Payable',                    'LIABILITY', 'TDS_Payable',       '2115', 'TDS_PAYABLE'),
    ('2160', 'RCM GST Liability',              'LIABILITY', 'Output_GST',        '2115', 'RCM_LIABILITY'),
    ('2210', 'TCS Payable',                    'LIABILITY', 'TDS_Payable',       '2115', 'TCS_PAYABLE'),
    ('2220', 'GST Late Fee Payable',           'LIABILITY', 'Payable',           '2115', None),
    ('2225', 'Income Tax Payable',             'LIABILITY', 'Payable',           '2115', None),
    ('2230', 'Advance Tax Paid (offset)',      'LIABILITY', 'TDS_Receivable',    '2115', None),

    # ── Provisions (2155) ──────────────────────────────────────────────────
    ('2156', 'Provision for Doubtful Debts',   'LIABILITY', 'Payable',           '2155', 'PROVISION_BAD_DEBTS'),
    ('2157', 'Provision for Tax',              'LIABILITY', 'Payable',           '2155', None),
    ('2158', 'Provision for Bonus',            'LIABILITY', 'Payable',           '2155', None),
    ('2159', 'Provision for Gratuity',         'LIABILITY', 'Payable',           '2155', None),
    ('2160B', 'Provision for Audit Fees',      'LIABILITY', 'Payable',           '2155', None),

    # ── Statutory Payables (2165) ──────────────────────────────────────────
    ('2170', 'PF Payable',                     'LIABILITY', 'Payable',           '2165', 'PF_PAYABLE'),
    ('2180', 'ESI Payable',                    'LIABILITY', 'Payable',           '2165', 'ESI_PAYABLE'),
    ('2190', 'Professional Tax Payable',       'LIABILITY', 'Payable',           '2165', 'PT_PAYABLE'),
    ('2200', 'Net Salary Payable',             'LIABILITY', 'Payable',           '2165', 'NET_SALARY_PAYABLE'),

    # ── Other Current Liabilities (2195) ───────────────────────────────────
    ('2196', 'Customer Advances',              'LIABILITY', 'Payable',           '2195', 'CUSTOMER_ADVANCE'),
    ('2197', 'Audit Fees Payable',             'LIABILITY', 'Payable',           '2195', None),
    ('2198', 'Rent Payable',                   'LIABILITY', 'Payable',           '2195', None),
    ('2199', 'Utility Bills Payable',          'LIABILITY', 'Payable',           '2195', None),

    # ── Cash & Bank (1100) ─────────────────────────────────────────────────
    ('1110', 'Cash',                           'ASSET',     'Cash',              '1100', 'CASH'),
    ('1115', 'Petty Cash',                     'ASSET',     'Cash',              '1100', 'PETTY_CASH'),
    ('1120', 'Bank Account',                   'ASSET',     'Bank',              '1100', 'BANK'),
    ('1121', 'Bank Account 2 (Current)',       'ASSET',     'Bank',              '1100', None),
    ('1122', 'Bank Account 3 (Savings)',       'ASSET',     'Bank',              '1100', None),
    ('1123', 'Cheques in Hand',                'ASSET',     'Cash',              '1100', None),

    # ── Sundry Debtors (1125) ──────────────────────────────────────────────
    ('1130', 'Trade Receivables',              'ASSET',     'Receivable',        '1125', 'TRADE_RECEIVABLES'),
    ('1131', 'Receivables - B2B',              'ASSET',     'Receivable',        '1125', None),
    ('1132', 'Receivables - Insurance',        'ASSET',     'Receivable',        '1125', None),
    ('1133', 'Receivables - Corporate',        'ASSET',     'Receivable',        '1125', None),

    # ── Duties & Taxes Receivable (1135) ───────────────────────────────────
    ('1140', 'Input CGST',                     'ASSET',     'Input_GST',         '1135', 'INPUT_CGST'),
    ('1150', 'Input SGST',                     'ASSET',     'Input_GST',         '1135', 'INPUT_SGST'),
    ('1160', 'Input IGST',                     'ASSET',     'Input_GST',         '1135', 'INPUT_IGST'),
    ('1165', 'Input Cess',                     'ASSET',     'Input_GST',         '1135', None),
    ('1170', 'TDS Receivable',                 'ASSET',     'TDS_Receivable',    '1135', 'TDS_RECEIVABLE'),
    ('1171', 'TCS Receivable',                 'ASSET',     'TDS_Receivable',    '1135', None),
    ('1172', 'GST Refund Receivable',          'ASSET',     'Input_GST',         '1135', None),

    # ── Stock-in-Hand (1180) ───────────────────────────────────────────────
    ('1190', 'Closing Stock',                  'ASSET',     'Other_Income',      '1180', 'CLOSING_STOCK'),
    ('1191', 'Stock In Transit',               'ASSET',     'Other_Income',      '1180', 'STOCK_TRANSFER_TRANSIT'),
    ('1192', 'Stock - Pharmacy',               'ASSET',     'Other_Income',      '1180', None),
    ('1193', 'Stock - Lab Reagents',           'ASSET',     'Other_Income',      '1180', None),
    ('1194', 'Stock - Medical Disposables',    'ASSET',     'Other_Income',      '1180', None),

    # ── Loans & Advances (1300) ────────────────────────────────────────────
    ('1310', 'Advance to Suppliers',           'ASSET',     'Receivable',        '1300', 'SUPPLIER_ADVANCE'),
    ('1320', 'Advance to Employees',           'ASSET',     'Receivable',        '1300', 'STAFF_ADVANCE'),
    ('1330', 'Salary Advance',                 'ASSET',     'Receivable',        '1300', None),
    ('1340', 'Security Deposits',              'ASSET',     'Receivable',        '1300', None),
    ('1350', 'Rent Deposit',                   'ASSET',     'Receivable',        '1300', None),
    ('1360', 'Prepaid Expenses',               'ASSET',     'Receivable',        '1300', None),
    ('1370', 'Prepaid Insurance',              'ASSET',     'Receivable',        '1300', None),
    ('1380', 'Prepaid Subscriptions',          'ASSET',     'Receivable',        '1300', None),

    # ── Fixed Assets (1600) — paired with Accum Depreciation ───────────────
    ('1610', 'Land',                           'ASSET',     'Other_Income',      '1600', None),
    ('1612', 'Building',                       'ASSET',     'Other_Income',      '1600', None),
    ('1620', 'Plant & Machinery',              'ASSET',     'Other_Income',      '1600', None),
    ('1622', 'Medical Equipment',              'ASSET',     'Other_Income',      '1600', None),
    ('1624', 'Lab Equipment',                  'ASSET',     'Other_Income',      '1600', None),
    ('1630', 'Furniture & Fixtures',           'ASSET',     'Other_Income',      '1600', None),
    ('1640', 'Computers & Peripherals',        'ASSET',     'Other_Income',      '1600', None),
    ('1645', 'Office Equipment',               'ASSET',     'Other_Income',      '1600', None),
    ('1650', 'Vehicles',                       'ASSET',     'Other_Income',      '1600', None),
    ('1660', 'Software & Licenses',            'ASSET',     'Other_Income',      '1600', None),
    ('1670', 'Leasehold Improvements',         'ASSET',     'Other_Income',      '1600', None),

    # ── Accumulated Depreciation (1690) — contra-asset ─────────────────────
    ('1691', 'Accum Dep - Building',           'ASSET',     'Other_Expense',     '1690', None),
    ('1692', 'Accum Dep - Plant & Machinery',  'ASSET',     'Other_Expense',     '1690', None),
    ('1693', 'Accum Dep - Medical Equipment',  'ASSET',     'Other_Expense',     '1690', None),
    ('1694', 'Accum Dep - Lab Equipment',      'ASSET',     'Other_Expense',     '1690', None),
    ('1695', 'Accum Dep - Furniture',          'ASSET',     'Other_Expense',     '1690', None),
    ('1696', 'Accum Dep - Computers',          'ASSET',     'Other_Expense',     '1690', None),
    ('1697', 'Accum Dep - Office Equipment',   'ASSET',     'Other_Expense',     '1690', None),
    ('1698', 'Accum Dep - Vehicles',           'ASSET',     'Other_Expense',     '1690', None),
    ('1699', 'Accum Dep - Software',           'ASSET',     'Other_Expense',     '1690', None),

    # ── Investments (1700) ─────────────────────────────────────────────────
    ('1710', 'Fixed Deposits',                 'ASSET',     'Other_Income',      '1700', None),
    ('1720', 'Mutual Funds',                   'ASSET',     'Other_Income',      '1700', None),
    ('1730', 'Other Investments',              'ASSET',     'Other_Income',      '1700', None),

    # ── Misc Expenses (Asset) (1800) ───────────────────────────────────────
    ('1810', 'Preliminary Expenses',           'ASSET',     'Other_Expense',     '1800', None),
    ('1820', 'Pre-operative Expenses',         'ASSET',     'Other_Expense',     '1800', None),

    # ── Sales Accounts (4000) ──────────────────────────────────────────────
    ('4100', 'Sales - POS',                    'REVENUE',   'Sales',             '4000', 'SALES_POS'),
    ('4110', 'Sales - Pharmacy (Retail)',      'REVENUE',   'Sales',             '4000', None),
    ('4120', 'Sales - OTC',                    'REVENUE',   'Sales',             '4000', None),
    ('4200', 'Sales - B2B',                    'REVENUE',   'Sales',             '4000', 'SALES_B2B'),
    ('4210', 'Sales - Wholesale',              'REVENUE',   'Sales',             '4000', None),
    ('4300', 'Sales - Lab Services',           'REVENUE',   'Sales',             '4000', None),
    ('4310', 'Sales - Diagnostic Services',    'REVENUE',   'Sales',             '4000', None),
    ('4320', 'Sales - Consultation',           'REVENUE',   'Sales',             '4000', None),
    ('4330', 'Sales - Procedure / Day-care',   'REVENUE',   'Sales',             '4000', None),
    ('4340', 'Sales - Insurance Settlement',   'REVENUE',   'Sales',             '4000', None),
    # Contra-revenue (debit reduces sales)
    ('5200', 'Sales Returns',                  'REVENUE',   'Other_Expense',     '4000', 'SALES_RETURNS'),
    ('5210', 'Discount Allowed',               'REVENUE',   'Other_Expense',     '4000', 'DISCOUNT_ALLOWED'),

    # ── Direct Income (4500) ───────────────────────────────────────────────
    ('4510', 'Other Operating Income',         'REVENUE',   'Other_Income',      '4500', None),

    # ── Indirect Income (4900) ─────────────────────────────────────────────
    ('4910', 'Interest Received',              'REVENUE',   'Other_Income',      '4900', 'INTEREST_INCOME'),
    ('4920', 'Discount Received',              'REVENUE',   'Other_Income',      '4900', None),
    ('4930', 'Commission Received',            'REVENUE',   'Other_Income',      '4900', None),
    ('4940', 'Rental Income',                  'REVENUE',   'Other_Income',      '4900', None),
    ('4950', 'Profit on Sale of Asset',        'REVENUE',   'Other_Income',      '4900', None),
    ('4990', 'Misc Income',                    'REVENUE',   'Other_Income',      '4900', None),

    # ── Purchase Accounts (5000) ───────────────────────────────────────────
    ('5100', 'Purchases',                      'EXPENSE',   'Purchases',         '5000', 'PURCHASES'),
    ('5110', 'Purchases - Pharmacy',           'EXPENSE',   'Purchases',         '5000', None),
    ('5120', 'Purchases - Lab Reagents',       'EXPENSE',   'Purchases',         '5000', None),
    ('5130', 'Purchases - Medical Disposables','EXPENSE',   'Purchases',         '5000', None),
    ('5140', 'Purchases - Equipment Spares',   'EXPENSE',   'Purchases',         '5000', None),
    # Contra-expense (credit reduces purchases)
    ('5300', 'Purchase Returns',               'EXPENSE',   'Purchases',         '5000', 'PURCHASE_RETURNS'),
    ('5310', 'Discount Received (P&L)',        'EXPENSE',   'Other_Income',      '5000', 'DISCOUNT_RECEIVED'),

    # ── Direct Expenses (5500) ─────────────────────────────────────────────
    ('5510', 'Carriage Inward',                'EXPENSE',   'Other_Expense',     '5500', None),
    ('5520', 'Wages - Direct',                 'EXPENSE',   'Other_Expense',     '5500', None),
    ('5530', 'Power & Fuel',                   'EXPENSE',   'Other_Expense',     '5500', None),
    ('5540', 'Inventory Loss / Shrinkage',     'EXPENSE',   'Other_Expense',     '5500', 'INVENTORY_LOSS'),
    ('5550', 'Expired Stock Write-off',        'EXPENSE',   'Other_Expense',     '5500', 'EXPIRY_LOSS'),
    ('5560', 'Pharmacy COGS Adjustment',       'EXPENSE',   'Other_Expense',     '5500', None),

    # ── Indirect Expenses (5700) — Personnel ────────────────────────────────
    ('5400', 'Salary Expense',                 'EXPENSE',   'Other_Expense',     '5700', 'SALARY_EXPENSE'),
    ('5401', 'Salary - Doctors / Consultants', 'EXPENSE',   'Other_Expense',     '5700', None),
    ('5402', 'Salary - Pharmacy Staff',        'EXPENSE',   'Other_Expense',     '5700', None),
    ('5403', 'Salary - Lab / Diagnostics',     'EXPENSE',   'Other_Expense',     '5700', None),
    ('5404', 'Staff Welfare',                  'EXPENSE',   'Other_Expense',     '5700', 'STAFF_WELFARE'),
    ('5405', 'PF Employer Contribution',       'EXPENSE',   'Other_Expense',     '5700', None),
    ('5406', 'ESI Employer Contribution',      'EXPENSE',   'Other_Expense',     '5700', None),
    ('5407', 'Bonus & Incentives',             'EXPENSE',   'Other_Expense',     '5700', None),
    ('5408', 'Gratuity Expense',               'EXPENSE',   'Other_Expense',     '5700', None),
    ('5409', 'Recruitment & Training',         'EXPENSE',   'Other_Expense',     '5700', None),

    # ── Indirect Expenses — Premises ───────────────────────────────────────
    ('5410', 'Rent Expense',                   'EXPENSE',   'Other_Expense',     '5700', 'RENT_EXPENSE'),
    ('5420', 'Electricity Expense',            'EXPENSE',   'Other_Expense',     '5700', 'ELECTRICITY_EXPENSE'),
    ('5421', 'Water & Sewerage',               'EXPENSE',   'Other_Expense',     '5700', None),
    ('5422', 'Internet & Telephone',           'EXPENSE',   'Other_Expense',     '5700', 'INTERNET_TELEPHONE'),
    ('5423', 'Office Maintenance',             'EXPENSE',   'Other_Expense',     '5700', 'OFFICE_MAINTENANCE'),
    ('5424', 'Repairs & Maintenance',          'EXPENSE',   'Other_Expense',     '5700', 'REPAIRS_MAINTENANCE'),
    ('5425', 'Repairs - Medical Equipment',    'EXPENSE',   'Other_Expense',     '5700', None),
    ('5426', 'AMC Charges',                    'EXPENSE',   'Other_Expense',     '5700', 'AMC_CHARGES'),
    ('5427', 'Cleaning & Housekeeping',        'EXPENSE',   'Other_Expense',     '5700', None),
    ('5428', 'Security Charges',               'EXPENSE',   'Other_Expense',     '5700', None),

    # ── Indirect Expenses — Operations ─────────────────────────────────────
    ('5430', 'Insurance',                      'EXPENSE',   'Other_Expense',     '5700', 'INSURANCE_EXPENSE'),
    ('5431', 'Insurance - Vehicle',            'EXPENSE',   'Other_Expense',     '5700', None),
    ('5432', 'Insurance - Liability',          'EXPENSE',   'Other_Expense',     '5700', None),
    ('5440', 'Professional Fees',              'EXPENSE',   'Other_Expense',     '5700', 'PROFESSIONAL_FEES'),
    ('5441', 'Doctor / Consultant Fees',       'EXPENSE',   'Other_Expense',     '5700', 'DOCTOR_FEES'),
    ('5442', 'Audit Fees',                     'EXPENSE',   'Other_Expense',     '5700', 'AUDIT_FEES'),
    ('5443', 'Legal Fees',                     'EXPENSE',   'Other_Expense',     '5700', 'LEGAL_FEES'),
    ('5444', 'Consultancy Fees',               'EXPENSE',   'Other_Expense',     '5700', None),

    # ── Indirect Expenses — Bank, Tax, Discount ────────────────────────────
    ('5450', 'Bank Charges',                   'EXPENSE',   'Other_Expense',     '5700', 'BANK_CHARGES'),
    ('5451', 'Interest on Loans',              'EXPENSE',   'Other_Expense',     '5700', 'INTEREST_EXPENSE'),
    ('5452', 'Interest on OD/CC',              'EXPENSE',   'Other_Expense',     '5700', None),
    ('5453', 'Loan Processing Fees',           'EXPENSE',   'Other_Expense',     '5700', None),
    ('5454', 'GST Late Fee Expense',           'EXPENSE',   'Other_Expense',     '5700', 'GST_LATE_FEE'),
    ('5455', 'Income Tax Expense',             'EXPENSE',   'Other_Expense',     '5700', None),

    # ── Indirect Expenses — Office / G&A ───────────────────────────────────
    ('5460', 'Printing & Stationery',          'EXPENSE',   'Other_Expense',     '5700', 'PRINTING_STATIONERY'),
    ('5461', 'Postage & Courier',              'EXPENSE',   'Other_Expense',     '5700', 'POSTAGE_COURIER'),
    ('5462', 'Software Subscriptions',         'EXPENSE',   'Other_Expense',     '5700', None),
    ('5463', 'License & Renewal Fees',         'EXPENSE',   'Other_Expense',     '5700', None),
    ('5464', 'Drug License Fees',              'EXPENSE',   'Other_Expense',     '5700', None),
    ('5465', 'Trade License & Registration',   'EXPENSE',   'Other_Expense',     '5700', None),

    # ── Indirect Expenses — Sales & Marketing ──────────────────────────────
    ('5470', 'Advertising & Marketing',        'EXPENSE',   'Other_Expense',     '5700', None),
    ('5471', 'Sales Promotion',                'EXPENSE',   'Other_Expense',     '5700', None),
    ('5472', 'Travel & Conveyance',            'EXPENSE',   'Other_Expense',     '5700', 'TRAVEL_CONVEYANCE'),
    ('5473', 'Vehicle Running & Fuel',         'EXPENSE',   'Other_Expense',     '5700', None),
    ('5474', 'Donation & CSR',                 'EXPENSE',   'Other_Expense',     '5700', None),

    # ── Indirect Expenses — Bad Debts, Depreciation, Misc ──────────────────
    ('5480', 'Bad Debts Written Off',          'EXPENSE',   'Other_Expense',     '5700', 'BAD_DEBTS_EXPENSE'),
    ('5481', 'Depreciation Expense',           'EXPENSE',   'Other_Expense',     '5700', 'DEPRECIATION_EXPENSE'),
    ('5482', 'Loss on Sale of Asset',          'EXPENSE',   'Other_Expense',     '5700', None),
    ('5483', 'Miscellaneous Expense',          'EXPENSE',   'Other_Expense',     '5700', None),
    ('5484', 'Subscriptions & Memberships',    'EXPENSE',   'Other_Expense',     '5700', None),
    ('5485', 'Books, Journals, CME',           'EXPENSE',   'Other_Expense',     '5700', None),

    # ── Suspense / Round-off (6000) ────────────────────────────────────────
    ('6100', 'Round Off',                      'EXPENSE',   'Other_Expense',     '6000', 'ROUND_OFF'),
    ('6200', 'Suspense Account',               'EXPENSE',   'Other_Expense',     '6000', 'SUSPENSE'),
]


class Command(BaseCommand):
    help = 'Seed the comprehensive Tally-style Chart of Accounts and AccountMapping rows.'

    def handle(self, *args, **options):
        groups_created = 0
        leaves_created = 0
        mappings_created = 0
        parents_linked = 0

        # Pass 1: create groups (parents). Process top-down so parent_code resolves.
        # GROUPS is already in topological order.
        for code, name, acct_type, subtype, parent_code in GROUPS:
            parent = None
            if parent_code:
                parent = ChartOfAccount.objects.filter(account_code=parent_code).first()
            account, created = ChartOfAccount.objects.get_or_create(
                account_code=code,
                defaults={
                    'account_name': name,
                    'account_type': acct_type,
                    'account_subtype': subtype,
                    'parent': parent,
                    'is_leaf': False,
                },
            )
            if created:
                groups_created += 1
            elif account.parent_id is None and parent is not None:
                # Existing account that should now have a parent — link it.
                account.parent = parent
                account.is_leaf = False
                account.save(update_fields=['parent', 'is_leaf'])
                parents_linked += 1

        # Pass 2: create leaves with parent FK set.
        for code, name, acct_type, subtype, parent_code, _mapping_key in LEAVES:
            parent = None
            if parent_code:
                parent = ChartOfAccount.objects.filter(account_code=parent_code).first()
            account, created = ChartOfAccount.objects.get_or_create(
                account_code=code,
                defaults={
                    'account_name': name,
                    'account_type': acct_type,
                    'account_subtype': subtype,
                    'parent': parent,
                    'is_leaf': True,
                },
            )
            if created:
                leaves_created += 1
            elif account.parent_id is None and parent is not None:
                # Existing leaf without a parent — re-home it under the new group.
                account.parent = parent
                account.save(update_fields=['parent'])
                parents_linked += 1

        # Pass 3: account mappings.
        for code, _name, _t, _s, _p, mapping_key in LEAVES:
            if not mapping_key:
                continue
            account = ChartOfAccount.objects.filter(account_code=code).first()
            if not account:
                continue
            _, mapping_created = AccountMapping.objects.get_or_create(
                key=mapping_key,
                defaults={'account': account},
            )
            if mapping_created:
                mappings_created += 1

        self.stdout.write(self.style.SUCCESS(
            f'COA seeded: {groups_created} groups + {leaves_created} leaves new, '
            f'{parents_linked} parents linked, {mappings_created} mappings new'
        ))

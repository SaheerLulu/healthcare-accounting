from django.core.management.base import BaseCommand
from core.models import ChartOfAccount, AccountMapping


# Canonical Chart of Accounts. Matches DOCUMENTATION.md and the live DB after
# migrations 0003, 0006, 0007. Re-running this command is idempotent.
#
# Tuple shape: (account_code, account_name, account_type, account_subtype, mapping_key_or_None)
COA_ROWS = [
    # ── Assets (1xxx) ───────────────────────────────────────────────────────
    ('1110', 'Cash',                     'ASSET',     'Cash',           'CASH'),
    ('1120', 'Bank Account',             'ASSET',     'Bank',           'BANK'),
    ('1130', 'Trade Receivables',        'ASSET',     'Receivable',     'TRADE_RECEIVABLES'),
    ('1140', 'Input CGST',               'ASSET',     'Input_GST',      'INPUT_CGST'),
    ('1150', 'Input SGST',               'ASSET',     'Input_GST',      'INPUT_SGST'),
    ('1160', 'Input IGST',               'ASSET',     'Input_GST',      'INPUT_IGST'),
    ('1170', 'TDS Receivable',           'ASSET',     'TDS_Receivable', 'TDS_RECEIVABLE'),

    # ── Liabilities (2xxx) ─────────────────────────────────────────────────
    ('2110', 'Trade Payables',           'LIABILITY', 'Payable',        'TRADE_PAYABLES'),
    ('2120', 'Output CGST',              'LIABILITY', 'Output_GST',     'OUTPUT_CGST'),
    ('2130', 'Output SGST',              'LIABILITY', 'Output_GST',     'OUTPUT_SGST'),
    ('2140', 'Output IGST',              'LIABILITY', 'Output_GST',     'OUTPUT_IGST'),
    ('2150', 'TDS Payable',              'LIABILITY', 'TDS_Payable',    'TDS_PAYABLE'),
    ('2160', 'RCM GST Liability',        'LIABILITY', 'Output_GST',     'RCM_LIABILITY'),
    ('2170', 'PF Payable',               'LIABILITY', 'Payable',        'PF_PAYABLE'),
    ('2180', 'ESI Payable',              'LIABILITY', 'Payable',        'ESI_PAYABLE'),
    ('2190', 'Professional Tax Payable', 'LIABILITY', 'Payable',        'PT_PAYABLE'),
    ('2200', 'Net Salary Payable',       'LIABILITY', 'Payable',        'NET_SALARY_PAYABLE'),

    # ── Equity (3xxx) ──────────────────────────────────────────────────────
    ('3200', 'Retained Earnings',        'EQUITY',    'Retained_Earnings', 'RETAINED_EARNINGS'),

    # ── Revenue (4xxx) + contra-revenue ────────────────────────────────────
    ('4100', 'Sales - POS',              'REVENUE',   'Sales',          'SALES_POS'),
    ('4200', 'Sales - B2B',              'REVENUE',   'Sales',          'SALES_B2B'),

    # ── Expenses (5xxx) + contra-expense ───────────────────────────────────
    ('5100', 'Purchases',                'EXPENSE',   'Purchases',      'PURCHASES'),
    # 5200 Sales Returns is type=REVENUE (contra-revenue) — debits subtract from net revenue.
    ('5200', 'Sales Returns',            'REVENUE',   'Other_Expense',  'SALES_RETURNS'),
    ('5300', 'Purchase Returns',         'EXPENSE',   'Purchases',      'PURCHASE_RETURNS'),
    ('5400', 'Salary Expense',           'EXPENSE',   'Other_Expense',  'SALARY_EXPENSE'),
    ('5410', 'Rent Expense',             'EXPENSE',   'Other_Expense',  'RENT_EXPENSE'),
    ('5420', 'Electricity Expense',      'EXPENSE',   'Other_Expense',  'ELECTRICITY_EXPENSE'),

    # ── Other (6xxx) ───────────────────────────────────────────────────────
    ('6100', 'Round Off',                'EXPENSE',   'Other_Expense',  'ROUND_OFF'),
]


class Command(BaseCommand):
    help = 'Seed the canonical Indian Chart of Accounts and AccountMapping rows.'

    def handle(self, *args, **options):
        accounts_created = 0
        mappings_created = 0

        for code, name, acct_type, subtype, mapping_key in COA_ROWS:
            account, created = ChartOfAccount.objects.get_or_create(
                account_code=code,
                defaults={
                    'account_name': name,
                    'account_type': acct_type,
                    'account_subtype': subtype,
                    'is_leaf': True,
                },
            )
            if created:
                accounts_created += 1

            if mapping_key:
                _, mapping_created = AccountMapping.objects.get_or_create(
                    key=mapping_key,
                    defaults={'account': account},
                )
                if mapping_created:
                    mappings_created += 1

        self.stdout.write(self.style.SUCCESS(
            f'COA seeded: {accounts_created} new accounts, {mappings_created} new mappings'
        ))

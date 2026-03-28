from django.core.management.base import BaseCommand
from core.models import ChartOfAccount


COA_TREE = [
    # (account_code, account_name, account_type, account_subtype, parent_code, is_leaf)
    ('1000', 'Assets',              'ASSET',     '',                None,   False),
    ('1100', 'Current Assets',      'ASSET',     '',                '1000', False),
    ('1110', 'Cash in Hand',        'ASSET',     'Cash',            '1100', True),
    ('1120', 'Bank Accounts',       'ASSET',     'Bank',            '1100', True),
    ('1130', 'Trade Receivables',   'ASSET',     'Receivable',      '1100', True),
    ('1140', 'Input CGST',          'ASSET',     'Input_GST',       '1100', True),
    ('1150', 'Input SGST',          'ASSET',     'Input_GST',       '1100', True),
    ('1160', 'Input IGST',          'ASSET',     'Input_GST',       '1100', True),
    ('1170', 'TDS Receivable',      'ASSET',     'TDS_Receivable',  '1100', True),
    ('1200', 'Fixed Assets',        'ASSET',     '',                '1000', False),
    ('1210', 'Plant and Machinery', 'ASSET',     'Other_Expense',   '1200', True),
    ('1220', 'Furniture and Fixtures', 'ASSET',  'Other_Expense',   '1200', True),

    ('2000', 'Liabilities',         'LIABILITY', '',                None,   False),
    ('2100', 'Current Liabilities', 'LIABILITY', '',                '2000', False),
    ('2110', 'Trade Payables',      'LIABILITY', 'Payable',         '2100', True),
    ('2120', 'Output CGST Payable', 'LIABILITY', 'Output_GST',      '2100', True),
    ('2130', 'Output SGST Payable', 'LIABILITY', 'Output_GST',      '2100', True),
    ('2140', 'Output IGST Payable', 'LIABILITY', 'Output_GST',      '2100', True),
    ('2150', 'TDS Payable',         'LIABILITY', 'TDS_Payable',     '2100', True),
    ('2160', 'GST Payable Net',     'LIABILITY', 'Output_GST',      '2100', True),

    ('3000', 'Equity',              'EQUITY',    '',                None,   False),
    ('3100', 'Capital Account',     'EQUITY',    'Capital',         '3000', True),
    ('3200', 'Retained Earnings',   'EQUITY',    'Retained_Earnings', '3000', True),

    ('4000', 'Revenue',             'REVENUE',   '',                None,   False),
    ('4100', 'Sales Retail POS',    'REVENUE',   'Sales',           '4000', True),
    ('4200', 'Sales B2B',           'REVENUE',   'Sales',           '4000', True),
    ('4300', 'Other Income',        'REVENUE',   'Other_Income',    '4000', True),

    ('5000', 'Expenses',            'EXPENSE',   '',                None,   False),
    ('5100', 'Purchases',           'EXPENSE',   'Purchases',       '5000', True),
    ('5200', 'Purchase Returns',    'EXPENSE',   'Purchases',       '5000', True),
    ('5300', 'Salaries',            'EXPENSE',   'Other_Expense',   '5000', True),
    ('5400', 'Rent',                'EXPENSE',   'Other_Expense',   '5000', True),
    ('5500', 'Other Expenses',      'EXPENSE',   'Other_Expense',   '5000', True),
]


class Command(BaseCommand):
    help = 'Seed the Indian Chart of Accounts'

    def handle(self, *args, **options):
        # First pass: create all accounts without parents so FKs resolve cleanly
        created_accounts = {}

        for code, name, acct_type, subtype, parent_code, is_leaf in COA_TREE:
            obj, created = ChartOfAccount.objects.get_or_create(
                account_code=code,
                defaults={
                    'account_name': name,
                    'account_type': acct_type,
                    'account_subtype': subtype,
                    'is_leaf': is_leaf,
                },
            )
            created_accounts[code] = obj

        # Second pass: assign parents
        for code, name, acct_type, subtype, parent_code, is_leaf in COA_TREE:
            if parent_code is not None:
                obj = created_accounts[code]
                parent_obj = created_accounts[parent_code]
                if obj.parent_id != parent_obj.pk:
                    obj.parent = parent_obj
                    obj.save(update_fields=['parent'])

        self.stdout.write(self.style.SUCCESS('COA seeded successfully'))

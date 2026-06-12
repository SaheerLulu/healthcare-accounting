"""Shared test fixtures and helpers."""
from contextlib import ExitStack, contextmanager
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.contrib.auth.models import User

from core.models import AccountingSettings, AccountMapping, ChartOfAccount


def make_user(**kwargs) -> User:
    defaults = dict(username='tester', email='tester@example.com',
                    is_active=True, is_staff=False)
    defaults.update(kwargs)
    user, _ = User.objects.get_or_create(
        username=defaults['username'], defaults=defaults
    )
    user.set_password('test-pass-123')
    user.save()
    return user


def make_admin() -> User:
    user, _ = User.objects.get_or_create(
        username='admin',
        defaults={'is_superuser': True, 'is_staff': True, 'email': 'a@b.com'},
    )
    user.set_password('test-pass-123')
    user.save()
    return user


def grant_capabilities(user: User, *capabilities: str, code: str = 'SENIOR_ACCOUNTANT'):
    """Put `user` in an AccountingRole granting the given capability flags.

    Capability-gated endpoints (core.permissions.HasAccountingCapability)
    let superusers through automatically; use this for tests that exercise
    a non-superuser who legitimately holds e.g. can_post_journals.
    """
    from core.models import AccountingRole
    role, _ = AccountingRole.objects.get_or_create(
        code=code, defaults={'name': code.replace('_', ' ').title()},
    )
    for flag in capabilities:
        setattr(role, flag, True)
    role.save()
    role.users.add(user)
    return role


def make_settings(**kw) -> AccountingSettings:
    defaults = dict(
        company_name='Test Co', gstin='27AABCT1234A1Z5', tan='ABCD12345E',
        pan='AABCT1234A', state_code='27', financial_year_start=4,
        registered_address='Mumbai, Maharashtra',
    )
    defaults.update(kw)
    s = AccountingSettings.get_settings()
    for k, v in defaults.items():
        setattr(s, k, v)
    s.save()
    return s


def seed_chart_and_mappings():
    """Create the minimum CoA + mappings every JV/post test needs.

    Two expense group rows (5500 Direct, 5700 Indirect) are seeded as
    non-leaf parents and the standard direct/indirect leaves are wired
    onto them so ProfitLossView can classify expenses correctly.
    """
    # Non-leaf group rows — must be created first so leaves can point at them.
    groups = {
        '5500': ('Direct Expenses', 'EXPENSE'),
        '5700': ('Indirect Expenses', 'EXPENSE'),
    }
    group_objs = {}
    for code, (name, atype) in groups.items():
        obj, _ = ChartOfAccount.objects.get_or_create(
            account_code=code,
            defaults=dict(account_name=name, account_type=atype,
                          is_leaf=False, is_active=True),
        )
        group_objs[code] = obj

    accounts = {
        '1110': ('Cash in Hand', 'ASSET', 'Cash'),
        '1120': ('Bank', 'ASSET', 'Bank'),
        '1130': ('Trade Receivables', 'ASSET', 'Receivable'),
        '1140': ('Input CGST', 'ASSET', 'Input_GST'),
        '1150': ('Input SGST', 'ASSET', 'Input_GST'),
        '1160': ('Input IGST', 'ASSET', 'Input_GST'),
        '1170': ('TDS Receivable', 'ASSET', 'TDS_Receivable'),
        '2110': ('Trade Payables', 'LIABILITY', 'Payable'),
        '2120': ('Output CGST', 'LIABILITY', 'Output_GST'),
        '2130': ('Output SGST', 'LIABILITY', 'Output_GST'),
        '2140': ('Output IGST', 'LIABILITY', 'Output_GST'),
        '2150': ('TDS Payable', 'LIABILITY', 'TDS_Payable'),
        '2160': ('RCM GST Liability', 'LIABILITY', 'Output_GST'),
        '2170': ('PF Payable', 'LIABILITY', 'Payable'),
        '2180': ('ESI Payable', 'LIABILITY', 'Payable'),
        '2190': ('Professional Tax Payable', 'LIABILITY', 'Payable'),
        '2200': ('Net Salary Payable', 'LIABILITY', 'Payable'),
        '3200': ('Retained Earnings', 'EQUITY', 'Retained_Earnings'),
        '3300': ('Opening Balance Equity', 'EQUITY', 'Capital'),
        '4100': ('Sales POS', 'REVENUE', 'Sales'),
        '4200': ('Sales B2B', 'REVENUE', 'Sales'),
        '5100': ('Purchases', 'EXPENSE', 'Purchases'),
        # 5200 is REVENUE (contra-revenue) in production coa_data.py — a
        # debit here reduces net revenue rather than inflating expenses.
        '5200': ('Sales Returns', 'REVENUE', 'Sales'),
        '5300': ('Purchase Returns', 'EXPENSE', 'Purchases'),
        '5400': ('Salary Expense', 'EXPENSE', 'Other_Expense'),
        '5410': ('Rent Expense', 'EXPENSE', 'Other_Expense'),
        '5420': ('Electricity Expense', 'EXPENSE', 'Other_Expense'),
        '1190': ('Closing Stock', 'ASSET', ''),
        '5560': ('Cost of Goods Sold', 'EXPENSE', 'Other_Expense'),
        '6100': ('Round Off', 'EXPENSE', 'Other_Expense'),
    }
    # Per-leaf parent wiring so ProfitLossView's expense classifier works.
    # Direct (5500): COGS-style postings. Indirect (5700): G&A.
    PARENTS = {
        '5400': '5700', '5410': '5700', '5420': '5700',  # Personnel, Rent, Power
        '5560': '5500',  # Cost of Goods Sold rolls up to Direct Expenses
    }

    coa = {}
    for code, (name, atype, sub) in accounts.items():
        parent = group_objs.get(PARENTS.get(code))
        obj, _ = ChartOfAccount.objects.get_or_create(
            account_code=code,
            defaults=dict(account_name=name, account_type=atype,
                          account_subtype=sub, parent=parent,
                          is_leaf=True, is_active=True),
        )
        coa[code] = obj

    coa.update(group_objs)
    for key, code in AccountMapping.DEFAULT_CODES.items():
        if code in coa:
            AccountMapping.objects.get_or_create(
                key=key, defaults={'account': coa[code]},
            )
    return coa


def make_journal_entry(d=None, lines=None, post=True, **kw):
    """Quick way to create a balanced JE for tests."""
    from journals.models import JournalEntry, JournalEntryLine
    defaults = dict(
        date=d or date(2026, 4, 15),
        narration='Test entry',
        voucher_type='JOURNAL', reference_type='Manual',
        location_id=1,
    )
    defaults.update(kw)
    entry = JournalEntry.objects.create(**defaults)

    if lines is None:
        cash = ChartOfAccount.objects.get(account_code='1110')
        sales = ChartOfAccount.objects.get(account_code='4100')
        lines = [
            (cash, Decimal('100.00'), Decimal('0.00')),
            (sales, Decimal('0.00'), Decimal('100.00')),
        ]
    for acct, dr, cr in lines:
        JournalEntryLine.objects.create(entry=entry, account=acct,
                                        debit=dr, credit=cr)
    if post:
        entry.post()
    return entry


@contextmanager
def fake_active_location(all_access=None):
    """Make X-Location-Id headers work in API tests.

    The real resolver reads unmanaged inventory tables (LocationRO,
    UserProfileRO) that don't exist in the SQLite test DB, so this patches
    core.mixins to treat the header value as the active location verbatim.
    all_access=True/False forces the admin/all-stores check instead of
    querying UserProfileRO (superusers short-circuit it without the DB);
    None leaves the real check in place.
    """
    def _resolve(request):
        raw = request.META.get('HTTP_X_LOCATION_ID')
        try:
            return SimpleNamespace(id=int(raw)) if raw else None
        except (TypeError, ValueError):
            return None

    with ExitStack() as stack:
        stack.enter_context(
            mock.patch('core.mixins.resolve_active_location', _resolve))
        if all_access is not None:
            stack.enter_context(
                mock.patch('core.mixins._has_all_location_access',
                           lambda user: all_access))
        yield

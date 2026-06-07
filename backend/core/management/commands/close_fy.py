"""
Phase 5D: FY Closing management command.
Calculates net income, creates closing journal entry
(debit all revenue, credit all expense, net to Retained Earnings).
"""
from datetime import date
from decimal import Decimal
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum

from core.models import AccountingSettings, ChartOfAccount, AccountMapping
from journals.models import JournalEntry, JournalEntryLine


class Command(BaseCommand):
    help = 'Close a financial year by creating closing journal entries'

    def add_arguments(self, parser):
        parser.add_argument('fy', type=str, help='Financial year to close (e.g., 2024-25)')
        parser.add_argument('--location-id', type=int, required=True,
                            help='Store to close (required — closing is per store).')

    @transaction.atomic
    def handle(self, *args, **options):
        fy = options['fy']
        location_id = options['location_id']

        try:
            start_year, end_suffix = fy.split('-')
            start_year = int(start_year)
            end_year = int(f"{start_year // 100}{end_suffix}") if len(end_suffix) == 2 else int(end_suffix)
        except (ValueError, IndexError):
            raise CommandError(f'Invalid FY format: {fy}. Use YYYY-YY (e.g., 2024-25)')

        settings = AccountingSettings.get_settings()
        fy_start_month = settings.financial_year_start

        fy_start = date(start_year, fy_start_month, 1)
        if fy_start_month == 1:
            fy_end = date(start_year, 12, 31)
        else:
            import calendar
            end_month = fy_start_month - 1
            last_day = calendar.monthrange(end_year, end_month)[1]
            fy_end = date(end_year, end_month, last_day)

        if settings.last_closed_fy == fy:
            raise CommandError(f'FY {fy} is already closed.')

        # Get all posted entries in this FY, scoped to the store being closed.
        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            entry__date__range=[fy_start, fy_end],
            entry__location_id=location_id,
        )

        # Revenue accounts: close credit balances
        revenue_accounts = ChartOfAccount.objects.filter(account_type='REVENUE', is_leaf=True)
        # Expense accounts: close debit balances
        expense_accounts = ChartOfAccount.objects.filter(account_type='EXPENSE', is_leaf=True)

        entry = JournalEntry.objects.create(
            date=fy_end,
            narration=f'FY {fy} Closing Entry',
            voucher_type='JOURNAL',
            reference_type='Manual',
            location_id=location_id,
        )

        net_income = Decimal('0.00')

        for acc in revenue_accounts:
            agg = lines_qs.filter(account=acc).aggregate(dr=Sum('debit'), cr=Sum('credit'))
            dr = agg['dr'] or Decimal('0.00')
            cr = agg['cr'] or Decimal('0.00')
            balance = cr - dr
            if balance > 0:
                # Debit revenue to close it
                JournalEntryLine.objects.create(entry=entry, account=acc, debit=balance)
                net_income += balance
            elif balance < 0:
                JournalEntryLine.objects.create(entry=entry, account=acc, credit=abs(balance))
                net_income += balance

        for acc in expense_accounts:
            agg = lines_qs.filter(account=acc).aggregate(dr=Sum('debit'), cr=Sum('credit'))
            dr = agg['dr'] or Decimal('0.00')
            cr = agg['cr'] or Decimal('0.00')
            balance = dr - cr
            if balance > 0:
                # Credit expense to close it
                JournalEntryLine.objects.create(entry=entry, account=acc, credit=balance)
                net_income -= balance
            elif balance < 0:
                JournalEntryLine.objects.create(entry=entry, account=acc, debit=abs(balance))
                net_income -= balance

        # Net to Retained Earnings
        try:
            retained_earnings_ac = AccountMapping.get_account('RETAINED_EARNINGS', location_id=location_id)
        except ValueError:
            retained_earnings_ac = ChartOfAccount.objects.filter(
                account_subtype='Retained_Earnings', is_leaf=True
            ).first()

        if retained_earnings_ac and net_income != 0:
            if net_income > 0:
                JournalEntryLine.objects.create(entry=entry, account=retained_earnings_ac, credit=net_income)
            else:
                JournalEntryLine.objects.create(entry=entry, account=retained_earnings_ac, debit=abs(net_income))

        entry.post()

        settings.is_fy_closed = True
        settings.last_closed_fy = fy
        settings.save()

        self.stdout.write(self.style.SUCCESS(
            f'FY {fy} closed. Net income: {net_income}. Entry: {entry.entry_no}'
        ))

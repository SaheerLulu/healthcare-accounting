import csv
from collections import defaultdict
from decimal import Decimal
from datetime import date, timedelta
from django.http import HttpResponse
from django.db.models import Sum, Q, F
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from journals.models import JournalEntry, JournalEntryLine
from core.models import ChartOfAccount
from core.mixins import get_active_location


def get_fy_dates(year=None):
    """Get Indian FY start/end dates. FY starts April 1."""
    today = date.today()
    fy_year = year or (today.year if today.month >= 4 else today.year - 1)
    start = date(fy_year, 4, 1)
    end = date(fy_year + 1, 3, 31)
    return start, end


class TrialBalanceView(APIView):
    def get(self, request):
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        location = get_active_location(request)

        if not start_date or not end_date:
            fy_start, fy_end = get_fy_dates()
            start_date = fy_start.isoformat()
            end_date = fy_end.isoformat()

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            entry__date__range=[start_date, end_date]
        )
        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        accounts = ChartOfAccount.objects.filter(is_leaf=True).order_by('account_code')
        rows = []
        total_debit = Decimal('0.00')
        total_credit = Decimal('0.00')

        for account in accounts:
            agg = lines_qs.filter(account=account).aggregate(
                total_debit=Sum('debit'), total_credit=Sum('credit')
            )
            dr = agg['total_debit'] or Decimal('0.00')
            cr = agg['total_credit'] or Decimal('0.00')
            if dr > 0 or cr > 0:
                rows.append({
                    'account_code': account.account_code,
                    'account_name': account.account_name,
                    'account_type': account.account_type,
                    'debit': str(dr),
                    'credit': str(cr),
                    'balance': str(dr - cr),
                })
                total_debit += dr
                total_credit += cr

        return Response({
            'start_date': start_date,
            'end_date': end_date,
            'rows': rows,
            'total_debit': str(total_debit),
            'total_credit': str(total_credit),
            'is_balanced': total_debit == total_credit,
        })


class ProfitLossView(APIView):
    def get(self, request):
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        location = get_active_location(request)

        if not start_date or not end_date:
            fy_start, fy_end = get_fy_dates()
            start_date = fy_start.isoformat()
            end_date = fy_end.isoformat()

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            entry__date__range=[start_date, end_date]
        )
        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        def get_section(account_type):
            accounts = ChartOfAccount.objects.filter(
                account_type=account_type, is_leaf=True
            )
            items = []
            total = Decimal('0.00')
            for acc in accounts:
                agg = lines_qs.filter(account=acc).aggregate(
                    dr=Sum('debit'), cr=Sum('credit')
                )
                dr = agg['dr'] or Decimal('0.00')
                cr = agg['cr'] or Decimal('0.00')
                if account_type == 'REVENUE':
                    amount = cr - dr
                else:
                    amount = dr - cr
                if amount != 0:
                    items.append({
                        'account_code': acc.account_code,
                        'account_name': acc.account_name,
                        'amount': str(amount),
                    })
                    total += amount
            return items, total

        revenue_items, total_revenue = get_section('REVENUE')
        expense_items, total_expenses = get_section('EXPENSE')
        net_profit = total_revenue - total_expenses

        return Response({
            'start_date': start_date,
            'end_date': end_date,
            'revenue': {
                'items': revenue_items,
                'total': str(total_revenue),
            },
            'expenses': {
                'items': expense_items,
                'total': str(total_expenses),
            },
            'net_profit': str(net_profit),
        })


class BalanceSheetView(APIView):
    def get(self, request):
        as_of_date = request.query_params.get('date', date.today().isoformat())
        location = get_active_location(request)

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            entry__date__lte=as_of_date
        )
        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        def get_section_balances(account_type):
            accounts = ChartOfAccount.objects.filter(
                account_type=account_type, is_leaf=True
            )
            items = []
            total = Decimal('0.00')
            for acc in accounts:
                agg = lines_qs.filter(account=acc).aggregate(
                    dr=Sum('debit'), cr=Sum('credit')
                )
                dr = agg['dr'] or Decimal('0.00')
                cr = agg['cr'] or Decimal('0.00')
                if account_type == 'ASSET':
                    balance = dr - cr
                else:
                    balance = cr - dr
                if balance != 0:
                    items.append({
                        'account_code': acc.account_code,
                        'account_name': acc.account_name,
                        'balance': str(balance),
                    })
                    total += balance
            return items, total

        asset_items, total_assets = get_section_balances('ASSET')
        liability_items, total_liabilities = get_section_balances('LIABILITY')
        equity_items, total_equity = get_section_balances('EQUITY')

        # Phase 1E: Compute current year net income and include in equity
        # Net income = (revenue credits - revenue debits) - (expense debits - expense credits)
        revenue_agg = lines_qs.filter(account__account_type='REVENUE').aggregate(
            dr=Sum('debit'), cr=Sum('credit')
        )
        expense_agg = lines_qs.filter(account__account_type='EXPENSE').aggregate(
            dr=Sum('debit'), cr=Sum('credit')
        )
        rev_dr = revenue_agg['dr'] or Decimal('0.00')
        rev_cr = revenue_agg['cr'] or Decimal('0.00')
        exp_dr = expense_agg['dr'] or Decimal('0.00')
        exp_cr = expense_agg['cr'] or Decimal('0.00')

        net_income = (rev_cr - rev_dr) - (exp_dr - exp_cr)

        if net_income != 0:
            equity_items.append({
                'account_code': '-',
                'account_name': 'Current Year Profit/(Loss)',
                'balance': str(net_income),
            })
            total_equity += net_income

        total_liab_equity = total_liabilities + total_equity

        return Response({
            'as_of_date': as_of_date,
            'assets': {'items': asset_items, 'total': str(total_assets)},
            'liabilities': {'items': liability_items, 'total': str(total_liabilities)},
            'equity': {'items': equity_items, 'total': str(total_equity)},
            'total_liabilities_equity': str(total_liab_equity),
            'is_balanced': abs(total_assets - total_liab_equity) < Decimal('0.01'),
        })


class LedgerPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200


class LedgerView(APIView):
    def get(self, request):
        account_code = request.query_params.get('account_code')
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        location = get_active_location(request)
        page = request.query_params.get('page')

        if not account_code:
            return Response({'error': 'account_code is required'}, status=400)

        try:
            account = ChartOfAccount.objects.get(account_code=account_code)
        except ChartOfAccount.DoesNotExist:
            return Response({'error': 'Account not found'}, status=404)

        base_qs = JournalEntryLine.objects.filter(
            account=account,
            entry__is_posted=True
        ).select_related('entry')

        if location:
            base_qs = base_qs.filter(entry__location_id=location.id)

        # Phase 5B: Cursor-based pagination with opening balance
        if page and start_date:
            # Compute opening balance from entries before start_date
            opening_agg = base_qs.filter(entry__date__lt=start_date).aggregate(
                dr=Sum('debit'), cr=Sum('credit')
            )
            opening_balance = (opening_agg['dr'] or Decimal('0.00')) - (opening_agg['cr'] or Decimal('0.00'))
        else:
            opening_balance = Decimal('0.00')

        lines_qs = base_qs.order_by('entry__date', 'entry__id')
        if start_date:
            lines_qs = lines_qs.filter(entry__date__gte=start_date)
        if end_date:
            lines_qs = lines_qs.filter(entry__date__lte=end_date)

        if page:
            # Paginated response
            paginator = LedgerPagination()
            paginated = paginator.paginate_queryset(lines_qs, request)

            running_balance = opening_balance
            # Compute balance up to start of this page
            if paginator.page.number > 1:
                page_size = paginator.get_page_size(request)
                skip = (paginator.page.number - 1) * page_size
                pre_page_lines = lines_qs[:skip]
                for line in pre_page_lines:
                    running_balance += line.debit - line.credit

            transactions = []
            for line in paginated:
                running_balance += line.debit - line.credit
                transactions.append({
                    'date': line.entry.date,
                    'entry_no': line.entry.entry_no,
                    'narration': line.entry.narration or line.narration,
                    'voucher_type': line.entry.voucher_type,
                    'debit': str(line.debit),
                    'credit': str(line.credit),
                    'balance': str(running_balance),
                })

            return paginator.get_paginated_response({
                'account': {
                    'code': account.account_code,
                    'name': account.account_name,
                    'type': account.account_type,
                },
                'opening_balance': str(opening_balance),
                'transactions': transactions,
                'closing_balance': str(running_balance),
            })

        # Non-paginated (default/legacy)
        running_balance = opening_balance
        transactions = []
        for line in lines_qs:
            running_balance += line.debit - line.credit
            transactions.append({
                'date': line.entry.date,
                'entry_no': line.entry.entry_no,
                'narration': line.entry.narration or line.narration,
                'voucher_type': line.entry.voucher_type,
                'debit': str(line.debit),
                'credit': str(line.credit),
                'balance': str(running_balance),
            })

        return Response({
            'account': {
                'code': account.account_code,
                'name': account.account_name,
                'type': account.account_type,
            },
            'opening_balance': str(opening_balance),
            'transactions': transactions,
            'closing_balance': str(running_balance),
        })


class ReceivablesAgingView(APIView):
    def get(self, request):
        as_of_date = request.query_params.get('date', date.today().isoformat())
        location = get_active_location(request)

        as_of = date.fromisoformat(as_of_date)

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            entry__date__lte=as_of_date,
            party_type='Customer',
            account__account_subtype='Receivable'
        ).select_related('entry')

        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        from inventory_reader.models import CustomerRO

        customer_balances = defaultdict(Decimal)
        customer_dates = defaultdict(list)

        for line in lines_qs:
            net = line.debit - line.credit
            if net != 0:
                customer_balances[line.party_id] += net
                if line.debit > 0:
                    customer_dates[line.party_id].append((line.entry.date, line.debit))

        rows = []
        for customer_id, balance in customer_balances.items():
            if balance <= 0:
                continue
            try:
                customer = CustomerRO.objects.get(id=customer_id)
                name = customer.customer_name
            except CustomerRO.DoesNotExist:
                name = f'Customer #{customer_id}'

            aging = {'0_30': Decimal('0'), '31_60': Decimal('0'), '61_90': Decimal('0'), '90_plus': Decimal('0')}
            for inv_date, amount in customer_dates.get(customer_id, []):
                days = (as_of - inv_date).days
                if days <= 30:
                    aging['0_30'] += amount
                elif days <= 60:
                    aging['31_60'] += amount
                elif days <= 90:
                    aging['61_90'] += amount
                else:
                    aging['90_plus'] += amount

            rows.append({
                'customer_id': customer_id,
                'customer_name': name,
                'total_outstanding': str(balance),
                'aging_0_30': str(aging['0_30']),
                'aging_31_60': str(aging['31_60']),
                'aging_61_90': str(aging['61_90']),
                'aging_90_plus': str(aging['90_plus']),
            })

        rows.sort(key=lambda x: Decimal(x['total_outstanding']), reverse=True)
        total_outstanding = sum(Decimal(r['total_outstanding']) for r in rows)

        return Response({
            'as_of_date': as_of_date,
            'rows': rows,
            'total_outstanding': str(total_outstanding),
        })


class PayablesAgingView(APIView):
    def get(self, request):
        as_of_date = request.query_params.get('date', date.today().isoformat())
        location = get_active_location(request)

        as_of = date.fromisoformat(as_of_date)

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            entry__date__lte=as_of_date,
            party_type='Supplier',
            account__account_subtype='Payable'
        ).select_related('entry')

        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        from inventory_reader.models import SupplierRO

        supplier_balances = defaultdict(Decimal)
        supplier_dates = defaultdict(list)

        for line in lines_qs:
            net = line.credit - line.debit
            if net != 0:
                supplier_balances[line.party_id] += net
                if line.credit > 0:
                    supplier_dates[line.party_id].append((line.entry.date, line.credit))

        rows = []
        for supplier_id, balance in supplier_balances.items():
            if balance <= 0:
                continue
            try:
                supplier = SupplierRO.objects.get(id=supplier_id)
                name = supplier.company_name
            except SupplierRO.DoesNotExist:
                name = f'Supplier #{supplier_id}'

            aging = {'0_30': Decimal('0'), '31_60': Decimal('0'), '61_90': Decimal('0'), '90_plus': Decimal('0')}
            for inv_date, amount in supplier_dates.get(supplier_id, []):
                days = (as_of - inv_date).days
                if days <= 30:
                    aging['0_30'] += amount
                elif days <= 60:
                    aging['31_60'] += amount
                elif days <= 90:
                    aging['61_90'] += amount
                else:
                    aging['90_plus'] += amount

            rows.append({
                'supplier_id': supplier_id,
                'supplier_name': name,
                'total_outstanding': str(balance),
                'aging_0_30': str(aging['0_30']),
                'aging_31_60': str(aging['31_60']),
                'aging_61_90': str(aging['61_90']),
                'aging_90_plus': str(aging['90_plus']),
            })

        rows.sort(key=lambda x: Decimal(x['total_outstanding']), reverse=True)
        total_outstanding = sum(Decimal(r['total_outstanding']) for r in rows)

        return Response({
            'as_of_date': as_of_date,
            'rows': rows,
            'total_outstanding': str(total_outstanding),
        })


def _build_book_response(account_subtype, request):
    """Shared logic for Bank Book and Cash Book — filtered ledger views."""
    start_date = request.query_params.get('start_date')
    end_date = request.query_params.get('end_date')
    account_code = request.query_params.get('account_code')
    location = get_active_location(request)

    accounts = ChartOfAccount.objects.filter(account_subtype=account_subtype).order_by('account_code')
    if account_code:
        accounts = accounts.filter(account_code=account_code)

    if not accounts.exists():
        return Response({'accounts': [], 'summary': {'total_debit': '0.00', 'total_credit': '0.00'}})

    result_accounts = []
    grand_debit = Decimal('0.00')
    grand_credit = Decimal('0.00')

    for account in accounts:
        base_qs = JournalEntryLine.objects.filter(
            account=account, entry__is_posted=True
        ).select_related('entry')
        if location:
            base_qs = base_qs.filter(entry__location_id=location.id)

        # Opening balance
        if start_date:
            opening_agg = base_qs.filter(entry__date__lt=start_date).aggregate(
                dr=Sum('debit'), cr=Sum('credit')
            )
            opening_balance = (opening_agg['dr'] or Decimal('0.00')) - (opening_agg['cr'] or Decimal('0.00'))
        else:
            opening_balance = Decimal('0.00')

        lines_qs = base_qs.order_by('entry__date', 'entry__id')
        if start_date:
            lines_qs = lines_qs.filter(entry__date__gte=start_date)
        if end_date:
            lines_qs = lines_qs.filter(entry__date__lte=end_date)

        running_balance = opening_balance
        transactions = []
        for line in lines_qs:
            running_balance += line.debit - line.credit
            transactions.append({
                'date': line.entry.date,
                'entry_no': line.entry.entry_no,
                'narration': line.entry.narration or line.narration,
                'voucher_type': line.entry.voucher_type,
                'debit': str(line.debit),
                'credit': str(line.credit),
                'balance': str(running_balance),
            })
            grand_debit += line.debit
            grand_credit += line.credit

        result_accounts.append({
            'account_code': account.account_code,
            'account_name': account.account_name,
            'opening_balance': str(opening_balance),
            'transactions': transactions,
            'closing_balance': str(running_balance),
        })

    return Response({
        'accounts': result_accounts,
        'summary': {
            'total_debit': str(grand_debit),
            'total_credit': str(grand_credit),
        },
    })


class BankBookView(APIView):
    def get(self, request):
        return _build_book_response('Bank', request)


class CashBookView(APIView):
    def get(self, request):
        return _build_book_response('Cash', request)


class DaybookView(APIView):
    def get(self, request):
        target_date = request.query_params.get('date')
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        location = get_active_location(request)

        if target_date:
            start_date = target_date
            end_date = target_date
        elif not start_date:
            start_date = date.today().isoformat()
            end_date = end_date or start_date

        entries_qs = JournalEntry.objects.filter(
            is_posted=True,
            date__range=[start_date, end_date],
        ).prefetch_related('lines__account').order_by('date', 'created_at')

        if location:
            entries_qs = entries_qs.filter(location_id=location.id)

        grouped = defaultdict(list)
        total_debit = Decimal('0.00')
        total_credit = Decimal('0.00')
        total_entries = 0

        for entry in entries_qs:
            entry_lines = []
            for line in entry.lines.all():
                entry_lines.append({
                    'account_code': line.account.account_code,
                    'account_name': line.account.account_name,
                    'debit': str(line.debit),
                    'credit': str(line.credit),
                })
                total_debit += line.debit
                total_credit += line.credit

            grouped[str(entry.date)].append({
                'id': entry.id,
                'entry_no': entry.entry_no,
                'voucher_type': entry.voucher_type,
                'narration': entry.narration,
                'lines': entry_lines,
            })
            total_entries += 1

        days = [{'date': d, 'entries': entries} for d, entries in sorted(grouped.items())]

        return Response({
            'start_date': start_date,
            'end_date': end_date,
            'days': days,
            'summary': {
                'total_entries': total_entries,
                'total_debit': str(total_debit),
                'total_credit': str(total_credit),
            },
        })


class GSTComputationView(APIView):
    """Phase 5C: GST computation worksheet with ITC utilization order."""
    def get(self, request):
        period = request.query_params.get('period')
        location = get_active_location(request)

        if not period:
            return Response({'error': 'period is required'}, status=400)

        from gst_returns.models import GSTR1Entry, GSTR2BEntry

        filters = {'period': period, 'is_active': True}
        if location:
            filters['location_id'] = location.id

        # Output tax by rate
        output_entries = GSTR1Entry.objects.filter(**filters).exclude(invoice_type__in=['CREDIT_NOTE', 'CDNR', 'CDNUR'])
        output_by_rate = {}
        for entry in output_entries:
            rate_key = str(entry.rate)
            if rate_key not in output_by_rate:
                output_by_rate[rate_key] = {'taxable': Decimal('0'), 'cgst': Decimal('0'), 'sgst': Decimal('0'), 'igst': Decimal('0')}
            output_by_rate[rate_key]['taxable'] += entry.taxable_value
            output_by_rate[rate_key]['cgst'] += entry.cgst
            output_by_rate[rate_key]['sgst'] += entry.sgst
            output_by_rate[rate_key]['igst'] += entry.igst

        # Input tax from GSTR-2B
        input_filters = {'period': period, 'itc_eligible': True}
        if location:
            input_filters['location_id'] = location.id

        input_agg = GSTR2BEntry.objects.filter(**input_filters).aggregate(
            taxable=Sum('taxable_value'),
            cgst=Sum('cgst'), sgst=Sum('sgst'), igst=Sum('igst'),
        )

        total_output_cgst = sum(v['cgst'] for v in output_by_rate.values())
        total_output_sgst = sum(v['sgst'] for v in output_by_rate.values())
        total_output_igst = sum(v['igst'] for v in output_by_rate.values())

        itc_cgst = input_agg['cgst'] or Decimal('0')
        itc_sgst = input_agg['sgst'] or Decimal('0')
        itc_igst = input_agg['igst'] or Decimal('0')

        # ITC utilization order: IGST → CGST → SGST
        net_igst = max(total_output_igst - itc_igst, Decimal('0'))
        igst_surplus = max(itc_igst - total_output_igst, Decimal('0'))
        effective_itc_cgst = itc_cgst + min(igst_surplus, max(total_output_cgst - itc_cgst, Decimal('0')))
        remaining_surplus = max(igst_surplus - max(total_output_cgst - itc_cgst, Decimal('0')), Decimal('0'))
        effective_itc_sgst = itc_sgst + min(remaining_surplus, max(total_output_sgst - itc_sgst, Decimal('0')))

        net_cgst = max(total_output_cgst - effective_itc_cgst, Decimal('0'))
        net_sgst = max(total_output_sgst - effective_itc_sgst, Decimal('0'))

        return Response({
            'period': period,
            'output_tax': {
                'by_rate': [
                    {'rate': k, **{kk: str(vv) for kk, vv in v.items()}}
                    for k, v in sorted(output_by_rate.items())
                ],
                'total_cgst': str(total_output_cgst),
                'total_sgst': str(total_output_sgst),
                'total_igst': str(total_output_igst),
            },
            'input_tax': {
                'taxable': str(input_agg['taxable'] or Decimal('0')),
                'cgst': str(itc_cgst),
                'sgst': str(itc_sgst),
                'igst': str(itc_igst),
            },
            'net_payable': {
                'cgst': str(net_cgst),
                'sgst': str(net_sgst),
                'igst': str(net_igst),
                'total': str(net_cgst + net_sgst + net_igst),
            },
        })


class HSNSummaryView(APIView):
    """Phase 5C: HSN-code aggregation for sales/purchases."""
    def get(self, request):
        period = request.query_params.get('period')
        location = get_active_location(request)

        if not period:
            return Response({'error': 'period is required'}, status=400)

        from gst_returns.models import GSTR1HSNSummary

        filters = {'period': period, 'is_active': True}
        if location:
            filters['location_id'] = location.id

        hsn_entries = GSTR1HSNSummary.objects.filter(**filters)

        rows = []
        for entry in hsn_entries:
            rows.append({
                'hsn_code': entry.hsn_code,
                'description': entry.description,
                'uqc': entry.uqc,
                'quantity': str(entry.quantity),
                'taxable_value': str(entry.taxable_value),
                'cgst': str(entry.cgst),
                'sgst': str(entry.sgst),
                'igst': str(entry.igst),
                'rate': str(entry.rate),
                'total_tax': str(entry.cgst + entry.sgst + entry.igst),
            })

        return Response({
            'period': period,
            'rows': rows,
            'total_taxable': str(sum(Decimal(r['taxable_value']) for r in rows)),
            'total_tax': str(sum(Decimal(r['total_tax']) for r in rows)),
        })


class PartyOutstandingView(APIView):
    """Phase 5C: Per customer/supplier outstanding with aging."""
    def get(self, request):
        party_type = request.query_params.get('party_type', 'Customer')
        as_of_date = request.query_params.get('date', date.today().isoformat())
        location = get_active_location(request)

        as_of = date.fromisoformat(as_of_date)

        if party_type == 'Customer':
            lines_qs = JournalEntryLine.objects.filter(
                entry__is_posted=True, entry__date__lte=as_of_date,
                party_type='Customer',
            ).select_related('entry')
        else:
            lines_qs = JournalEntryLine.objects.filter(
                entry__is_posted=True, entry__date__lte=as_of_date,
                party_type='Supplier',
            ).select_related('entry')

        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        party_data = defaultdict(lambda: {
            'opening': Decimal('0'), 'invoices': Decimal('0'),
            'payments': Decimal('0'), 'closing': Decimal('0'),
            'aging': {'0_30': Decimal('0'), '31_60': Decimal('0'), '61_90': Decimal('0'), '90_plus': Decimal('0')},
        })

        for line in lines_qs:
            pid = line.party_id
            if not pid:
                continue

            if party_type == 'Customer':
                net = line.debit - line.credit
                if line.debit > 0:
                    party_data[pid]['invoices'] += line.debit
                    days = (as_of - line.entry.date).days
                    bucket = '0_30' if days <= 30 else '31_60' if days <= 60 else '61_90' if days <= 90 else '90_plus'
                    party_data[pid]['aging'][bucket] += line.debit
                if line.credit > 0:
                    party_data[pid]['payments'] += line.credit
            else:
                net = line.credit - line.debit
                if line.credit > 0:
                    party_data[pid]['invoices'] += line.credit
                    days = (as_of - line.entry.date).days
                    bucket = '0_30' if days <= 30 else '31_60' if days <= 60 else '61_90' if days <= 90 else '90_plus'
                    party_data[pid]['aging'][bucket] += line.credit
                if line.debit > 0:
                    party_data[pid]['payments'] += line.debit

            party_data[pid]['closing'] += net if party_type == 'Customer' else (line.credit - line.debit)

        # Resolve party names
        if party_type == 'Customer':
            from inventory_reader.models import CustomerRO
            model = CustomerRO
            name_field = 'customer_name'
        else:
            from inventory_reader.models import SupplierRO
            model = SupplierRO
            name_field = 'company_name'

        rows = []
        for pid, data in party_data.items():
            if data['closing'] <= 0:
                continue
            try:
                party = model.objects.get(id=pid)
                name = getattr(party, name_field)
            except model.DoesNotExist:
                name = f'{party_type} #{pid}'

            rows.append({
                'party_id': pid,
                'party_name': name,
                'opening_balance': str(data['opening']),
                'invoices': str(data['invoices']),
                'payments': str(data['payments']),
                'closing_balance': str(data['closing']),
                'aging_0_30': str(data['aging']['0_30']),
                'aging_31_60': str(data['aging']['31_60']),
                'aging_61_90': str(data['aging']['61_90']),
                'aging_90_plus': str(data['aging']['90_plus']),
            })

        rows.sort(key=lambda x: Decimal(x['closing_balance']), reverse=True)

        return Response({
            'party_type': party_type,
            'as_of_date': as_of_date,
            'rows': rows,
            'total_outstanding': str(sum(Decimal(r['closing_balance']) for r in rows)),
        })


class StockMovementSummaryView(APIView):
    """Product-wise stock movement summary."""
    def get(self, request):
        from inventory_reader.models import StockMovementRO, ProductRO

        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        location = get_active_location(request)

        movements = StockMovementRO.objects.select_related('product').all()
        if location:
            movements = movements.filter(location_id=location.id)

        # Split into before-period and in-period
        if start_date:
            opening_movements = movements.filter(created_at__date__lt=start_date)
            period_movements = movements.filter(created_at__date__gte=start_date)
        else:
            opening_movements = StockMovementRO.objects.none()
            period_movements = movements

        if end_date:
            period_movements = period_movements.filter(created_at__date__lte=end_date)

        # Compute opening balances
        opening_data = defaultdict(int)
        for mv in opening_movements:
            if mv.movement_type in ('purchase', 'purchase_return_in', 'adjustment_in'):
                opening_data[mv.product_id] += mv.quantity
            else:
                opening_data[mv.product_id] -= mv.quantity

        # Compute period movements
        product_data = defaultdict(lambda: {'in': 0, 'out': 0})
        for mv in period_movements:
            if mv.movement_type in ('purchase', 'purchase_return_in', 'adjustment_in'):
                product_data[mv.product_id]['in'] += mv.quantity
            else:
                product_data[mv.product_id]['out'] += mv.quantity

        # Collect all product IDs
        all_pids = set(opening_data.keys()) | set(product_data.keys())
        products = {p.id: p for p in ProductRO.objects.filter(id__in=all_pids)}

        rows = []
        for pid in sorted(all_pids):
            product = products.get(pid)
            opening = opening_data.get(pid, 0)
            inward = product_data[pid]['in']
            outward = product_data[pid]['out']
            closing = opening + inward - outward

            rows.append({
                'product_id': pid,
                'product_name': product.name if product else f'Product #{pid}',
                'hsn_code': product.pharma_hsn_code if product else '',
                'opening_qty': opening,
                'inward_qty': inward,
                'outward_qty': outward,
                'closing_qty': closing,
            })

        rows.sort(key=lambda x: x['product_name'])

        return Response({
            'start_date': start_date,
            'end_date': end_date,
            'rows': rows,
            'total_products': len(rows),
        })


class StockValuationView(APIView):
    """Product-wise stock valuation using weighted average cost."""
    def get(self, request):
        from inventory_reader.models import StockMovementRO, ProductRO, PurchaseOrderLineRO

        as_of_date = request.query_params.get('date', date.today().isoformat())
        location = get_active_location(request)

        # Get closing quantities
        movements = StockMovementRO.objects.filter(created_at__date__lte=as_of_date)
        if location:
            movements = movements.filter(location_id=location.id)

        qty_data = defaultdict(int)
        for mv in movements:
            if mv.movement_type in ('purchase', 'purchase_return_in', 'adjustment_in'):
                qty_data[mv.product_id] += mv.quantity
            else:
                qty_data[mv.product_id] -= mv.quantity

        # Get weighted average purchase rate per product
        po_lines = PurchaseOrderLineRO.objects.filter(
            purchase_order__state__in=['confirmed', 'done', 'approved']
        ).values('product_id').annotate(
            total_qty=Sum('quantity'),
            total_value=Sum(F('quantity') * F('purchase_rate')),
        )

        avg_rates = {}
        for line in po_lines:
            if line['total_qty'] and line['total_qty'] > 0:
                avg_rates[line['product_id']] = Decimal(str(line['total_value'])) / Decimal(str(line['total_qty']))

        all_pids = [pid for pid, qty in qty_data.items() if qty > 0]
        products = {p.id: p for p in ProductRO.objects.filter(id__in=all_pids)}

        rows = []
        total_value = Decimal('0.00')
        for pid in all_pids:
            product = products.get(pid)
            qty = qty_data[pid]
            rate = avg_rates.get(pid, Decimal('0.00')).quantize(Decimal('0.01'))
            value = (Decimal(str(qty)) * rate).quantize(Decimal('0.01'))
            total_value += value

            rows.append({
                'product_id': pid,
                'product_name': product.name if product else f'Product #{pid}',
                'hsn_code': product.pharma_hsn_code if product else '',
                'closing_qty': qty,
                'avg_rate': str(rate),
                'value': str(value),
            })

        rows.sort(key=lambda x: x['product_name'])

        return Response({
            'as_of_date': as_of_date,
            'rows': rows,
            'total_products': len(rows),
            'total_value': str(total_value),
        })

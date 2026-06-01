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


def resolve_ledger_account(request):
    """Resolve the ChartOfAccount a ledger view is asking for.

    Accepts (in priority order): ?account_id=, ?party_type=&party_id=, or
    ?account_code=. Code lookup prefers the row scoped to the active location,
    falling back to the shared (NULL-location) template — so it stays
    unambiguous under per-location clones and per-party leaves. Returns
    (account, error_response): exactly one is non-None.
    """
    account_id = request.query_params.get('account_id')
    party_type = request.query_params.get('party_type')
    party_id = request.query_params.get('party_id')
    account_code = request.query_params.get('account_code')

    if account_id:
        acc = ChartOfAccount.objects.filter(pk=account_id).first()
        return (acc, None) if acc else (None, Response({'error': 'Account not found'}, status=404))

    if party_type and party_id:
        from core.party_ledgers import get_party_ledger
        acc = get_party_ledger(party_type, party_id)
        return (acc, None) if acc else (None, Response({'error': 'Party ledger not found'}, status=404))

    if not account_code:
        return None, Response({'error': 'account_code (or account_id / party_type+party_id) is required'}, status=400)

    location = get_active_location(request)
    qs = ChartOfAccount.objects.filter(account_code=account_code)
    # Prefer the active-location row, else the shared template; deterministic.
    acc = (qs.filter(location_id=location.id).first() if location else None) \
        or qs.filter(location_id__isnull=True).first() \
        or qs.order_by('location_id').first()
    return (acc, None) if acc else (None, Response({'error': 'Account not found'}, status=404))


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
            net = dr - cr
            if net == 0:
                continue
            net_dr = net if net > 0 else Decimal('0.00')
            net_cr = -net if net < 0 else Decimal('0.00')
            rows.append({
                'account_code': account.account_code,
                'account_name': account.account_name,
                'account_type': account.account_type,
                'debit': str(net_dr),
                'credit': str(net_cr),
                'balance': str(net),
            })
            total_debit += net_dr
            total_credit += net_cr

        return Response({
            'start_date': start_date,
            'end_date': end_date,
            'rows': rows,
            'total_debit': str(total_debit),
            'total_credit': str(total_credit),
            'is_balanced': total_debit == total_credit,
        })


class ProfitLossView(APIView):
    """Tally-style P&L with explicit Gross Profit subtotal.

    Structure:
        Revenue                         (every REVENUE leaf account)
      − Direct Expenses                 (EXPENSE leaves rolling up to 5500)
      ─────────────────────────────
      = Gross Profit
      − Indirect Expenses               (EXPENSE leaves rolling up to 5700)
      − Other Expenses                  (EXPENSE leaves not under 5500/5700)
      ─────────────────────────────
      = Net Profit

    Expense classification walks each leaf up the `parent` chain until a
    direct child of a root group is found. `5500 Direct Expenses` and
    `5700 Indirect Expenses` are the canonical Tally groups; anything
    else (e.g. residual 5100 Purchases postings from before the perpetual
    cutover) falls into Other Expenses so it stays visible.
    """

    DIRECT_GROUP = '5500'
    INDIRECT_GROUP = '5700'

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

        def expense_bucket(acc):
            """Walk parents up to a root group; return DIRECT_GROUP /
            INDIRECT_GROUP / None. Short-circuits as soon as either is
            encountered, so leaves nested deeper than 1 still classify.
            """
            cur = acc.parent
            seen = set()
            while cur is not None and cur.account_code not in seen:
                seen.add(cur.account_code)
                if cur.account_code == self.DIRECT_GROUP:
                    return self.DIRECT_GROUP
                if cur.account_code == self.INDIRECT_GROUP:
                    return self.INDIRECT_GROUP
                cur = cur.parent
            return None

        revenue_items = []
        total_revenue = Decimal('0.00')
        for acc in ChartOfAccount.objects.filter(
            account_type='REVENUE', is_leaf=True
        ).order_by('account_code'):
            agg = lines_qs.filter(account=acc).aggregate(
                dr=Sum('debit'), cr=Sum('credit'),
            )
            amount = (agg['cr'] or Decimal('0')) - (agg['dr'] or Decimal('0'))
            if amount != 0:
                revenue_items.append({
                    'account_code': acc.account_code,
                    'account_name': acc.account_name,
                    'amount': str(amount),
                })
                total_revenue += amount

        direct_items, indirect_items, other_items = [], [], []
        total_direct = total_indirect = total_other = Decimal('0.00')
        for acc in ChartOfAccount.objects.select_related('parent').filter(
            account_type='EXPENSE', is_leaf=True,
        ).order_by('account_code'):
            agg = lines_qs.filter(account=acc).aggregate(
                dr=Sum('debit'), cr=Sum('credit'),
            )
            amount = (agg['dr'] or Decimal('0')) - (agg['cr'] or Decimal('0'))
            if amount == 0:
                continue
            row = {
                'account_code': acc.account_code,
                'account_name': acc.account_name,
                'amount': str(amount),
            }
            bucket = expense_bucket(acc)
            if bucket == self.DIRECT_GROUP:
                direct_items.append(row)
                total_direct += amount
            elif bucket == self.INDIRECT_GROUP:
                indirect_items.append(row)
                total_indirect += amount
            else:
                other_items.append(row)
                total_other += amount

        gross_profit = total_revenue - total_direct
        net_profit = gross_profit - total_indirect - total_other

        return Response({
            'start_date': start_date,
            'end_date': end_date,
            'revenue': {
                'items': revenue_items,
                'total': str(total_revenue),
            },
            'direct_expenses': {
                'items': direct_items,
                'total': str(total_direct),
            },
            'gross_profit': str(gross_profit),
            'indirect_expenses': {
                'items': indirect_items,
                'total': str(total_indirect),
            },
            'other_expenses': {
                'items': other_items,
                'total': str(total_other),
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

        # Phase 1E: Compute current year net income and include in equity.
        # is_leaf=True keeps this in lockstep with ProfitLossView so the two
        # reports always tie out — even if a stray posting hits a parent account.
        revenue_agg = lines_qs.filter(
            account__account_type='REVENUE', account__is_leaf=True,
        ).aggregate(dr=Sum('debit'), cr=Sum('credit'))
        expense_agg = lines_qs.filter(
            account__account_type='EXPENSE', account__is_leaf=True,
        ).aggregate(dr=Sum('debit'), cr=Sum('credit'))
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
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        location = get_active_location(request)
        page = request.query_params.get('page')

        account, error = resolve_ledger_account(request)
        if error is not None:
            return error

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


class LedgerExportView(APIView):
    """
    WP 614 — export account ledger as CSV (default), Excel (?format=xlsx),
    or PDF (?format=pdf). Same query params as LedgerView (account_code,
    start_date, end_date).
    """

    def get(self, request):
        from django.http import HttpResponse
        import csv
        import io

        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        fmt = request.query_params.get('format', 'csv').lower()
        location = get_active_location(request)

        account, error = resolve_ledger_account(request)
        if error is not None:
            return error

        base_qs = JournalEntryLine.objects.filter(
            account=account, entry__is_posted=True,
        ).select_related('entry')
        if location:
            base_qs = base_qs.filter(entry__location_id=location.id)

        opening_balance = Decimal('0.00')
        if start_date:
            agg = base_qs.filter(entry__date__lt=start_date).aggregate(
                dr=Sum('debit'), cr=Sum('credit'),
            )
            opening_balance = (agg['dr'] or Decimal('0.00')) - (agg['cr'] or Decimal('0.00'))

        lines_qs = base_qs.order_by('entry__date', 'entry__id')
        if start_date:
            lines_qs = lines_qs.filter(entry__date__gte=start_date)
        if end_date:
            lines_qs = lines_qs.filter(entry__date__lte=end_date)

        rows = []
        running = opening_balance
        for line in lines_qs:
            running += line.debit - line.credit
            rows.append({
                'date': line.entry.date.isoformat(),
                'entry_no': line.entry.entry_no,
                'narration': line.entry.narration or line.narration,
                'voucher_type': line.entry.voucher_type,
                'debit': str(line.debit),
                'credit': str(line.credit),
                'balance': str(running),
            })

        if fmt == 'xlsx':
            from openpyxl import Workbook
            wb = Workbook()
            ws = wb.active
            ws.title = f'Ledger {account.account_code}'
            ws.append([f'Account: {account.account_code} — {account.account_name}'])
            ws.append([f'Period: {start_date or "all"} to {end_date or "all"}'])
            ws.append([f'Opening Balance: {opening_balance}'])
            ws.append([])
            ws.append(['Date', 'Entry No', 'Narration', 'Voucher', 'Debit', 'Credit', 'Balance'])
            for r in rows:
                ws.append([r['date'], r['entry_no'], r['narration'], r['voucher_type'],
                           r['debit'], r['credit'], r['balance']])
            ws.append([])
            ws.append(['', '', '', 'Closing', '', '', str(running)])
            buf = io.BytesIO(); wb.save(buf); buf.seek(0)
            response = HttpResponse(
                buf.read(),
                content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            )
            response['Content-Disposition'] = (
                f'attachment; filename="ledger_{account.account_code}.xlsx"'
            )
            return response

        if fmt == 'pdf':
            from reportlab.lib.pagesizes import A4, landscape
            from reportlab.lib import colors
            from reportlab.lib.styles import getSampleStyleSheet
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

            buf = io.BytesIO()
            doc = SimpleDocTemplate(buf, pagesize=landscape(A4),
                                    topMargin=24, bottomMargin=24,
                                    leftMargin=24, rightMargin=24)
            styles = getSampleStyleSheet()
            story = [
                Paragraph(f'<b>Ledger — {account.account_code} {account.account_name}</b>',
                          styles['Title']),
                Paragraph(f'Period: {start_date or "All"} to {end_date or "All"}',
                          styles['Normal']),
                Paragraph(f'Opening balance: {opening_balance}', styles['Normal']),
                Spacer(1, 8),
            ]
            data = [['Date', 'Entry', 'Narration', 'Voucher', 'Debit', 'Credit', 'Balance']]
            for r in rows:
                data.append([r['date'], r['entry_no'], r['narration'][:60],
                             r['voucher_type'], r['debit'], r['credit'], r['balance']])
            data.append(['', '', '', 'Closing', '', '', str(running)])
            tbl = Table(data, repeatRows=1)
            tbl.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e5e7eb')),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
                ('GRID', (0, 0), (-1, -1), 0.25, colors.grey),
                ('ALIGN', (4, 1), (6, -1), 'RIGHT'),
                ('FONTSIZE', (0, 0), (-1, -1), 8),
            ]))
            story.append(tbl)
            doc.build(story)
            response = HttpResponse(buf.getvalue(), content_type='application/pdf')
            response['Content-Disposition'] = (
                f'attachment; filename="ledger_{account.account_code}.pdf"'
            )
            buf.close()
            return response

        # default — CSV
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = (
            f'attachment; filename="ledger_{account.account_code}.csv"'
        )
        w = csv.writer(response)
        w.writerow([f'Account: {account.account_code} — {account.account_name}'])
        w.writerow([f'Period: {start_date or "all"} to {end_date or "all"}'])
        w.writerow([f'Opening Balance: {opening_balance}'])
        w.writerow([])
        w.writerow(['Date', 'Entry No', 'Narration', 'Voucher', 'Debit', 'Credit', 'Balance'])
        for r in rows:
            w.writerow([r['date'], r['entry_no'], r['narration'], r['voucher_type'],
                        r['debit'], r['credit'], r['balance']])
        w.writerow([])
        w.writerow(['', '', '', 'Closing', '', '', str(running)])
        return response


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


class OpenCustomerInvoicesView(APIView):
    """One row per customer SALE journal entry whose customer still has a
    net outstanding balance. Unlike Payables (which uses the Bill model
    with proper per-bill allocation), customer invoices live as JEs and
    receipts are not allocated to specific invoices — so the balance is
    tracked at the customer level. We expose the invoice rows here so the
    user can pick one and record a receipt against that customer.

    Each row: invoice_no (entry_no), date, party, party_id, amount (Dr on
    the Receivable line within this JE), customer_outstanding (net balance
    across all the customer's JEs up to `as_of`).
    """
    def get(self, request):
        as_of_date = request.query_params.get('date', date.today().isoformat())
        search = request.query_params.get('search', '').strip().lower()
        location = get_active_location(request)

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            entry__date__lte=as_of_date,
            party_type='Customer',
            account__account_subtype='Receivable',
            debit__gt=0,
        ).select_related('entry')
        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        # Per-customer net outstanding (debit minus credit on Receivable across
        # ALL their JEs up to as_of). We only emit invoice rows for customers
        # whose net is positive — fully-settled customers fall out.
        all_lines = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            entry__date__lte=as_of_date,
            party_type='Customer',
            account__account_subtype='Receivable',
        )
        if location:
            all_lines = all_lines.filter(entry__location_id=location.id)

        per_customer = defaultdict(lambda: Decimal('0'))
        for line in all_lines:
            per_customer[line.party_id] += line.debit - line.credit

        from inventory_reader.models import CustomerRO

        # Resolve invoice rows.
        rows = []
        for line in lines_qs.order_by('entry__date', 'entry__id'):
            pid = line.party_id
            outstanding = per_customer.get(pid, Decimal('0'))
            if outstanding <= 0:
                continue
            try:
                customer = CustomerRO.objects.get(id=pid)
                name = customer.customer_name
            except CustomerRO.DoesNotExist:
                name = f'Customer #{pid}'
            if search and search not in name.lower() \
                    and search not in (line.entry.entry_no or '').lower():
                continue
            rows.append({
                'invoice_no': line.entry.entry_no,
                'voucher_type': line.entry.voucher_type,
                'date': line.entry.date.isoformat(),
                'party_id': pid,
                'party_name': name,
                'amount': str(line.debit),
                'narration': line.entry.narration or '',
                'customer_outstanding': str(outstanding),
            })

        return Response({
            'as_of_date': as_of_date,
            'rows': rows,
            'total_invoices': len(rows),
            'total_outstanding': str(sum(
                {r['party_id']: Decimal(r['customer_outstanding']) for r in rows}.values()
            )),
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

        # StockMovementRO.quantity is signed (positive = IN, negative = OUT)
        # per inventory_management's MovementType convention — just sum it.
        opening_data = defaultdict(int)
        for mv in opening_movements:
            opening_data[mv.product_id] += mv.quantity

        product_data = defaultdict(lambda: {'in': 0, 'out': 0})
        for mv in period_movements:
            if mv.quantity >= 0:
                product_data[mv.product_id]['in'] += mv.quantity
            else:
                product_data[mv.product_id]['out'] += -mv.quantity

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
        from inventory_reader.models import (
            StockMovementRO, ProductRO, PurchaseOrderLineRO, OpeningStockLineRO,
        )

        as_of_date = request.query_params.get('date', date.today().isoformat())
        location = get_active_location(request)

        # StockMovementRO.quantity is signed (positive = IN, negative = OUT)
        # per inventory_management's MovementType convention — so a simple
        # sum gives qty on hand. This already covers opening_stock, purchase_in,
        # sales (negative), returns, write-offs, and transfers.
        movements = StockMovementRO.objects.filter(created_at__date__lte=as_of_date)
        if location:
            movements = movements.filter(location_id=location.id)

        qty_data = defaultdict(int)
        for mv in movements:
            qty_data[mv.product_id] += mv.quantity

        # Weighted-average cost per product. Aggregate both PO lines AND
        # opening-stock lines so seeded inventory has a non-zero rate even
        # before its first purchase order.
        cost_totals = defaultdict(lambda: {'qty': Decimal('0'), 'value': Decimal('0')})

        po_lines = PurchaseOrderLineRO.objects.filter(
            purchase_order__state__in=['confirmed', 'done', 'approved']
        ).values('product_id').annotate(
            total_qty=Sum('quantity'),
            total_value=Sum(F('quantity') * F('purchase_rate')),
        )
        for line in po_lines:
            if line['total_qty'] and line['total_qty'] > 0:
                cost_totals[line['product_id']]['qty'] += Decimal(str(line['total_qty']))
                cost_totals[line['product_id']]['value'] += Decimal(str(line['total_value']))

        os_lines = OpeningStockLineRO.objects.values('product_id').annotate(
            total_qty=Sum('quantity'),
            total_value=Sum(F('quantity') * F('purchase_rate')),
        )
        for line in os_lines:
            if line['total_qty'] and line['total_qty'] > 0:
                cost_totals[line['product_id']]['qty'] += Decimal(str(line['total_qty']))
                cost_totals[line['product_id']]['value'] += Decimal(str(line['total_value']))

        avg_rates = {}
        for pid, totals in cost_totals.items():
            if totals['qty'] > 0:
                avg_rates[pid] = totals['value'] / totals['qty']

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


class MSMEComplianceReportView(APIView):
    """
    WP / new — payables aging restricted to MSME suppliers, with interest
    payable per Section 16 of the MSMED Act 2006.

    Section 16 requires the buyer to pay interest at three-times the bank
    rate notified by RBI from the day after the appointed date (≤45 days
    from acceptance) until actual payment. We expose `?bank_rate_pct=X` so
    finance can override the rate annually.
    """

    def get(self, request):
        from parties.models import PartyMetadata

        bank_rate = Decimal(request.query_params.get('bank_rate_pct', '6.5'))
        interest_rate = bank_rate * Decimal('3')  # per s.16 MSMED Act
        as_of = date.fromisoformat(
            request.query_params.get('as_of', date.today().isoformat()))

        # Collect MSME-tagged supplier ids
        msme_suppliers = list(
            PartyMetadata.objects.filter(party_type='Supplier')
            .exclude(msme_category='')
            .values('party_id', 'msme_category', 'msme_udyam_no',
                    'msme_credit_period_days')
        )
        msme_index = {row['party_id']: row for row in msme_suppliers}
        if not msme_index:
            return Response({
                'as_of': str(as_of), 'bank_rate_pct': str(bank_rate),
                'interest_rate_pct': str(interest_rate),
                'rows': [], 'count': 0,
                'note': 'No suppliers tagged with MSME registration. Add via /api/parties/metadata/',
            })

        # Aged payables: outstanding per supplier with the bill's accounting date
        lines = (JournalEntryLine.objects
                 .filter(party_type='Supplier', party_id__in=msme_index.keys(),
                         entry__is_posted=True, entry__date__lte=as_of)
                 .select_related('entry', 'account'))

        # Build per-supplier outstanding bills (by entry, not invoice — JE is the
        # accounting unit available)
        per_supplier = defaultdict(lambda: {'open_bills': [], 'total_outstanding': Decimal('0')})
        for line in lines:
            net = line.credit - line.debit  # payable: credit > debit
            if net == 0:
                continue
            per_supplier[line.party_id]['open_bills'].append({
                'entry_no': line.entry.entry_no,
                'date': line.entry.date.isoformat(),
                'amount': str(net),
                'days_outstanding': (as_of - line.entry.date).days,
            })

        rows = []
        location = get_active_location(request)
        for party_id, info in per_supplier.items():
            net_outstanding = sum(Decimal(b['amount']) for b in info['open_bills'])
            if net_outstanding <= 0:
                continue
            meta = msme_index[party_id]
            credit_days = meta['msme_credit_period_days'] or 45
            # Compute interest on each overdue bill
            interest_total = Decimal('0')
            for bill in info['open_bills']:
                amt = Decimal(bill['amount'])
                overdue_days = max(bill['days_outstanding'] - credit_days, 0)
                if overdue_days > 0 and amt > 0:
                    interest_total += (
                        amt * interest_rate / Decimal('100') * overdue_days /
                        Decimal('365')
                    ).quantize(Decimal('0.01'))
                bill['overdue_days'] = overdue_days
            rows.append({
                'supplier_id': party_id,
                'msme_category': meta['msme_category'],
                'udyam_no': meta['msme_udyam_no'],
                'credit_days': credit_days,
                'net_outstanding': str(net_outstanding),
                'interest_payable_s16': str(interest_total),
                'open_bills': info['open_bills'],
            })

        rows.sort(key=lambda r: -Decimal(r['interest_payable_s16']))
        return Response({
            'as_of': str(as_of),
            'bank_rate_pct': str(bank_rate),
            'interest_rate_pct': str(interest_rate),
            'rows': rows,
            'count': len(rows),
            'total_outstanding': str(sum(Decimal(r['net_outstanding']) for r in rows)),
            'total_interest_payable': str(
                sum(Decimal(r['interest_payable_s16']) for r in rows)
            ),
        })


class FinancialRatiosView(APIView):
    """
    Standard financial ratios for management reporting.

    Computed from posted JE balances over the requested period:

      Profitability:
        - Gross Profit %      = (Revenue - COGS) / Revenue
        - Net Profit %        = Net Profit / Revenue
        - Operating Margin %  = (Revenue - Operating Expense) / Revenue
        - Return on Assets %  = Net Profit / Total Assets

      Liquidity (point-in-time):
        - Current Ratio       = Current Assets / Current Liabilities
        - Quick Ratio         = (Current Assets - Inventory) / Current Liabilities
        - Cash Ratio          = (Cash + Bank) / Current Liabilities

      Activity:
        - Receivable days     = AR / (Revenue / 365)
        - Payable days        = AP / (Purchases / 365)
        - Inventory days      = Inventory / (COGS / 365)
        - Cash conversion     = Receivable days + Inventory days - Payable days

      Leverage:
        - Debt-to-Equity      = Total Liabilities / Total Equity
    """

    def get(self, request):
        start = date.fromisoformat(request.query_params.get('start_date',
                                                            get_fy_dates()[0].isoformat()))
        end = date.fromisoformat(request.query_params.get('end_date',
                                                          get_fy_dates()[1].isoformat()))
        location = get_active_location(request)

        period_lines = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__date__gte=start, entry__date__lte=end,
        )
        as_of_lines = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__date__lte=end,
        )
        if location:
            period_lines = period_lines.filter(entry__location_id=location.id)
            as_of_lines = as_of_lines.filter(entry__location_id=location.id)

        def _net(qs, account_type=None, subtype=None, side='debit'):
            """Net debit (or net credit if side='credit') for the queryset."""
            q = qs
            if account_type:
                q = q.filter(account__account_type=account_type)
            if subtype:
                q = q.filter(account__account_subtype__in=subtype
                             if isinstance(subtype, (list, tuple)) else [subtype])
            agg = q.aggregate(d=Sum('debit'), c=Sum('credit'))
            d = agg['d'] or Decimal('0')
            c = agg['c'] or Decimal('0')
            return (d - c) if side == 'debit' else (c - d)

        # Period figures
        revenue = _net(period_lines, account_type='REVENUE', side='credit')
        purchases = _net(period_lines, subtype='Purchases', side='debit')
        operating_expense = _net(period_lines, account_type='EXPENSE', side='debit')
        gross_profit = revenue - purchases
        net_profit = revenue - operating_expense

        # Point-in-time figures (as of end_date)
        cash = _net(as_of_lines, subtype=('Cash', 'Bank'))
        ar = _net(as_of_lines, subtype='Receivable')
        ap = _net(as_of_lines, subtype='Payable', side='credit')
        inventory = _net(as_of_lines, subtype='Cash')  # Closing Stock uses 'Cash' subtype in seed
        # Total assets: ASSET account_type net debit
        total_assets = _net(as_of_lines, account_type='ASSET')
        total_liab = _net(as_of_lines, account_type='LIABILITY', side='credit')
        total_equity = _net(as_of_lines, account_type='EQUITY', side='credit')

        # Approximation: current assets ≈ Cash+Bank+Receivables+Closing Stock
        # current liabilities ≈ Trade Payables + GST/TDS payables
        current_assets = cash + ar
        current_liabilities = ap + _net(
            as_of_lines, subtype=('Output_GST', 'TDS_Payable'), side='credit')

        def _safe(num, denom, *, scale=Decimal('1')):
            if not denom or denom == 0:
                return None
            return float((num / denom * scale).quantize(Decimal('0.01')))

        days = Decimal((end - start).days or 1)

        return Response({
            'start_date': str(start), 'end_date': str(end),
            'period_days': int(days),
            'profitability': {
                'gross_profit_pct': _safe(gross_profit, revenue, scale=Decimal('100')),
                'net_profit_pct': _safe(net_profit, revenue, scale=Decimal('100')),
                'operating_margin_pct': _safe(net_profit, revenue, scale=Decimal('100')),
                'return_on_assets_pct': _safe(net_profit, total_assets, scale=Decimal('100')),
            },
            'liquidity': {
                'current_ratio': _safe(current_assets, current_liabilities),
                'quick_ratio': _safe(current_assets - inventory, current_liabilities),
                'cash_ratio': _safe(cash, current_liabilities),
            },
            'activity_days': {
                'receivable_days': (
                    _safe(ar * days, revenue) if revenue else None),
                'payable_days': (
                    _safe(ap * days, purchases) if purchases else None),
                'inventory_days': (
                    _safe(inventory * days, purchases) if purchases else None),
            },
            'leverage': {
                'debt_to_equity': _safe(total_liab, total_equity),
            },
            'figures': {
                'revenue': str(revenue), 'purchases': str(purchases),
                'gross_profit': str(gross_profit), 'net_profit': str(net_profit),
                'cash': str(cash), 'ar': str(ar), 'ap': str(ap),
                'inventory': str(inventory),
                'total_assets': str(total_assets),
                'total_liabilities': str(total_liab),
                'total_equity': str(total_equity),
            },
        })


class BankReconciliationSummaryView(APIView):
    """
    Combined view for bank reconciliation:
      • Book balance (per GL)
      • Statement balance (running total of imported transactions)
      • Un-cleared cheques issued (we wrote them — bank hasn't paid yet)
      • Un-cleared cheques received (deposited but not credited)
      • Un-matched bank transactions (in statement but not booked)
      • Bounced cheques pending action
      • Reconciled net = Book + uncleared issues - uncleared receipts ± delta
    """

    def get(self, request):
        from banking.models import BankAccount, BankTransaction, Cheque
        from banking.services import book_balance, statement_balance

        as_of = date.fromisoformat(
            request.query_params.get('as_of', date.today().isoformat()))
        bank_account_id = request.query_params.get('bank_account_id')

        accounts = BankAccount.objects.all()
        if bank_account_id:
            accounts = accounts.filter(id=int(bank_account_id))

        rows = []
        for acct in accounts:
            book_bal = book_balance(acct)
            stmt_bal = statement_balance(acct)

            # Un-cleared issued = pending cheques drawn on this account
            uncleared_issued = Cheque.objects.filter(
                bank_account=acct, kind='issued', status='pending',
            ).aggregate(s=Sum('amount'))['s'] or Decimal('0')

            uncleared_received = Cheque.objects.filter(
                bank_account=acct, kind='received', status='pending',
            ).aggregate(s=Sum('amount'))['s'] or Decimal('0')

            unmatched_txns = BankTransaction.objects.filter(
                bank_account=acct, status='unmatched', date__lte=as_of,
            ).aggregate(s=Sum('amount'))['s'] or Decimal('0')

            bounced = Cheque.objects.filter(
                bank_account=acct, status='bounced',
            ).count()

            # Classic reconciliation:
            # Reconciled balance = book balance + uncleared issued - uncleared received
            # Should equal statement balance (within unmatched-txns delta)
            recon_book = book_bal + uncleared_issued - uncleared_received
            delta = stmt_bal - recon_book

            rows.append({
                'bank_account_id': acct.id,
                'bank_account_name': acct.name,
                'book_balance': str(book_bal),
                'statement_balance': str(stmt_bal),
                'uncleared_cheques_issued': str(uncleared_issued),
                'uncleared_cheques_received': str(uncleared_received),
                'unmatched_bank_txns': str(unmatched_txns),
                'bounced_cheques_count': bounced,
                'reconciled_balance': str(recon_book),
                'unexplained_delta': str(delta),
                'is_clean': abs(delta) < Decimal('0.01') and unmatched_txns == 0,
            })

        return Response({
            'as_of': str(as_of),
            'rows': rows,
            'total_unmatched_txns': str(sum(
                Decimal(r['unmatched_bank_txns']) for r in rows
            )),
            'total_unexplained_delta': str(sum(
                Decimal(r['unexplained_delta']) for r in rows
            )),
        })


class ClosingStockReconciliationView(APIView):
    """
    Compare Closing Stock per BOOKS (general-ledger balance on account 1190)
    against Closing Stock per INVENTORY (StockValuationView's running total
    across StockMovementRO × per-product cost).

    A non-zero variance means either:
      • The period-end closing-stock JV hasn't been posted yet, OR
      • Stock has shrunk / expired without an inventory adjustment, OR
      • Inventory cost data is out of date.

    Use the difference figure as the input to the next closing-stock JV.
    """

    def get(self, request):
        as_of = date.fromisoformat(
            request.query_params.get('as_of', date.today().isoformat()))
        location = get_active_location(request)

        # 1. Books-side: Closing Stock GL balance up to as_of
        from core.models import AccountMapping
        try:
            cs_acct = AccountMapping.get_account('CLOSING_STOCK')
        except ValueError:
            return Response(
                {'detail': 'CLOSING_STOCK account mapping is not configured.'},
                status=400,
            )
        bq = JournalEntryLine.objects.filter(
            account=cs_acct, entry__is_posted=True, entry__date__lte=as_of,
        )
        if location:
            bq = bq.filter(entry__location_id=location.id)
        agg = bq.aggregate(d=Sum('debit'), c=Sum('credit'))
        books_balance = (agg['d'] or Decimal('0')) - (agg['c'] or Decimal('0'))

        # 2. Inventory-side: replay movements to get qty-on-hand × weighted-
        # avg purchase rate. StockMovementRO.quantity is signed, so summing
        # gives qty on hand directly. Cost = weighted avg across PO lines +
        # opening-stock lines (the same calc StockValuationView uses).
        from inventory_reader.models import (
            PurchaseOrderLineRO, StockMovementRO, OpeningStockLineRO,
        )
        moves = StockMovementRO.objects.filter(created_at__date__lte=as_of)
        if location:
            moves = moves.filter(location_id=location.id)
        from collections import defaultdict
        qty_on_hand = defaultdict(int)
        for m in moves:
            qty_on_hand[m.product_id] += m.quantity

        cost_totals = defaultdict(lambda: {'qty': Decimal('0'), 'value': Decimal('0')})
        for line in PurchaseOrderLineRO.objects.filter(
            purchase_order__state__in=['confirmed', 'done', 'approved']
        ).values('product_id').annotate(
            total_qty=Sum('quantity'),
            total_value=Sum(F('quantity') * F('purchase_rate')),
        ):
            if line['total_qty'] and line['total_qty'] > 0:
                cost_totals[line['product_id']]['qty'] += Decimal(str(line['total_qty']))
                cost_totals[line['product_id']]['value'] += Decimal(str(line['total_value']))
        for line in OpeningStockLineRO.objects.values('product_id').annotate(
            total_qty=Sum('quantity'),
            total_value=Sum(F('quantity') * F('purchase_rate')),
        ):
            if line['total_qty'] and line['total_qty'] > 0:
                cost_totals[line['product_id']]['qty'] += Decimal(str(line['total_qty']))
                cost_totals[line['product_id']]['value'] += Decimal(str(line['total_value']))
        avg_rate = {
            pid: t['value'] / t['qty']
            for pid, t in cost_totals.items() if t['qty'] > 0
        }

        inventory_value = sum(
            (Decimal(str(qty_on_hand.get(pid, 0))) * avg_rate.get(pid, Decimal('0')))
            for pid in qty_on_hand if qty_on_hand[pid] > 0
        ) or Decimal('0')

        variance = inventory_value - books_balance
        return Response({
            'as_of': str(as_of),
            'books_closing_stock': str(books_balance),
            'inventory_value': str(inventory_value),
            'variance': str(variance),
            'recommended_jv_value': str(inventory_value),
            'note': (
                'Run sync to post any pending opening-stock / purchase JVs '
                'that bring 1190 Closing Stock in line with live inventory.'
                if abs(variance) > Decimal('0.01') else 'No adjustment needed.'
            ),
        })


class AgedStockReportView(APIView):
    """Slow-moving / aged stock — current qty + days since last sale per product+location."""

    def get(self, request):
        from inventory_reader.models import StockMovementRO
        location = get_active_location(request)
        as_of = date.fromisoformat(
            request.query_params.get('as_of', date.today().isoformat()))
        slow_days = int(request.query_params.get('slow_days', 90))

        moves = StockMovementRO.objects.filter(created_at__date__lte=as_of)
        if location:
            moves = moves.filter(location_id=location.id)
        moves = moves.select_related('product', 'location')

        per_product = {}
        for m in moves:
            key = (m.product_id, m.location_id)
            row = per_product.setdefault(key, {
                'product_id': m.product_id,
                'product_name': m.product.name if m.product else f'#{m.product_id}',
                'location_id': m.location_id,
                'qty_in': 0, 'qty_out': 0, 'last_out_date': None,
            })
            # StockMovementRO.quantity is signed — positive rows are inflows,
            # negative are outflows. Bucket by sign rather than by
            # movement_type strings (which no longer match upstream).
            qty = abs(m.quantity)
            if m.quantity < 0:
                row['qty_out'] += qty
                if not row['last_out_date'] or m.created_at.date() > row['last_out_date']:
                    row['last_out_date'] = m.created_at.date()
            else:
                row['qty_in'] += qty

        rows = []
        for row in per_product.values():
            stock_on_hand = row['qty_in'] - row['qty_out']
            if stock_on_hand <= 0:
                continue
            days_since_last_sale = (
                (as_of - row['last_out_date']).days if row['last_out_date'] else None
            )
            is_slow = (days_since_last_sale is None or
                       days_since_last_sale >= slow_days)
            if not is_slow:
                continue
            rows.append({
                **row, 'stock_on_hand': stock_on_hand,
                'days_since_last_sale': days_since_last_sale,
                'last_out_date': str(row['last_out_date']) if row['last_out_date'] else None,
            })
        rows.sort(key=lambda r: -(r['days_since_last_sale'] or 99999))
        return Response({
            'as_of': str(as_of), 'slow_days_threshold': slow_days,
            'rows': rows, 'count': len(rows),
        })


class DepartmentalPLView(APIView):
    """P&L pivoted by JournalEntry.cost_center."""

    def get(self, request):
        start = date.fromisoformat(request.query_params.get('start_date',
                                                            get_fy_dates()[0].isoformat()))
        end = date.fromisoformat(request.query_params.get('end_date',
                                                          get_fy_dates()[1].isoformat()))
        location = get_active_location(request)

        lines = (JournalEntryLine.objects
                 .filter(entry__is_posted=True,
                         entry__date__gte=start, entry__date__lte=end,
                         account__account_type__in=('REVENUE', 'EXPENSE'))
                 .select_related('entry', 'account'))
        if location:
            lines = lines.filter(entry__location_id=location.id)

        rows_by_acct = defaultdict(lambda: defaultdict(Decimal))
        cost_centers = set()
        meta = {}

        for line in lines:
            cc = line.entry.cost_center or 'UNASSIGNED'
            cost_centers.add(cc)
            net = (line.credit - line.debit
                   if line.account.account_type == 'REVENUE'
                   else line.debit - line.credit)
            rows_by_acct[line.account.account_code][cc] += net
            meta[line.account.account_code] = {
                'name': line.account.account_name,
                'type': line.account.account_type,
            }

        cc_sorted = sorted(cost_centers)
        out_rows = []
        for code, by_cc in sorted(rows_by_acct.items()):
            out_rows.append({
                'account_code': code,
                'account_name': meta[code]['name'],
                'account_type': meta[code]['type'],
                'columns': {cc: str(by_cc.get(cc, Decimal('0'))) for cc in cc_sorted},
                'total': str(sum(by_cc.values(), Decimal('0'))),
            })

        # Net profit per cost center
        np_by_cc = {cc: Decimal('0') for cc in cc_sorted}
        for r in out_rows:
            for cc in cc_sorted:
                v = Decimal(r['columns'][cc])
                if r['account_type'] == 'REVENUE':
                    np_by_cc[cc] += v
                else:
                    np_by_cc[cc] -= v
        return Response({
            'start_date': str(start), 'end_date': str(end),
            'cost_centers': cc_sorted, 'rows': out_rows,
            'net_profit_by_cost_center': {cc: str(v) for cc, v in np_by_cc.items()},
        })


class CashFlowStatementView(APIView):
    """
    Cash Flow Statement — indirect method, computed from posted JEs in the
    given period. Conforms to AS-3 / Ind AS-7 categories: Operating,
    Investing, Financing.

    Heuristic: every account is bucketed by its account_type + account_subtype.
    Net change in each bucket between opening and closing of the period is the
    cash-flow line item. Final reconciliation: net change in cash & bank ledger
    must equal sum of all three sections.
    """

    OPERATING_TYPES = ('REVENUE', 'EXPENSE')
    OPERATING_WC_SUBTYPES = ('Receivable', 'Payable', 'Output_GST', 'Input_GST',
                             'TDS_Receivable', 'TDS_Payable')
    INVESTING_KEYWORDS = ('asset', 'investment', 'fixed asset')
    FINANCING_KEYWORDS = ('loan', 'borrowing', 'capital', 'reserves',
                          'retained earnings', 'share')

    def get(self, request):
        start = date.fromisoformat(request.query_params.get('start_date',
                                                            get_fy_dates()[0].isoformat()))
        end = date.fromisoformat(request.query_params.get('end_date',
                                                          get_fy_dates()[1].isoformat()))
        location = get_active_location(request)

        all_lines = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__date__gte=start, entry__date__lte=end,
        ).select_related('entry', 'account')
        if location:
            all_lines = all_lines.filter(entry__location_id=location.id)

        # 1. Net profit for the period
        revenue = sum(
            (l.credit - l.debit for l in all_lines if l.account.account_type == 'REVENUE'),
            Decimal('0'),
        )
        expenses = sum(
            (l.debit - l.credit for l in all_lines if l.account.account_type == 'EXPENSE'),
            Decimal('0'),
        )
        net_profit = revenue - expenses

        # 2. Non-cash addbacks: depreciation expense (subtype 'Other_Expense'
        # carrying name 'Depreciation' — heuristic) + bad debts + other non-cash
        non_cash = Decimal('0')
        for l in all_lines:
            name = (l.account.account_name or '').lower()
            if any(k in name for k in ('depreciation', 'amortization', 'bad debt')):
                non_cash += (l.debit - l.credit)

        # 3. Working capital changes — increase in asset uses cash; increase in liability provides cash
        wc_change = Decimal('0')
        wc_breakdown = {}
        for sub in self.OPERATING_WC_SUBTYPES:
            net = sum(
                (l.debit - l.credit for l in all_lines if l.account.account_subtype == sub),
                Decimal('0'),
            )
            wc_breakdown[sub] = str(net)
            # For Asset subtypes, increase in balance (positive net) = use of cash
            if sub in ('Receivable', 'Input_GST', 'TDS_Receivable'):
                wc_change -= net
            else:
                wc_change += net

        operating_cf = net_profit + non_cash + wc_change

        # 4. Investing — fixed asset purchases (cash out) and disposals (cash in)
        investing_cf = Decimal('0')
        for l in all_lines:
            name = (l.account.account_name or '').lower()
            if any(k in name for k in self.INVESTING_KEYWORDS):
                # Asset bought (Dr) = outflow, sold (Cr) = inflow
                investing_cf -= (l.debit - l.credit)

        # 5. Financing — loans + capital
        financing_cf = Decimal('0')
        for l in all_lines:
            name = (l.account.account_name or '').lower()
            if any(k in name for k in self.FINANCING_KEYWORDS):
                # Liability/equity increase (Cr) = inflow
                financing_cf += (l.credit - l.debit)

        # 6. Net change in cash
        cash_subtypes = ('Cash', 'Bank')
        opening_cash = sum(
            (
                Decimal(str((line.debit - line.credit)))
                for line in JournalEntryLine.objects.filter(
                    account__account_subtype__in=cash_subtypes,
                    entry__is_posted=True, entry__date__lt=start,
                )
            ), Decimal('0'),
        )
        closing_cash = opening_cash + sum(
            (Decimal(str((l.debit - l.credit))) for l in all_lines
             if l.account.account_subtype in cash_subtypes),
            Decimal('0'),
        )

        return Response({
            'start_date': str(start), 'end_date': str(end),
            'operating': {
                'net_profit': str(net_profit),
                'non_cash_addbacks': str(non_cash),
                'working_capital_change': str(wc_change),
                'wc_breakdown': wc_breakdown,
                'subtotal': str(operating_cf),
            },
            'investing': {'subtotal': str(investing_cf)},
            'financing': {'subtotal': str(financing_cf)},
            'net_change_in_cash': str(operating_cf + investing_cf + financing_cf),
            'opening_cash': str(opening_cash),
            'closing_cash': str(closing_cash),
            'reconciliation_diff': str(
                (closing_cash - opening_cash) -
                (operating_cf + investing_cf + financing_cf)
            ),
        })

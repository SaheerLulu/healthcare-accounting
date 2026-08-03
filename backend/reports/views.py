import csv
from collections import defaultdict
from decimal import Decimal
from datetime import date, timedelta
from django.http import HttpResponse
from django.db.models import Sum, Q, F

from core.sorting import ci_key
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from journals.models import JournalEntry, JournalEntryLine
from core.models import ChartOfAccount
from core.mixins import require_location_or_all_access


def resolve_ledger_account(request):
    """Resolve the ChartOfAccount a ledger view is asking for by ?account_code=.

    Prefers the row scoped to the active location, falling back to the shared
    (NULL-location) template — so it stays unambiguous under per-location clones
    and per-party leaves (whose codes like "2105-S5" are globally unique anyway).
    Returns (account, error_response): exactly one is non-None.
    """
    account_code = request.query_params.get('account_code')
    if not account_code:
        return None, Response({'error': 'account_code is required'}, status=400)

    location = require_location_or_all_access(request)
    qs = ChartOfAccount.objects.filter(account_code=account_code)
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
        location = require_location_or_all_access(request)

        if not start_date or not end_date:
            fy_start, fy_end = get_fy_dates()
            start_date = fy_start.isoformat()
            end_date = fy_end.isoformat()

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False,
            entry__date__range=[start_date, end_date]
        )
        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        accounts = ChartOfAccount.objects.filter(is_leaf=True).order_by('account_code')
        rows = []
        total_debit = Decimal('0.00')
        total_credit = Decimal('0.00')

        # One grouped query instead of one aggregate per account (N+1).
        sums_by_account = {
            r['account_id']: r
            for r in lines_qs.values('account_id').annotate(
                total_debit=Sum('debit'), total_credit=Sum('credit'),
            )
        }

        for account in accounts:
            agg = sums_by_account.get(account.id, {})
            dr = agg.get('total_debit') or Decimal('0.00')
            cr = agg.get('total_credit') or Decimal('0.00')
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
        location = require_location_or_all_access(request)

        if not start_date or not end_date:
            fy_start, fy_end = get_fy_dates()
            start_date = fy_start.isoformat()
            end_date = fy_end.isoformat()

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False,
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

        # One grouped query instead of one aggregate per account (N+1).
        sums_by_account = {
            r['account_id']: r
            for r in lines_qs.values('account_id').annotate(
                dr=Sum('debit'), cr=Sum('credit'),
            )
        }

        revenue_items = []
        total_revenue = Decimal('0.00')
        for acc in ChartOfAccount.objects.filter(
            account_type='REVENUE', is_leaf=True
        ).order_by('account_code'):
            agg = sums_by_account.get(acc.id, {})
            amount = (agg.get('cr') or Decimal('0')) - (agg.get('dr') or Decimal('0'))
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
            agg = sums_by_account.get(acc.id, {})
            amount = (agg.get('dr') or Decimal('0')) - (agg.get('cr') or Decimal('0'))
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
        location = require_location_or_all_access(request)

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False,
            entry__date__lte=as_of_date
        ).exclude(entry__reference_type='OpeningCarryForward')
        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        # The year-end opening carry-forward JV restates Asset/Liability/Equity
        # balances the continuous ledger already carries to this date; counting
        # both would double every balance. It is excluded above. (Windowed
        # reports like the Trial Balance keep it as their brought-forward
        # opening, so it is filtered here, not at the source.)
        # One grouped query instead of one aggregate per account (N+1).
        sums_by_account = {
            r['account_id']: r
            for r in lines_qs.values('account_id').annotate(
                dr=Sum('debit'), cr=Sum('credit'),
            )
        }

        def get_section_balances(account_type):
            accounts = ChartOfAccount.objects.filter(
                account_type=account_type, is_leaf=True
            )
            items = []
            total = Decimal('0.00')
            for acc in accounts:
                agg = sums_by_account.get(acc.id, {})
                dr = agg.get('dr') or Decimal('0.00')
                cr = agg.get('cr') or Decimal('0.00')
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


# The 9 columns the ledger/book row shape needs — fetched with .values() so
# big accounts never materialise full JournalEntryLine + JournalEntry
# instances. Shared by LedgerView, LedgerExportView and _build_book_response.
_LEDGER_ROW_FIELDS = (
    'debit', 'credit', 'narration',
    'entry__date', 'entry__entry_no', 'entry__narration',
    'entry__voucher_type', 'entry__reference_type', 'entry__reference_id',
)


def _ledger_row(line, running_balance):
    """Map a values() row onto the (unchanged) ledger JSON field names."""
    return {
        'date': line['entry__date'],
        'entry_no': line['entry__entry_no'],
        'narration': line['entry__narration'] or line['narration'],
        'voucher_type': line['entry__voucher_type'],
        'reference_type': line['entry__reference_type'] or '',
        'reference_id': line['entry__reference_id'],
        'debit': str(line['debit']),
        'credit': str(line['credit']),
        'balance': str(running_balance),
    }


class LedgerView(APIView):
    def get(self, request):
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        location = require_location_or_all_access(request)
        page = request.query_params.get('page')

        account, error = resolve_ledger_account(request)
        if error is not None:
            return error

        base_qs = JournalEntryLine.objects.filter(
            account=account,
            entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False
        )

        if location:
            base_qs = base_qs.filter(entry__location_id=location.id)

        # Opening balance = net of all entries BEFORE start_date, whenever a
        # start_date is given — not only on the paginated path. The drill-down
        # calls this without a page param, so the brought-forward balance used to
        # be forced to 0, understating every running balance and the closing
        # balance, and disagreeing with the CSV/XLSX/PDF export.
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

        # Only the 9 output columns — a big account no longer materialises
        # full line+entry instances. Keys are mapped 1:1 onto the existing
        # response field names below.
        lines_values = lines_qs.values(*_LEDGER_ROW_FIELDS)

        if page:
            # Paginated response
            paginator = LedgerPagination()
            paginated = paginator.paginate_queryset(lines_values, request)

            running_balance = opening_balance
            # Balance up to the start of this page: one aggregate over the
            # pre-page slice instead of iterating every earlier row.
            if paginator.page.number > 1:
                page_size = paginator.get_page_size(request)
                skip = (paginator.page.number - 1) * page_size
                pre = lines_qs[:skip].aggregate(dr=Sum('debit'), cr=Sum('credit'))
                running_balance += (pre['dr'] or Decimal('0.00')) - (pre['cr'] or Decimal('0.00'))

            transactions = []
            for line in paginated:
                running_balance += line['debit'] - line['credit']
                transactions.append(_ledger_row(line, running_balance))

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
        for line in lines_values.iterator():
            running_balance += line['debit'] - line['credit']
            transactions.append(_ledger_row(line, running_balance))

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
        location = require_location_or_all_access(request)

        account, error = resolve_ledger_account(request)
        if error is not None:
            return error

        base_qs = JournalEntryLine.objects.filter(
            account=account, entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False,
        )
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
        # Same .values() column set as LedgerView — no full instances.
        for line in lines_qs.values(*_LEDGER_ROW_FIELDS).iterator():
            running += line['debit'] - line['credit']
            ref = line['entry__reference_type'] or ''
            if ref and line['entry__reference_id']:
                ref = f"{ref}#{line['entry__reference_id']}"
            rows.append({
                'date': line['entry__date'].isoformat(),
                'entry_no': line['entry__entry_no'],
                'narration': line['entry__narration'] or line['narration'],
                'voucher_type': line['entry__voucher_type'],
                'source': ref,
                'debit': str(line['debit']),
                'credit': str(line['credit']),
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
            ws.append(['Date', 'Entry No', 'Narration', 'Voucher', 'Source Doc', 'Debit', 'Credit', 'Balance'])
            for r in rows:
                ws.append([r['date'], r['entry_no'], r['narration'], r['voucher_type'],
                           r['source'], r['debit'], r['credit'], r['balance']])
            ws.append([])
            ws.append(['', '', '', 'Closing', '', '', '', str(running)])
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
            data = [['Date', 'Entry', 'Narration', 'Voucher', 'Source', 'Debit', 'Credit', 'Balance']]
            for r in rows:
                data.append([r['date'], r['entry_no'], r['narration'][:60],
                             r['voucher_type'], r['source'], r['debit'], r['credit'], r['balance']])
            data.append(['', '', '', '', 'Closing', '', '', str(running)])
            tbl = Table(data, repeatRows=1)
            tbl.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e5e7eb')),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
                ('GRID', (0, 0), (-1, -1), 0.25, colors.grey),
                ('ALIGN', (5, 1), (7, -1), 'RIGHT'),
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
        w.writerow(['Date', 'Entry No', 'Narration', 'Voucher', 'Source Doc', 'Debit', 'Credit', 'Balance'])
        for r in rows:
            w.writerow([r['date'], r['entry_no'], r['narration'], r['voucher_type'],
                        r['source'], r['debit'], r['credit'], r['balance']])
        w.writerow([])
        w.writerow(['', '', '', '', 'Closing', '', '', str(running)])
        return response


def _age_open_invoices(invoices, payments, as_of):
    """FIFO-apply `payments` to the oldest invoices and bucket only the REMAINING
    open amount of each invoice by its age. `invoices` = iterable of (date, amount).

    Aging buckets must net partial payments, otherwise they sum to the gross
    invoiced amount while total-outstanding is net — overstating what's overdue
    by the amount already settled.
    """
    buckets = {'0_30': Decimal('0'), '31_60': Decimal('0'),
               '61_90': Decimal('0'), '90_plus': Decimal('0')}
    remaining = payments
    for inv_date, amount in sorted(invoices, key=lambda x: x[0]):
        if remaining >= amount:
            remaining -= amount
            continue
        open_amount = amount - remaining
        remaining = Decimal('0')
        days = (as_of - inv_date).days
        key = ('0_30' if days <= 30 else '31_60' if days <= 60
               else '61_90' if days <= 90 else '90_plus')
        buckets[key] += open_amount
    return buckets


def _party_tax_details(party_type, party_ids):
    """Bulk-resolve display name + tax-filing identifiers for a set of parties:
    {party_id: {name, gstin, state, pan, msme_category, msme_udyam_no}}.

    Name/GSTIN/state come from the inventory master (CustomerRO/SupplierRO);
    PAN and MSME registration from parties.PartyMetadata. All fields default
    to '' so report rows are safe to render/export without null checks — and
    so callers stop doing a per-party .get() just for the name.
    """
    from inventory_reader.models import CustomerRO, SupplierRO
    from parties.models import PartyMetadata

    details = {pid: {'name': '', 'gstin': '', 'state': '', 'pan': '',
                     'msme_category': '', 'msme_udyam_no': ''}
               for pid in party_ids}
    if not party_ids:
        return details

    if party_type == 'Customer':
        model, name_field = CustomerRO, 'customer_name'
    else:
        model, name_field = SupplierRO, 'company_name'
    for row in model.objects.filter(id__in=list(party_ids)).values(
            'id', 'gst_no', 'state', name_field):
        details[row['id']]['name'] = row[name_field] or ''
        details[row['id']]['gstin'] = row['gst_no'] or ''
        details[row['id']]['state'] = row['state'] or ''

    for meta in PartyMetadata.objects.filter(
            party_type=party_type, party_id__in=list(party_ids)):
        d = details.get(meta.party_id)
        if d is None:
            continue
        d['pan'] = meta.pan or ''
        d['msme_category'] = meta.msme_category or ''
        d['msme_udyam_no'] = meta.msme_udyam_no or ''
    return details


class ReceivablesAgingView(APIView):
    def get(self, request):
        as_of_date = request.query_params.get('date', date.today().isoformat())
        location = require_location_or_all_access(request)

        as_of = date.fromisoformat(as_of_date)

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False,
            entry__date__lte=as_of_date,
            party_type='Customer',
            account__account_subtype='Receivable'
        )

        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        customer_balances = defaultdict(Decimal)
        customer_dates = defaultdict(list)

        # Only the 4 needed columns — not full line+entry instances.
        for line in lines_qs.values('party_id', 'debit', 'credit', 'entry__date'):
            net = line['debit'] - line['credit']
            if net != 0:
                customer_balances[line['party_id']] += net
                if line['debit'] > 0:
                    customer_dates[line['party_id']].append(
                        (line['entry__date'], line['debit']))

        tax_details = _party_tax_details('Customer', set(customer_balances.keys()))

        rows = []
        for customer_id, balance in customer_balances.items():
            if balance <= 0:
                continue
            d = tax_details.get(customer_id, {})
            name = d.get('name') or f'Customer #{customer_id}'

            invoices = customer_dates.get(customer_id, [])
            payments = sum((amt for _, amt in invoices), Decimal('0')) - balance
            aging = _age_open_invoices(invoices, payments, as_of)

            rows.append({
                'customer_id': customer_id,
                'customer_name': name,
                'gstin': d.get('gstin', ''),
                'pan': d.get('pan', ''),
                'state': d.get('state', ''),
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


def _bills_app_ledger_keys(location):
    """JE ids and line ids that belong to the bills app rather than to the
    GL-only ledger.

    A bills.Bill posts its own party-tagged Payable credit, so without this the
    same debt is listed both here and in the Payables page's Vendor Bills tab —
    and that page adds the two tabs together.
    """
    from bills.models import Bill, BillPayment
    from journals.models import BillReference

    bills = Bill.objects.filter(journal_entry__isnull=False)
    payments = BillPayment.objects.filter(journal_entry__isnull=False)
    if location:
        bills = bills.filter(journal_entry__location_id=location.id)
        payments = payments.filter(journal_entry__location_id=location.id)

    entry_ids = set(bills.values_list('journal_entry_id', flat=True))
    entry_ids |= set(payments.values_list('journal_entry_id', flat=True))

    # A voucher payment allocated to a bills-app bill settles that bill, not a
    # GL invoice. Its ref_no is the bill_no, so it never matches an entry_no
    # below — leaving it in would make it look like on-account money.
    line_ids = set(BillReference.objects.filter(
        kind='AGAINST', bill_id__isnull=False,
    ).values_list('line_id', flat=True))
    return entry_ids, line_ids


def _open_party_invoices(request, *, party_type):
    """Per-invoice open-balance rows for a party type, with bill-wise netting.

    An "invoice" is one posted JE line that CREATES the obligation — for a
    customer the Debit on Receivable, for a supplier the Credit on Payable.

    An invoice is reduced by two things:

      1. Bill-wise AGAINST allocations (journals.BillReference) that name its
         entry_no, scoped to the SAME party-type + subtype + location (so a
         receipt against a customer invoice never nets a supplier invoice, and
         a Store-A allocation never touches a Store-B invoice — see
         [[party-ledger-per-party]]).
      2. Whatever else has come off that party's ledger without naming an
         invoice — a plain part-payment, a debit note, TDS — applied
         oldest-first. This is the common case, not the exception: none of the
         four payment paths in the app writes an allocation, so before this
         existed a part-paid invoice sat at its gross amount for ever.

    FIFO matches how _age_open_invoices buckets the same money, so this report
    and the aging report agree on what is still open.

    These live as JEs (synced PurchaseOrder / SALE), not the bills app — that's
    why getBills shows nothing for synced suppliers. Tag-based, NOT code-based.
    """
    from journals.models import BillReference
    as_of_date = request.query_params.get('date', date.today().isoformat())
    search = request.query_params.get('search', '').strip().lower()
    party_id_param = request.query_params.get('party_id')
    location = require_location_or_all_access(request)
    is_supplier = party_type == 'Supplier'
    subtype = 'Payable' if is_supplier else 'Receivable'
    net_key = 'supplier_outstanding' if is_supplier else 'customer_outstanding'
    ZERO = Decimal('0')

    base = JournalEntryLine.objects.filter(
        entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False, entry__date__lte=as_of_date,
        party_type=party_type, account__account_subtype=subtype,
    )
    if location:
        base = base.filter(entry__location_id=location.id)
    if party_id_param:
        try:
            base = base.filter(party_id=int(party_id_param))
        except (TypeError, ValueError):
            pass

    # Excluded before the split below, so an obligation and its settlements
    # drop out together and the oldest-first pool stays balanced.
    if is_supplier:
        bill_entry_ids, bill_line_ids = _bills_app_ledger_keys(location)
        if bill_entry_ids:
            base = base.exclude(entry_id__in=bill_entry_ids)
        if bill_line_ids:
            base = base.exclude(id__in=bill_line_ids)

    invoice_lines = base.filter(credit__gt=0) if is_supplier else base.filter(debit__gt=0)
    invoice_lines = list(invoice_lines.select_related('entry').order_by('entry__date', 'entry__id'))

    # One pass for both per-party totals: what was invoiced, and what has since
    # come off it by any means. Their difference gates fully-settled parties out.
    invoiced = defaultdict(lambda: Decimal('0'))
    settled = defaultdict(lambda: Decimal('0'))
    for l in base.values('party_id', 'debit', 'credit'):
        pid = l['party_id']
        if is_supplier:
            invoiced[pid] += l['credit']
            settled[pid] += l['debit']
        else:
            invoiced[pid] += l['debit']
            settled[pid] += l['credit']

    # Prior AGAINST allocations per invoice (one query), scoped to party+subtype+location.
    entry_nos = [l.entry.entry_no for l in invoice_lines]
    allocated = defaultdict(lambda: Decimal('0'))
    if entry_nos:
        ref_qs = BillReference.objects.filter(
            kind='AGAINST', ref_no__in=entry_nos,
            line__party_type=party_type,
            line__account__account_subtype=subtype,
        )
        if location:
            ref_qs = ref_qs.filter(line__entry__location_id=location.id)
        for r in ref_qs.values('ref_no').annotate(s=Sum('amount')):
            allocated[r['ref_no']] = r['s'] or Decimal('0')

    # Settlement that named its invoice is already accounted for above; the
    # remainder is on-account and gets applied oldest-first in the row loop.
    explicit = defaultdict(lambda: Decimal('0'))
    for l in invoice_lines:
        explicit[l.party_id] += allocated.get(l.entry.entry_no, ZERO)
    pool = {pid: max(amount - explicit.get(pid, ZERO), ZERO)
            for pid, amount in settled.items()}

    if is_supplier:
        from inventory_reader.models import SupplierRO as RO
        name_field = 'company_name'
    else:
        from inventory_reader.models import CustomerRO as RO
        name_field = 'customer_name'
    names = {}
    try:
        for obj in RO.objects.filter(id__in={l.party_id for l in invoice_lines}):
            names[obj.id] = getattr(obj, name_field)
    except Exception:
        pass

    rows = []
    cents = Decimal('0.01')
    for l in invoice_lines:
        pid = l.party_id
        net = invoiced.get(pid, ZERO) - settled.get(pid, ZERO)
        if net <= 0:
            continue
        original = (l.credit if is_supplier else l.debit).quantize(cents)
        outstanding = (original - allocated.get(l.entry.entry_no, ZERO)).quantize(cents)
        # Draw down the party's on-account settlement, oldest invoice first.
        available = pool.get(pid, ZERO)
        if outstanding > 0 and available > 0:
            applied = min(available, outstanding)
            outstanding = (outstanding - applied).quantize(cents)
            pool[pid] = available - applied
        if outstanding <= 0:
            continue
        paid = (original - outstanding).quantize(cents)
        name = names.get(pid, f'{party_type} #{pid}')
        if search and search not in name.lower() \
                and search not in (l.entry.entry_no or '').lower():
            continue
        rows.append({
            'invoice_no': l.entry.entry_no,
            'voucher_type': l.entry.voucher_type,
            'date': l.entry.date.isoformat(),
            'party_id': pid,
            'party_name': name,
            'amount': str(original),
            'paid_amount': str(paid),
            'outstanding_amount': str(outstanding),
            'narration': l.entry.narration or '',
            net_key: str(net.quantize(cents)),
        })

    return Response({
        'as_of_date': as_of_date,
        'rows': rows,
        'total_invoices': len(rows),
        'total_outstanding': str(sum((Decimal(r['outstanding_amount']) for r in rows), Decimal('0'))),
    })


class OpenCustomerInvoicesView(APIView):
    """Per-invoice open receivables for customers (one row per SALE JE line),
    with bill-wise remaining balance. See _open_party_invoices."""
    def get(self, request):
        return _open_party_invoices(request, party_type='Customer')


class OpenSupplierInvoicesView(APIView):
    """Per-invoice open payables for suppliers — synced PurchaseOrder JEs (the
    bills app is empty for synced purchases). One row per purchase invoice with
    its remaining balance after bill-wise allocations. See _open_party_invoices."""
    def get(self, request):
        return _open_party_invoices(request, party_type='Supplier')


class PayablesAgingView(APIView):
    def get(self, request):
        as_of_date = request.query_params.get('date', date.today().isoformat())
        location = require_location_or_all_access(request)

        as_of = date.fromisoformat(as_of_date)

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False,
            entry__date__lte=as_of_date,
            party_type='Supplier',
            account__account_subtype='Payable'
        )

        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        supplier_balances = defaultdict(Decimal)
        supplier_dates = defaultdict(list)

        # Only the 4 needed columns — not full line+entry instances.
        for line in lines_qs.values('party_id', 'debit', 'credit', 'entry__date'):
            net = line['credit'] - line['debit']
            if net != 0:
                supplier_balances[line['party_id']] += net
                if line['credit'] > 0:
                    supplier_dates[line['party_id']].append(
                        (line['entry__date'], line['credit']))

        tax_details = _party_tax_details('Supplier', set(supplier_balances.keys()))

        rows = []
        for supplier_id, balance in supplier_balances.items():
            if balance <= 0:
                continue
            d = tax_details.get(supplier_id, {})
            name = d.get('name') or f'Supplier #{supplier_id}'

            invoices = supplier_dates.get(supplier_id, [])
            payments = sum((amt for _, amt in invoices), Decimal('0')) - balance
            aging = _age_open_invoices(invoices, payments, as_of)

            rows.append({
                'supplier_id': supplier_id,
                'supplier_name': name,
                'gstin': d.get('gstin', ''),
                'pan': d.get('pan', ''),
                'state': d.get('state', ''),
                'msme_category': d.get('msme_category', ''),
                'msme_udyam_no': d.get('msme_udyam_no', ''),
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
    location = require_location_or_all_access(request)

    accounts = ChartOfAccount.objects.filter(account_subtype=account_subtype)
    if location:
        # Under per-store chart-of-accounts cloning each store has its own
        # '1110-<STORE>' leaf, all of them subtype Cash. Without this the book
        # listed every branch's ledger as a card of its own — and named it.
        # Untagged rows stay: the seeded template still carries the history of
        # any store that was never cloned.
        accounts = accounts.filter(
            Q(location_id=location.id) | Q(location_id__isnull=True))
    accounts = accounts.order_by('account_code')
    if account_code:
        accounts = accounts.filter(account_code=account_code)

    if not accounts.exists():
        return Response({'accounts': [], 'summary': {'total_debit': '0.00', 'total_credit': '0.00'}})

    result_accounts = []
    grand_debit = Decimal('0.00')
    grand_credit = Decimal('0.00')

    for account in accounts:
        base_qs = JournalEntryLine.objects.filter(
            account=account, entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False
        )
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
        # Same .values() column set as LedgerView — no full instances.
        for line in lines_qs.values(*_LEDGER_ROW_FIELDS).iterator():
            running_balance += line['debit'] - line['credit']
            transactions.append(_ledger_row(line, running_balance))
            grand_debit += line['debit']
            grand_credit += line['credit']

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
        location = require_location_or_all_access(request)

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
                    'account_subtype': line.account.account_subtype,
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
                'reference_type': entry.reference_type or '',
                'reference_id': entry.reference_id,
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
        location = require_location_or_all_access(request)

        if not period:
            return Response({'error': 'period is required'}, status=400)

        from gst_returns.models import GSTR1Entry, GSTR2BEntry, RCMEntry, GSTR3BSummary

        filters = {'period': period, 'is_active': True}
        if location:
            filters['location_id'] = location.id

        # Output tax by rate (forward supplies, gross of credit notes)
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

        # Credit notes (sales returns) — stored with NEGATIVE amounts. Shown as
        # their own block and netted into the liability, mirroring GSTR-3B
        # 3.1(a) which reports outward supplies net of CN (CGST §34). Without
        # this the worksheet overstated the period's payable vs the filed 3B.
        cn_qs = GSTR1Entry.objects.filter(
            **filters, invoice_type__in=['CREDIT_NOTE', 'CDNR', 'CDNUR'],
        ).exclude(is_time_barred=True)
        cn_agg = cn_qs.aggregate(
            taxable=Sum('taxable_value'),
            cgst=Sum('cgst'), sgst=Sum('sgst'), igst=Sum('igst'),
        )
        cn_taxable = cn_agg['taxable'] or Decimal('0')
        cn_cgst = cn_agg['cgst'] or Decimal('0')
        cn_sgst = cn_agg['sgst'] or Decimal('0')
        cn_igst = cn_agg['igst'] or Decimal('0')

        # RCM inward liability (3.1(d)) — payable in cash, ITC claimable.
        rcm_filters = {'period': period}
        if location:
            rcm_filters['location_id'] = location.id
        rcm_agg = RCMEntry.objects.filter(**rcm_filters).aggregate(
            taxable=Sum('taxable_value'),
            cgst=Sum('cgst'), sgst=Sum('sgst'), igst=Sum('igst'),
        )

        # Exempt outward supplies (3.1(c)) — consultation/OPD income etc.
        exempt_outward = Decimal('0')
        if location:
            summary_row = GSTR3BSummary.objects.filter(
                period=period, location_id=location.id,
            ).first()
            if summary_row:
                exempt_outward = summary_row.outward_exempt or Decimal('0')

        # Input tax from GSTR-2B
        input_filters = {'period': period, 'itc_eligible': True}
        if location:
            input_filters['location_id'] = location.id

        input_agg = GSTR2BEntry.objects.filter(**input_filters).aggregate(
            taxable=Sum('taxable_value'),
            cgst=Sum('cgst'), sgst=Sum('sgst'), igst=Sum('igst'),
        )

        # Net outward liability = forward supplies + credit notes (negative)
        # + RCM (payable in addition).
        total_output_cgst = sum(v['cgst'] for v in output_by_rate.values()) + cn_cgst
        total_output_sgst = sum(v['sgst'] for v in output_by_rate.values()) + cn_sgst
        total_output_igst = sum(v['igst'] for v in output_by_rate.values()) + cn_igst

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
            # Credit notes shown as positive reductions for readability.
            'credit_notes': {
                'taxable': str(-cn_taxable),
                'cgst': str(-cn_cgst),
                'sgst': str(-cn_sgst),
                'igst': str(-cn_igst),
            },
            'rcm_inward': {
                'taxable': str(rcm_agg['taxable'] or Decimal('0')),
                'cgst': str(rcm_agg['cgst'] or Decimal('0')),
                'sgst': str(rcm_agg['sgst'] or Decimal('0')),
                'igst': str(rcm_agg['igst'] or Decimal('0')),
            },
            'exempt_outward': str(exempt_outward),
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
        location = require_location_or_all_access(request)

        if not period:
            return Response({'error': 'period is required'}, status=400)

        from gst_returns.models import GSTR1HSNSummary

        filters = {'period': period, 'is_active': True}
        if location:
            filters['location_id'] = location.id

        segment = request.query_params.get('segment', '').upper()
        if segment in ('B2B', 'B2C'):
            filters['segment'] = segment

        hsn_entries = GSTR1HSNSummary.objects.filter(**filters).order_by(
            'hsn_code', 'segment', 'rate')

        rows = []
        seg_totals = {
            'B2B': {'taxable': Decimal('0'), 'tax': Decimal('0')},
            'B2C': {'taxable': Decimal('0'), 'tax': Decimal('0')},
        }
        for entry in hsn_entries:
            total_tax = entry.cgst + entry.sgst + entry.igst
            rows.append({
                'hsn_code': entry.hsn_code,
                'segment': entry.segment,
                'description': entry.description,
                'uqc': entry.uqc,
                'quantity': str(entry.quantity),
                'taxable_value': str(entry.taxable_value),
                'cgst': str(entry.cgst),
                'sgst': str(entry.sgst),
                'igst': str(entry.igst),
                'rate': str(entry.rate),
                'total_tax': str(total_tax),
            })
            bucket = seg_totals.setdefault(
                entry.segment, {'taxable': Decimal('0'), 'tax': Decimal('0')})
            bucket['taxable'] += entry.taxable_value
            bucket['tax'] += total_tax

        # CSV export in GSTR-1 Table 12 column order (per-segment tabs are
        # filed separately — pass ?segment=B2B / ?segment=B2C to export one).
        if request.query_params.get('export') == 'csv':
            response = HttpResponse(content_type='text/csv')
            response['Content-Disposition'] = (
                f'attachment; filename="HSN_Summary_{period}'
                f'{"_" + segment if segment in ("B2B", "B2C") else ""}.csv"'
            )
            writer = csv.writer(response)
            writer.writerow(['HSN', 'Segment', 'Description', 'UQC', 'Total Quantity',
                             'Rate (%)', 'Taxable Value', 'Integrated Tax',
                             'Central Tax', 'State/UT Tax'])
            for r in rows:
                writer.writerow([r['hsn_code'], r['segment'], r['description'],
                                 r['uqc'], r['quantity'], r['rate'],
                                 r['taxable_value'], r['igst'], r['cgst'], r['sgst']])
            return response

        return Response({
            'period': period,
            'rows': rows,
            'total_taxable': str(sum(Decimal(r['taxable_value']) for r in rows)),
            'total_tax': str(sum(Decimal(r['total_tax']) for r in rows)),
            # GSTR-1 Table 12 Phase-3 files B2B and B2C as separate tabs.
            'segment_totals': {
                seg: {'taxable': str(v['taxable']), 'tax': str(v['tax'])}
                for seg, v in seg_totals.items()
            },
        })


class PartyOutstandingView(APIView):
    """Phase 5C: Per customer/supplier outstanding with aging."""
    def get(self, request):
        party_type = request.query_params.get('party_type', 'Customer')
        as_of_date = request.query_params.get('date', date.today().isoformat())
        location = require_location_or_all_access(request)

        as_of = date.fromisoformat(as_of_date)

        lines_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False, entry__date__lte=as_of_date,
            party_type='Customer' if party_type == 'Customer' else 'Supplier',
        )

        if location:
            lines_qs = lines_qs.filter(entry__location_id=location.id)

        party_data = defaultdict(lambda: {
            'invoices': [],                  # (date, amount) gross invoices
            'invoices_total': Decimal('0'),
            'payments': Decimal('0'),
        })

        # Only the 4 needed columns — not full line+entry instances.
        for line in lines_qs.values('party_id', 'debit', 'credit', 'entry__date'):
            pid = line['party_id']
            if not pid:
                continue
            # Customer: invoice = Dr, payment = Cr. Supplier: the reverse.
            inv_amt, pay_amt = (
                (line['debit'], line['credit']) if party_type == 'Customer'
                else (line['credit'], line['debit'])
            )
            if inv_amt > 0:
                party_data[pid]['invoices'].append((line['entry__date'], inv_amt))
                party_data[pid]['invoices_total'] += inv_amt
            if pay_amt > 0:
                party_data[pid]['payments'] += pay_amt

        # Names arrive with the bulk tax-details query — no per-party .get().
        tax_details = _party_tax_details(party_type, set(party_data.keys()))

        rows = []
        for pid, data in party_data.items():
            closing = data['invoices_total'] - data['payments']
            if closing <= 0:
                continue
            d = tax_details.get(pid, {})
            name = d.get('name') or f'{party_type} #{pid}'

            aging = _age_open_invoices(data['invoices'], data['payments'], as_of)
            rows.append({
                'party_id': pid,
                'party_name': name,
                'gstin': d.get('gstin', ''),
                'pan': d.get('pan', ''),
                'state': d.get('state', ''),
                'msme_category': d.get('msme_category', ''),
                'opening_balance': '0',
                'invoices': str(data['invoices_total']),
                'payments': str(data['payments']),
                'closing_balance': str(closing),
                'aging_0_30': str(aging['0_30']),
                'aging_31_60': str(aging['31_60']),
                'aging_61_90': str(aging['61_90']),
                'aging_90_plus': str(aging['90_plus']),
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
        location = require_location_or_all_access(request)

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

        codes = {pid: (getattr(p, 'default_code', '') or '')
                 for pid, p in products.items()}
        rows.sort(key=lambda x: ci_key(x['product_name'],
                                       codes.get(x['product_id'], ''),
                                       x['product_id']))

        return Response({
            'start_date': start_date,
            'end_date': end_date,
            'rows': rows,
            'total_products': len(rows),
        })




def _movement_pack_delta(m):
    """Signed PACK-unit stock change for a movement. `quantity` mixes units —
    loose sales log tablets — but quantity_before/after always snapshot the
    quant's STRIP count, so their difference is the true pack delta (a strip
    broken for a loose sale counts when broken; the loose remainder on hand
    is the only — bounded — approximation)."""
    qb, qa = m.quantity_before, m.quantity_after
    if qb is None or qa is None:
        return m.quantity
    return qa - qb

def _weighted_avg_rates(location_id=None):
    """Per-product weighted-average cost, the SAME formula the journal
    generators capitalise stock with and relieve COGS at —
    ``(qty + free_qty) × rate × (1 − discount%)`` over ``(qty + free_qty)``
    units, plus opening-stock lines at their own rate, optionally scoped to
    one location. The previous inline version ignored free goods, trade
    discounts and location, so Stock Valuation / Closing-Stock Recon drifted
    several percent away from the books for no real reason.
    """
    from collections import defaultdict as _dd
    from django.db.models import DecimalField, ExpressionWrapper
    from inventory_reader.models import OpeningStockLineRO, PurchaseOrderLineRO

    money = DecimalField(max_digits=20, decimal_places=6)
    po_qs = PurchaseOrderLineRO.objects.filter(
        purchase_order__state__in=['confirmed', 'done', 'approved'])
    os_qs = OpeningStockLineRO.objects.all()
    if location_id is not None:
        po_qs = po_qs.filter(purchase_order__location_id=location_id)
        os_qs = os_qs.filter(opening_stock__location_id=location_id)

    value_expr = ExpressionWrapper(
        (F('quantity') + F('free_qty')) * F('purchase_rate')
        * (Decimal('100') - F('discount_percent')) / Decimal('100'),
        output_field=money,
    )
    units_expr = ExpressionWrapper(F('quantity') + F('free_qty'), output_field=money)

    totals = _dd(lambda: {'qty': Decimal('0'), 'value': Decimal('0')})
    for row in po_qs.values('product_id').annotate(
            total_qty=Sum(units_expr), total_value=Sum(value_expr)):
        if row['total_qty'] and row['total_qty'] > 0:
            totals[row['product_id']]['qty'] += Decimal(str(row['total_qty']))
            totals[row['product_id']]['value'] += Decimal(str(row['total_value']))
    for row in os_qs.values('product_id').annotate(
            total_qty=Sum('quantity'),
            total_value=Sum(F('quantity') * F('purchase_rate'))):
        if row['total_qty'] and row['total_qty'] > 0:
            totals[row['product_id']]['qty'] += Decimal(str(row['total_qty']))
            totals[row['product_id']]['value'] += Decimal(str(row['total_value']))
    return {pid: t['value'] / t['qty'] for pid, t in totals.items() if t['qty'] > 0}


class StockValuationView(APIView):
    """Product-wise stock valuation using weighted average cost."""
    def get(self, request):
        from inventory_reader.models import StockMovementRO, ProductRO

        as_of_date = request.query_params.get('date', date.today().isoformat())
        location = require_location_or_all_access(request)

        # StockMovementRO.quantity is signed (positive = IN, negative = OUT)
        # per inventory_management's MovementType convention — so a simple
        # sum gives qty on hand. This already covers opening_stock, purchase_in,
        # sales (negative), returns, write-offs, and transfers.
        movements = StockMovementRO.objects.filter(created_at__date__lte=as_of_date)
        if location:
            movements = movements.filter(location_id=location.id)

        qty_data = defaultdict(int)
        for mv in movements:
            qty_data[mv.product_id] += _movement_pack_delta(mv)

        avg_rates = _weighted_avg_rates(location.id if location else None)

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

        codes = {pid: (getattr(p, 'default_code', '') or '')
                 for pid, p in products.items()}
        rows.sort(key=lambda x: ci_key(x['product_name'],
                                       codes.get(x['product_id'], ''),
                                       x['product_id']))

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
        location = require_location_or_all_access(request)
        lines = (JournalEntryLine.objects
                 .filter(party_type='Supplier', party_id__in=msme_index.keys(),
                         entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False, entry__date__lte=as_of)
                 .select_related('entry', 'account'))
        if location:
            lines = lines.filter(entry__location_id=location.id)

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
        location = require_location_or_all_access(request)
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
        location = require_location_or_all_access(request)

        period_lines = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False, entry__date__gte=start, entry__date__lte=end,
        )
        as_of_lines = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False, entry__date__lte=end,
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

        location = require_location_or_all_access(request)
        accounts = BankAccount.objects.all()
        if location:
            accounts = accounts.filter(location_id=location.id)
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
        location = require_location_or_all_access(request)

        # 1. Books-side: Closing Stock GL balance up to as_of
        from core.models import AccountMapping
        try:
            cs_acct = AccountMapping.get_account(
                'CLOSING_STOCK', location_id=location.id if location else None)
        except ValueError:
            return Response(
                {'detail': 'CLOSING_STOCK account mapping is not configured.'},
                status=400,
            )
        # Per-store bootstrap posts to clones parented under the template —
        # a location resolves to its own clone; the consolidated (no-location)
        # view must sum the template plus every store clone beneath it.
        family = Q(account=cs_acct) | Q(account__parent=cs_acct)
        bq = JournalEntryLine.objects.filter(
            family, entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False, entry__date__lte=as_of,
        )
        if location:
            bq = bq.filter(entry__location_id=location.id)
        agg = bq.aggregate(d=Sum('debit'), c=Sum('credit'))
        books_balance = (agg['d'] or Decimal('0')) - (agg['c'] or Decimal('0'))

        # 2. Inventory-side: replay movements to get qty-on-hand × weighted-
        # avg purchase rate. StockMovementRO.quantity is signed, so summing
        # gives qty on hand directly. Cost = weighted avg across PO lines +
        # opening-stock lines (the same calc StockValuationView uses).
        from inventory_reader.models import StockMovementRO
        moves = StockMovementRO.objects.filter(created_at__date__lte=as_of)
        if location:
            moves = moves.filter(location_id=location.id)
        from collections import defaultdict
        qty_on_hand = defaultdict(int)
        for m in moves:
            qty_on_hand[m.product_id] += _movement_pack_delta(m)

        # Same cost basis the journals capitalise/relieve at — anything else
        # makes the recon report phantom variance.
        avg_rate = _weighted_avg_rates(location.id if location else None)

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
        location = require_location_or_all_access(request)
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
        rows.sort(key=lambda r: (-(r['days_since_last_sale'] or 99999),)
                  + ci_key(r.get('product_name', ''), r.get('product_id', 0)))
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
        location = require_location_or_all_access(request)

        lines = (JournalEntryLine.objects
                 .filter(entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False,
                         entry__date__gte=start, entry__date__lte=end,
                         account__account_type__in=('REVENUE', 'EXPENSE'))
                 )
        if location:
            lines = lines.filter(entry__location_id=location.id)

        rows_by_acct = defaultdict(lambda: defaultdict(Decimal))
        cost_centers = set()
        meta = {}

        # Grouped (account × cost-centre) sums instead of one Python pass
        # over every line instance in the period.
        grouped = lines.values(
            'entry__cost_center', 'account__account_code',
            'account__account_name', 'account__account_type',
        ).annotate(dr=Sum('debit'), cr=Sum('credit'))
        for g in grouped:
            cc = g['entry__cost_center'] or 'UNASSIGNED'
            cost_centers.add(cc)
            dr = g['dr'] or Decimal('0')
            cr = g['cr'] or Decimal('0')
            net = (cr - dr
                   if g['account__account_type'] == 'REVENUE'
                   else dr - cr)
            rows_by_acct[g['account__account_code']][cc] += net
            meta[g['account__account_code']] = {
                'name': g['account__account_name'],
                'type': g['account__account_type'],
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
        location = require_location_or_all_access(request)

        all_lines = JournalEntryLine.objects.filter(
            entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False, entry__date__gte=start, entry__date__lte=end,
        )
        if location:
            all_lines = all_lines.filter(entry__location_id=location.id)

        # ONE grouped query replaces five full-instance passes over every
        # line in the period: every bucket below keys purely on the account's
        # type / subtype / name, so the small (type, subtype, name) → (Σdr,
        # Σcr) result carries everything the heuristics need.
        grouped = list(
            all_lines.values(
                'account__account_type', 'account__account_subtype',
                'account__account_name',
            ).annotate(dr=Sum('debit'), cr=Sum('credit'))
        )
        for g in grouped:
            g['dr'] = g['dr'] or Decimal('0')
            g['cr'] = g['cr'] or Decimal('0')

        # 1. Net profit for the period
        revenue = sum(
            (g['cr'] - g['dr'] for g in grouped
             if g['account__account_type'] == 'REVENUE'),
            Decimal('0'),
        )
        expenses = sum(
            (g['dr'] - g['cr'] for g in grouped
             if g['account__account_type'] == 'EXPENSE'),
            Decimal('0'),
        )
        net_profit = revenue - expenses

        # 2. Non-cash addbacks: depreciation expense (subtype 'Other_Expense'
        # carrying name 'Depreciation' — heuristic) + bad debts + other non-cash
        non_cash = Decimal('0')
        for g in grouped:
            name = (g['account__account_name'] or '').lower()
            if any(k in name for k in ('depreciation', 'amortization', 'bad debt')):
                non_cash += (g['dr'] - g['cr'])

        # 3. Working capital changes — increase in asset uses cash; increase in liability provides cash
        wc_change = Decimal('0')
        wc_breakdown = {}
        for sub in self.OPERATING_WC_SUBTYPES:
            net = sum(
                (g['dr'] - g['cr'] for g in grouped
                 if g['account__account_subtype'] == sub),
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
        for g in grouped:
            name = (g['account__account_name'] or '').lower()
            if any(k in name for k in self.INVESTING_KEYWORDS):
                # Asset bought (Dr) = outflow, sold (Cr) = inflow
                investing_cf -= (g['dr'] - g['cr'])

        # 5. Financing — loans + capital
        financing_cf = Decimal('0')
        for g in grouped:
            name = (g['account__account_name'] or '').lower()
            if any(k in name for k in self.FINANCING_KEYWORDS):
                # Liability/equity increase (Cr) = inflow
                financing_cf += (g['cr'] - g['dr'])

        # 6. Net change in cash
        cash_subtypes = ('Cash', 'Bank')
        opening_cash_qs = JournalEntryLine.objects.filter(
            account__account_subtype__in=cash_subtypes,
            entry__is_posted=True, entry__is_optional=False, entry__is_memorandum=False, entry__date__lt=start,
        )
        if location:
            # Same store scope as the period transactions, else opening cash
            # would fold in every other store's historical balance.
            opening_cash_qs = opening_cash_qs.filter(entry__location_id=location.id)
        opening_agg = opening_cash_qs.aggregate(dr=Sum('debit'), cr=Sum('credit'))
        opening_cash = (opening_agg['dr'] or Decimal('0')) - (opening_agg['cr'] or Decimal('0'))
        closing_cash = opening_cash + sum(
            (g['dr'] - g['cr'] for g in grouped
             if g['account__account_subtype'] in cash_subtypes),
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


# ─── GST Filing Health Check ─────────────────────────────────────────────────

import re as _re

# 2-digit state code + PAN (5 alpha, 4 digits, 1 alpha) + entity code + 'Z' + checksum
_GSTIN_RE = _re.compile(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')


def _valid_gstin(gstin):
    return bool(_GSTIN_RE.match((gstin or '').strip().upper()))


def _valid_hsn(hsn):
    digits = (hsn or '').strip()
    return digits.isdigit() and len(digits) in (4, 6, 8)


class GSTFilingHealthView(APIView):
    """Pre-filing scan for the period: everything that will get a GSTR-1/3B
    rejected, an ITC claim questioned, or a notice raised later. Each section
    is independent and degrades to status='unavailable' if its data source
    can't be read (e.g. the inventory DB is unreachable), so one failure never
    hides the rest.
    """

    MAX_ROWS = 200

    def get(self, request):
        period = request.query_params.get('period')
        if not period:
            return Response({'error': 'period is required'}, status=400)
        try:
            year, month = map(int, period.split('-'))
            if not (1 <= month <= 12):
                raise ValueError
        except (ValueError, AttributeError):
            return Response({'error': 'period must be YYYY-MM'}, status=400)

        location = require_location_or_all_access(request)
        loc_id = location.id if location else None

        from gst_returns.models import GSTR1Entry, GSTR2BEntry

        sections = {}

        def add_section(key, title, severity, rows, note='', total=None):
            sections[key] = {
                'title': title,
                'severity': severity,          # 'error' | 'warning' | 'info'
                'status': 'ok',
                'count': len(rows) if total is None else total,
                'rows': rows[:self.MAX_ROWS],
                'note': note,
            }

        def unavailable(key, title, reason):
            sections[key] = {
                'title': title, 'severity': 'info', 'status': 'unavailable',
                'count': 0, 'rows': [], 'note': f'Could not read source data: {reason}',
            }

        gstr1_filters = {'period': period, 'is_active': True}
        if loc_id:
            gstr1_filters['location_id'] = loc_id

        # 1. B2B invoices with an invalid customer GSTIN — portal rejects the
        # b2b section and the buyer loses ITC visibility.
        rows = []
        for e in GSTR1Entry.objects.filter(**gstr1_filters, invoice_type='B2B'):
            if not _valid_gstin(e.customer_gstin):
                rows.append({
                    'invoice_no': e.invoice_no,
                    'invoice_date': e.invoice_date,
                    'customer_gstin': e.customer_gstin,
                    'taxable_value': str(e.taxable_value),
                })
        add_section(
            'invalid_customer_gstin', 'B2B invoices with invalid customer GSTIN',
            'error', rows,
            'GSTR-1 B2B section rejects malformed GSTINs; fix the customer master '
            'in the pharmacy app and regenerate GSTR-1.',
        )

        # 2. ITC-eligible purchase rows with missing/invalid supplier GSTIN —
        # that ITC will never appear in the real GSTR-2B and is at risk.
        gstr2b_filters = {'period': period, 'itc_eligible': True}
        if loc_id:
            gstr2b_filters['location_id'] = loc_id
        rows = []
        for e in GSTR2BEntry.objects.filter(**gstr2b_filters):
            if not _valid_gstin(e.supplier_gstin):
                rows.append({
                    'supplier_name': e.supplier_name,
                    'supplier_gstin': e.supplier_gstin,
                    'invoice_no': e.invoice_no,
                    'invoice_date': e.invoice_date,
                    'itc_at_risk': str(e.cgst + e.sgst + e.igst),
                })
        add_section(
            'invalid_supplier_gstin', 'ITC claimed against missing/invalid supplier GSTIN',
            'error', rows,
            'Without a valid supplier GSTIN this credit will never match the '
            'government GSTR-2B — fix the supplier master before claiming.',
        )

        # 3. Zero-rate anomalies: taxable value with 0% rate on forward supplies.
        rows = []
        for e in GSTR1Entry.objects.filter(**gstr1_filters).exclude(
                invoice_type__in=['CREDIT_NOTE', 'CDNR', 'CDNUR']):
            if e.rate == 0 and e.taxable_value > 0:
                rows.append({
                    'invoice_no': e.invoice_no,
                    'invoice_date': e.invoice_date,
                    'invoice_type': e.invoice_type,
                    'taxable_value': str(e.taxable_value),
                })
        add_section(
            'zero_rate_supplies', 'Taxable supplies reported at 0% GST',
            'warning', rows,
            'Medicines are taxable (5/12/18%). A 0% line usually means the '
            'product tax rate is blank in the pharmacy app.',
        )

        # 4. Time-barred credit notes (CGST §34(2) — 30-Nov deadline passed).
        rows = [{
            'return_no': e.invoice_no,
            'return_date': e.invoice_date,
            'original_invoice_no': e.original_invoice_no,
            'taxable_value': str(-e.taxable_value),
        } for e in GSTR1Entry.objects.filter(**gstr1_filters, is_time_barred=True)]
        add_section(
            'time_barred_credit_notes', 'Credit notes past the §34(2) deadline',
            'warning', rows,
            'These cannot reduce output tax in GSTR-1/3B any more; the GST on '
            'them is a cost. Already excluded from the computed liability.',
        )

        # 5. Products sold this period with missing/invalid HSN — Table 12 is
        # mandatory and validates HSN length (4/6/8 digits).
        try:
            from inventory_reader.models import (
                POSOrderLineRO, B2BSalesOrderLineRO,
            )
            bad = {}
            pos_lines = POSOrderLineRO.objects.filter(
                pos_order__sale_date__year=year,
                pos_order__sale_date__month=month,
                pos_order__status__in=['confirmed', 'completed'],
            ).select_related('product')
            b2b_lines = B2BSalesOrderLineRO.objects.filter(
                sales_order__sale_date__year=year,
                sales_order__sale_date__month=month,
                sales_order__status__in=['confirmed', 'delivered', 'invoiced'],
                sales_order__source_indent_id__isnull=True,
            ).select_related('product')
            if loc_id:
                pos_lines = pos_lines.filter(pos_order__location_id=loc_id)
                b2b_lines = b2b_lines.filter(sales_order__location_id=loc_id)
            for line in list(pos_lines) + list(b2b_lines):
                # A clinical service line has no product master to fix — it carries
                # a SAC snapshotted from the service master. Flagging it here would
                # tell the operator to correct a product that does not exist.
                if getattr(line, 'is_service', False):
                    continue
                p = line.product
                if p is None:
                    continue
                if not _valid_hsn(p.pharma_hsn_code):
                    entry = bad.setdefault(p.id, {
                        'product_id': p.id, 'product_name': p.name,
                        'hsn_code': p.pharma_hsn_code or '', 'lines': 0,
                    })
                    entry['lines'] += 1
            add_section(
                'missing_hsn', 'Products sold with missing/invalid HSN code',
                'error', list(bad.values()),
                'GSTR-1 Table 12 requires a 4/6/8-digit HSN per item. Fix the '
                'product master (pharma HSN code) and regenerate GSTR-1.',
            )
        except Exception as exc:
            unavailable('missing_hsn', 'Products sold with missing/invalid HSN code', exc)

        # 6. Write-offs without ITC reversal — §17(5)(h): goods destroyed /
        # written off require reversal of the credit taken, reported in
        # GSTR-3B 4(B)(1). The sync books the stock loss but not the reversal.
        try:
            from inventory_reader.models import StockMovementRO
            from journals.services import JournalAutoGenerationService
            svc = JournalAutoGenerationService()
            mv_qs = StockMovementRO.objects.filter(
                movement_type__in=JournalAutoGenerationService.WRITEOFF_MOVEMENT_TYPES,
                created_at__year=year, created_at__month=month,
            ).select_related('product')
            if loc_id:
                mv_qs = mv_qs.filter(location_id=loc_id)
            rows = []
            total_reversal = Decimal('0')
            for mv in mv_qs:
                qty = abs(int(mv.quantity or 0))
                if qty == 0 or mv.product is None:
                    continue
                cost = svc._product_avg_cost(mv.product_id, mv.location_id)
                value = (Decimal(qty) * cost).quantize(Decimal('0.01'))
                rate = Decimal(str(mv.product.pharma_gst_percent or 0))
                reversal = (value * rate / Decimal('100')).quantize(Decimal('0.01'))
                total_reversal += reversal
                rows.append({
                    'movement_id': mv.id,
                    'date': mv.created_at.date(),
                    'movement_type': mv.movement_type,
                    'product_name': mv.product.name,
                    'qty': qty,
                    'cost_value': str(value),
                    'gst_rate': str(rate),
                    'suggested_itc_reversal': str(reversal),
                })
            add_section(
                'writeoff_itc_reversal', 'Write-offs needing ITC reversal — §17(5)(h)',
                'warning', rows,
                f'Suggested total reversal for GSTR-3B 4(B)(1): ₹{total_reversal}. '
                'Post it as a journal (Cr Input CGST/SGST, Dr the loss account); '
                'the sync intentionally does not auto-post it because the original '
                'purchase tax head (intra vs inter) varies per batch.',
            )
        except Exception as exc:
            unavailable('writeoff_itc_reversal', 'Write-offs needing ITC reversal — §17(5)(h)', exc)

        # 7. §194Q TDS applicability — purchases from a supplier crossing
        # ₹50,00,000 in the FY require 0.1% TDS on the excess (buyer turnover
        # > ₹10 Cr precondition). Entity-wide, not per store.
        try:
            from django.db.models import DecimalField, ExpressionWrapper
            from inventory_reader.models import PurchaseOrderLineRO, SupplierRO
            from tds.models import TDSDeduction

            fy_start = date(year if month >= 4 else year - 1, 4, 1)
            # End of the selected period (first of the next month).
            period_end = date(year + (1 if month == 12 else 0),
                              1 if month == 12 else month + 1, 1)
            money = DecimalField(max_digits=20, decimal_places=2)
            value_expr = ExpressionWrapper(
                (F('quantity') + F('free_qty')) * F('purchase_rate')
                * (Decimal('100') - F('discount_percent')) / Decimal('100'),
                output_field=money,
            )
            sums = (
                PurchaseOrderLineRO.objects.filter(
                    purchase_order__state__in=['confirmed', 'done', 'approved'],
                    purchase_order__bill_date__gte=fy_start,
                    purchase_order__bill_date__lt=period_end,
                )
                .exclude(purchase_order__transfer_kind__in=['inter_store', 'intra_store'])
                .values('purchase_order__supplier_id')
                .annotate(total=Sum(value_expr))
            )
            THRESHOLD = Decimal('5000000')
            crossing = {r['purchase_order__supplier_id']: r['total']
                        for r in sums if (r['total'] or 0) > THRESHOLD}
            supplier_names = dict(
                SupplierRO.objects.filter(id__in=list(crossing.keys()))
                .values_list('id', 'company_name')
            )
            supplier_gstins = dict(
                SupplierRO.objects.filter(id__in=list(crossing.keys()))
                .values_list('id', 'gst_no')
            )
            deducted_194q = (
                TDSDeduction.objects.filter(
                    section='194Q',
                    transaction_date__gte=fy_start,
                    transaction_date__lt=period_end,
                ).aggregate(t=Sum('tds_amount'))['t'] or Decimal('0')
            )
            rows = []
            for sid, total in sorted(crossing.items(), key=lambda kv: -kv[1]):
                excess = total - THRESHOLD
                rows.append({
                    'supplier_id': sid,
                    'supplier_name': supplier_names.get(sid, f'Supplier #{sid}'),
                    'supplier_gstin': supplier_gstins.get(sid, ''),
                    'fy_purchases': str(total.quantize(Decimal('0.01'))),
                    'excess_over_50L': str(excess.quantize(Decimal('0.01'))),
                    'suggested_tds_0_1pct': str((excess * Decimal('0.001')).quantize(Decimal('0.01'))),
                })
            add_section(
                'tds_194q', 'Suppliers crossing ₹50L FY purchases — §194Q TDS',
                'warning', rows,
                f'Applies only if your turnover exceeded ₹10 Cr last FY. TDS @0.1% '
                f'on the excess over ₹50L, deducted at credit/payment. 194Q already '
                f'recorded this FY (all suppliers): ₹{deducted_194q}. Record '
                f'deductions under TDS → Deductions.',
            )
        except Exception as exc:
            unavailable('tds_194q', 'Suppliers crossing ₹50L FY purchases — §194Q TDS', exc)

        # 8. E-way bill coverage — movement of goods worth over Rs 50,000
        # requires an e-way bill (Rule 138; intra-state thresholds vary by
        # state). Match B2B invoices against the dispatch register.
        try:
            from inventory_reader.models import B2BSalesOrderRO, DispatchEntryRO
            EWAY_THRESHOLD = Decimal('50000')
            b2b_qs = B2BSalesOrderRO.objects.filter(
                sale_date__year=year, sale_date__month=month,
                status__in=['confirmed', 'delivered', 'invoiced'],
                source_indent_id__isnull=True,
                total_amount__gt=EWAY_THRESHOLD,
            )
            if loc_id:
                b2b_qs = b2b_qs.filter(location_id=loc_id)
            orders = list(b2b_qs.values('id', 'invoice_no', 'sale_date', 'total_amount'))
            order_ids = [o['id'] for o in orders]
            inv_nos = [o['invoice_no'] for o in orders if o['invoice_no']]
            covered_ids = set()
            covered_invs = set()
            for d in DispatchEntryRO.objects.filter(
                    source_type='b2b', source_order_id__in=order_ids,
            ).exclude(eway_bill_no=''):
                covered_ids.add(d.source_order_id)
            for d in DispatchEntryRO.objects.filter(
                    invoice_no__in=inv_nos).exclude(eway_bill_no=''):
                covered_invs.add(d.invoice_no)
            rows = [{
                'invoice_no': o['invoice_no'],
                'invoice_date': o['sale_date'],
                'invoice_value': str(o['total_amount']),
            } for o in orders
                if o['id'] not in covered_ids
                and o['invoice_no'] not in covered_invs]
            add_section(
                'missing_eway_bill', 'Invoices over Rs 50,000 with no e-way bill on dispatch',
                'warning', rows,
                'Rule 138 requires an e-way bill for goods movement above Rs 50,000 '
                '(intra-state thresholds vary by state). Record the e-way bill '
                'number on the dispatch entry in the pharmacy app.',
            )
        except Exception as exc:
            unavailable('missing_eway_bill', 'Invoices over Rs 50,000 with no e-way bill on dispatch', exc)

        # 9. Internal transfer invoices consuming the tax-invoice series.
        try:
            from inventory_reader.models import B2BSalesOrderRO
            qs = B2BSalesOrderRO.objects.filter(
                sale_date__year=year, sale_date__month=month,
                source_indent_id__isnull=False,
            )
            if loc_id:
                qs = qs.filter(location_id=loc_id)
            rows = [{'invoice_no': n} for n in qs.values_list('invoice_no', flat=True)]
            add_section(
                'internal_in_tax_series', 'Inter-store transfers using tax-invoice serials',
                'info', rows,
                'Branch transfers within the same GSTIN should ideally move on '
                'delivery challans, not the tax-invoice series. They are excluded '
                'from GSTR-1 values and flagged in Table 13 as internal.',
            )
        except Exception as exc:
            unavailable('internal_in_tax_series', 'Inter-store transfers using tax-invoice serials', exc)

        actionable = sum(
            s['count'] for s in sections.values()
            if s['severity'] in ('error', 'warning') and s['status'] == 'ok'
        )
        return Response({
            'period': period,
            'sections': sections,
            'total_issues': actionable,
        })


# ─── Books registers (Purchase / Expense / Asset) ──────────────────────────

def _parse_range_or_fy(request):
    """start_date/end_date query params (ISO) with current-FY defaults.
    Returns (start, end, error_response)."""
    fy_start, fy_end = get_fy_dates()
    start_raw = request.query_params.get('start_date')
    end_raw = request.query_params.get('end_date')
    try:
        start = date.fromisoformat(start_raw) if start_raw else fy_start
        end = date.fromisoformat(end_raw) if end_raw else fy_end
    except ValueError:
        return None, None, Response(
            {'error': 'start_date/end_date must be YYYY-MM-DD'}, status=400)
    if start > end:
        return None, None, Response(
            {'error': 'start_date must be on or before end_date'}, status=400)
    return start, end, None


def _register_export(request, filename_base, columns, row_values, title):
    """?export=csv|xlsx handling shared by the three register views.
    Returns an HttpResponse or None (JSON path)."""
    fmt = request.query_params.get('export')
    if fmt not in ('csv', 'xlsx'):
        return None
    from core.export_utils import csv_response, xlsx_response
    if fmt == 'csv':
        return csv_response(f'{filename_base}.csv', columns, row_values)
    return xlsx_response(f'{filename_base}.xlsx',
                         [(title, None, columns, row_values)])


class PurchaseRegisterView(APIView):
    """Supplier-invoice-wise purchase register (inventory purchases) with
    GST split — registered and unregistered suppliers, transfers excluded."""

    COLUMNS = ['Supplier GSTIN', 'Supplier Name', 'Invoice No', 'Invoice Date',
               'Supply Type', 'Taxable Value', 'CGST', 'SGST', 'IGST',
               'Invoice Value']

    def get(self, request):
        from gst_returns.registers import build_purchase_register, serialize_rows

        start, end, err = _parse_range_or_fy(request)
        if err:
            return err
        location = require_location_or_all_access(request)
        data = build_purchase_register(start, end, location.id if location else None)
        rows = serialize_rows(data['rows'])

        export = _register_export(
            request, f'Purchase_Register_{start}_{end}', self.COLUMNS,
            [[r['supplier_gstin'], r['supplier_name'], r['invoice_no'],
              r['invoice_date'], r['supply_type'], r['taxable_value'],
              r['cgst'], r['sgst'], r['igst'], r['invoice_value']]
             for r in rows],
            'Purchase Register')
        if export is not None:
            return export
        return Response({
            'start_date': start.isoformat(), 'end_date': end.isoformat(),
            'rows': rows, 'totals': data['totals'],
            'registered_count': data['registered_count'],
            'unregistered_count': data['unregistered_count'],
        })


class ExpenseRegisterView(APIView):
    """Date-ordered register of direct expenses + vendor bills with GST/ITC
    columns; expense heads joined per voucher."""

    COLUMNS = ['Date', 'Voucher No', 'Source', 'Expense Head', 'Supplier',
               'GSTIN', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total',
               'Paid Through']

    def get(self, request):
        from .registers import build_expense_register, serialize_rows

        start, end, err = _parse_range_or_fy(request)
        if err:
            return err
        location = require_location_or_all_access(request)
        data = build_expense_register(start, end, location.id if location else None)
        rows = serialize_rows(data['rows'])

        export = _register_export(
            request, f'Expense_Register_{start}_{end}', self.COLUMNS,
            [[r['date'], r['voucher_no'], r['source'], r['head'],
              r['party_name'], r['gstin'], r['taxable_value'], r['cgst'],
              r['sgst'], r['igst'], r['total'], r['paid_through']]
             for r in rows],
            'Expense Register')
        if export is not None:
            return export
        return Response({
            'start_date': start.isoformat(), 'end_date': end.isoformat(),
            'rows': rows, 'totals': data['totals'],
            'voucher_count': data['voucher_count'],
            'non_gst_count': data['non_gst_count'],
        })


class AssetRegisterView(APIView):
    """Fixed-asset register with acquisition-time ITC split, accumulated
    depreciation and net book value. Date range filters acquisitions;
    omit both dates for the full register."""

    COLUMNS = ['Asset No', 'Name', 'Class', 'Vendor', 'GSTIN',
               'Acquisition Date', 'Acquisition Cost', 'CGST', 'SGST', 'IGST',
               'Invoice Value', 'Accum. Depreciation', 'Net Book Value',
               'Status']

    def get(self, request):
        from .registers import build_asset_register, serialize_rows

        start_raw = request.query_params.get('start_date')
        end_raw = request.query_params.get('end_date')
        try:
            start = date.fromisoformat(start_raw) if start_raw else None
            end = date.fromisoformat(end_raw) if end_raw else None
        except ValueError:
            return Response(
                {'error': 'start_date/end_date must be YYYY-MM-DD'}, status=400)
        if start and end and start > end:
            return Response(
                {'error': 'start_date must be on or before end_date'}, status=400)
        location = require_location_or_all_access(request)
        data = build_asset_register(start, end, location.id if location else None)
        rows = serialize_rows(data['rows'])

        export = _register_export(
            request,
            f'Asset_Register_{start or "all"}_{end or "all"}', self.COLUMNS,
            [[r['asset_no'], r['name'], r['asset_class'], r['party_name'],
              r['gstin'], r['acquisition_date'], r['acquisition_cost'],
              r['cgst'], r['sgst'], r['igst'], r['invoice_value'],
              r['accumulated_depreciation'], r['net_book_value'], r['status']]
             for r in rows],
            'Asset Register')
        if export is not None:
            return export
        return Response({
            'start_date': start.isoformat() if start else None,
            'end_date': end.isoformat() if end else None,
            'rows': rows, 'totals': data['totals'],
            'asset_count': data['asset_count'],
        })


class PurchaseRegisterLinesView(APIView):
    """Drill-down for one purchase register row: the purchase-entry line
    items (product, HSN, batch, expiry, qty, free qty, rate, MRP, discount,
    GST rate) with taxable/tax derived identically to the register row."""

    def get(self, request):
        from gst_returns.registers import build_purchase_lines, serialize_rows

        po_id = request.query_params.get('po_id')
        try:
            po_id = int(po_id)
        except (TypeError, ValueError):
            return Response({'error': 'po_id (integer) is required'}, status=400)

        location = require_location_or_all_access(request)
        data = build_purchase_lines(po_id, location.id if location else None)
        if data is None:
            return Response({'error': 'Purchase not found'}, status=404)

        data['lines'] = serialize_rows(data['lines'])
        data['invoice_date'] = (
            data['invoice_date'].isoformat() if data['invoice_date'] else None)
        return Response(data)

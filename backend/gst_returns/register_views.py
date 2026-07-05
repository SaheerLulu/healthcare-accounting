"""API views for the live GST registers + the working-papers workbook.

GET /api/gst/reports/b2b-register/?period=YYYY-MM[&export=csv]
GET /api/gst/reports/b2c-summary/?period=YYYY-MM[&export=csv]
GET /api/gst/reports/credit-notes/?period=YYYY-MM[&export=csv]
GET /api/gst/working-papers/?period=YYYY-MM            (always .xlsx)

Location scoping follows the reports-app convention: the X-Location-Id
header picks the store; admins with no header get the consolidated
all-stores view (require_location_or_all_access is fail-closed for
regular users).
"""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.export_utils import csv_response, xlsx_response
from core.mixins import require_location_or_all_access
from core.models import LocationTaxProfile
from .registers import (
    build_b2b_register, build_b2c_summary, build_credit_note_register,
    build_purchase_register, period_date_range, serialize_rows, split_period,
)


def _clean_period(request):
    """Returns (period, error_response) — exactly one is non-None."""
    period = request.query_params.get('period')
    if not period:
        return None, Response({'detail': 'period is required.'},
                              status=status.HTTP_400_BAD_REQUEST)
    try:
        split_period(period)
    except (ValueError, AttributeError):
        return None, Response({'detail': 'period must be YYYY-MM.'},
                              status=status.HTTP_400_BAD_REQUEST)
    return period, None


def _preamble(title, period, location):
    identity = LocationTaxProfile.resolve(location.id if location else None)
    store = (getattr(location, 'name', '') or f'Location #{location.id}') \
        if location else 'All stores'
    return [
        f'{title} — {period}',
        f'Store: {store}',
        f'GSTIN: {identity.gstin or "—"} | {identity.legal_name or ""}'.strip(' |'),
    ]


class B2BRegisterView(APIView):
    """GSTR-1 Table 4 shape: rate-wise rows per registered-buyer invoice."""

    COLUMNS = ['GSTIN', 'Party Name', 'Invoice No', 'Invoice Date',
               'Invoice Value', 'Place of Supply', 'Supply Type', 'Rate (%)',
               'Taxable Value', 'CGST', 'SGST', 'IGST', 'Source']

    def get(self, request):
        period, err = _clean_period(request)
        if err:
            return err
        location = require_location_or_all_access(request)
        data = build_b2b_register(period, location.id if location else None)
        rows = serialize_rows(data['rows'])

        if request.query_params.get('export') == 'csv':
            return csv_response(
                f'B2B_Register_{period}.csv', self.COLUMNS,
                [[r['gstin'], r['party_name'], r['invoice_no'],
                  r['invoice_date'], r['invoice_value'], r['place_of_supply'],
                  r['supply_type'], r['rate'], r['taxable_value'],
                  r['cgst'], r['sgst'], r['igst'], r['source']] for r in rows],
                preamble=_preamble('GSTR-1 B2B Register', period, location),
            )
        return Response({'period': period, 'rows': rows,
                         'totals': data['totals'],
                         'invoice_count': data['invoice_count']})


class B2CSummaryView(APIView):
    """GSTR-1 Table 7 (B2C Others): rate-wise consolidated, net of B2C CNs."""

    COLUMNS = ['Place of Supply', 'Supply Type', 'Rate (%)', 'Taxable Value',
               'CGST', 'SGST', 'IGST', 'Total Tax']

    def get(self, request):
        period, err = _clean_period(request)
        if err:
            return err
        location = require_location_or_all_access(request)
        data = build_b2c_summary(period, location.id if location else None)
        rows = serialize_rows(data['rows'])

        if request.query_params.get('export') == 'csv':
            return csv_response(
                f'B2C_Summary_{period}.csv', self.COLUMNS,
                [[r['place_of_supply'], r['supply_type'], r['rate'],
                  r['taxable_value'], r['cgst'], r['sgst'], r['igst'],
                  r['total_tax']] for r in rows],
                preamble=_preamble('GSTR-1 B2C (Others) Summary', period, location),
            )
        return Response({'period': period, 'rows': rows,
                         'totals': data['totals'],
                         'b2cl_excluded': data['b2cl_excluded']})


class CreditNoteRegisterView(APIView):
    """GSTR-1 Table 9B shape: rate-wise credit-note rows (CDNR/CDNUR)."""

    COLUMNS = ['GSTIN', 'Party Name', 'Note No', 'Note Date',
               'Original Invoice No', 'Original Invoice Date', 'Type',
               'Supply Type', 'Rate (%)', 'Taxable Value', 'CGST', 'SGST',
               'IGST', 'Total', 'Time Barred', 'Reason']

    def get(self, request):
        period, err = _clean_period(request)
        if err:
            return err
        location = require_location_or_all_access(request)
        data = build_credit_note_register(period, location.id if location else None)
        rows = serialize_rows(data['rows'])

        if request.query_params.get('export') == 'csv':
            return csv_response(
                f'Credit_Note_Register_{period}.csv', self.COLUMNS,
                [[r['gstin'], r['party_name'], r['note_no'], r['note_date'],
                  r['original_invoice_no'], r['original_invoice_date'] or '',
                  r['note_type'], r['supply_type'], r['rate'],
                  r['taxable_value'], r['cgst'], r['sgst'], r['igst'],
                  r['total'], 'YES' if r['is_time_barred'] else '',
                  r['reason']] for r in rows],
                preamble=_preamble('Credit Note Register', period, location),
            )
        return Response({'period': period, 'rows': rows,
                         'totals': data['totals'],
                         'note_count': data['note_count']})


class GSTWorkingPapersView(APIView):
    """One .xlsx workbook per period with every register a CA needs to file:
    GSTR-3B summary, B2B register, B2C summary, HSN summary, documents
    issued, credit notes, purchase register and expense register."""

    def get(self, request):
        period, err = _clean_period(request)
        if err:
            return err
        location = require_location_or_all_access(request)
        loc_id = location.id if location else None
        start, end = period_date_range(period)

        from .models import GSTR1HSNSummary, GSTR3BSummary
        from .services import build_doc_summary
        from reports.registers import build_expense_register

        sheets = []

        # 1 — GSTR-3B summary (per location row; may not be generated yet)
        gstr3b_qs = GSTR3BSummary.objects.filter(period=period)
        if loc_id:
            gstr3b_qs = gstr3b_qs.filter(location_id=loc_id)
        summary_rows = [[
            s.location_id, str(s.outward_taxable), str(s.outward_cgst),
            str(s.outward_sgst), str(s.outward_igst), str(s.outward_zero_rated),
            str(s.outward_exempt), str(s.itc_cgst), str(s.itc_sgst),
            str(s.itc_igst), str(s.net_payable_cgst), str(s.net_payable_sgst),
            str(s.net_payable_igst), s.status,
        ] for s in gstr3b_qs.order_by('location_id')]
        if not summary_rows:
            summary_rows = [['GSTR-3B not generated for this period — '
                             'use Generate on the GSTR-3B screen first.']]
        sheets.append((
            'GSTR-3B Summary',
            _preamble('GST Working Papers', period, location),
            ['Location', 'Outward Taxable', 'Outward CGST', 'Outward SGST',
             'Outward IGST', 'Zero Rated', 'Exempt', 'ITC CGST', 'ITC SGST',
             'ITC IGST', 'Net Payable CGST', 'Net Payable SGST',
             'Net Payable IGST', 'Status'],
            summary_rows,
        ))

        # 2 — B2B register
        b2b = build_b2b_register(period, loc_id)
        sheets.append((
            'B2B Register', None, B2BRegisterView.COLUMNS,
            [[r['gstin'], r['party_name'], r['invoice_no'], r['invoice_date'],
              r['invoice_value'], r['place_of_supply'], r['supply_type'],
              r['rate'], r['taxable_value'], r['cgst'], r['sgst'], r['igst'],
              r['source']] for r in serialize_rows(b2b['rows'])],
        ))

        # 3 — B2C summary
        b2c = build_b2c_summary(period, loc_id)
        sheets.append((
            'B2C Summary', None, B2CSummaryView.COLUMNS,
            [[r['place_of_supply'], r['supply_type'], r['rate'],
              r['taxable_value'], r['cgst'], r['sgst'], r['igst'],
              r['total_tax']] for r in serialize_rows(b2c['rows'])],
        ))

        # 4 — HSN summary (stored Table 12 rows, B2B/B2C tabs)
        hsn_qs = GSTR1HSNSummary.objects.filter(period=period, is_active=True)
        if loc_id:
            hsn_qs = hsn_qs.filter(location_id=loc_id)
        sheets.append((
            'HSN Summary', None,
            ['HSN', 'Segment', 'Description', 'UQC', 'Quantity', 'Rate (%)',
             'Taxable Value', 'CGST', 'SGST', 'IGST'],
            [[h.hsn_code, h.segment, h.description, h.uqc, str(h.quantity),
              str(h.rate), str(h.taxable_value), str(h.cgst), str(h.sgst),
              str(h.igst)]
             for h in hsn_qs.order_by('hsn_code', 'segment', 'rate')],
        ))

        # 5 — Documents issued (Table 13)
        doc_rows = build_doc_summary(period, loc_id)
        sheets.append((
            'Documents Issued', None,
            ['Nature', 'Series', 'Sr. From', 'Sr. To', 'Total Issued',
             'Cancelled', 'Internal', 'Net Issued'],
            [[d['nature'], d['series'], d['sr_from'], d['sr_to'],
              d['total_issued'], d['cancelled'], d['internal'],
              d['net_issued']] for d in doc_rows],
        ))

        # 6 — Credit notes
        cn = build_credit_note_register(period, loc_id)
        sheets.append((
            'Credit Notes', None, CreditNoteRegisterView.COLUMNS,
            [[r['gstin'], r['party_name'], r['note_no'], r['note_date'],
              r['original_invoice_no'], r['original_invoice_date'] or '',
              r['note_type'], r['supply_type'], r['rate'], r['taxable_value'],
              r['cgst'], r['sgst'], r['igst'], r['total'],
              'YES' if r['is_time_barred'] else '', r['reason']]
             for r in serialize_rows(cn['rows'])],
        ))

        # 7 — Purchase register (month window)
        pur = build_purchase_register(start, end, loc_id)
        sheets.append((
            'Purchase Register', None,
            ['Supplier GSTIN', 'Supplier Name', 'Invoice No', 'Invoice Date',
             'Supply Type', 'Taxable Value', 'CGST', 'SGST', 'IGST',
             'Invoice Value'],
            [[r['supplier_gstin'], r['supplier_name'], r['invoice_no'],
              r['invoice_date'], r['supply_type'], r['taxable_value'],
              r['cgst'], r['sgst'], r['igst'], r['invoice_value']]
             for r in serialize_rows(pur['rows'])],
        ))

        # 8 — Expense register (month window; bills + direct expenses)
        exp = build_expense_register(start, end, loc_id)
        sheets.append((
            'Expense Register', None,
            ['Date', 'Voucher No', 'Source', 'Expense Head', 'Supplier',
             'GSTIN', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total'],
            [[r['date'], r['voucher_no'], r['source'], r['head'],
              r['party_name'], r['gstin'], r['taxable_value'], r['cgst'],
              r['sgst'], r['igst'], r['total']]
             for r in serialize_rows(exp['rows'])],
        ))

        suffix = f'_store{loc_id}' if loc_id else '_all-stores'
        return xlsx_response(f'GST_Working_Papers_{period}{suffix}.xlsx', sheets)

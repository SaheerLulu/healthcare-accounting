import csv
import io
from django.http import HttpResponse
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import TDSDeduction, TDSChallan, TDSRateConfig, TCSCollection, Form26ASEntry
from .serializers import (
    TDSDeductionSerializer, TDSChallanSerializer, TDSRateConfigSerializer,
    TCSCollectionSerializer, Form26ASEntrySerializer,
)
from .services import TDSService
from core.mixins import LocationFilterMixin, get_active_location
from audit.utils import log_action


class TDSRateConfigViewSet(viewsets.ModelViewSet):
    queryset = TDSRateConfig.objects.all()
    serializer_class = TDSRateConfigSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['section', 'deductee_type', 'is_active']
    pagination_class = None


class TDSDeductionViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = TDSDeduction.objects.all()
    serializer_class = TDSDeductionSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['section', 'status', 'deductee_type', 'source_type']
    ordering_fields = ['transaction_date', 'gross_amount', 'tds_amount', 'created_at']
    ordering = ['-transaction_date']

    def get_queryset(self):
        qs = super().get_queryset()
        period = self.request.query_params.get('period')
        if period:
            try:
                year, month = period.split('-')
                qs = qs.filter(transaction_date__year=int(year), transaction_date__month=int(month))
            except (ValueError, AttributeError):
                pass
        return qs

    @action(detail=False, methods=['get'], url_path='export-26q')
    def export_26q(self, request):
        quarter = request.query_params.get('quarter')
        location_id = request.query_params.get('location_id')

        if not quarter or not location_id:
            return Response({'error': 'quarter and location_id are required'}, status=status.HTTP_400_BAD_REQUEST)

        service = TDSService()
        try:
            summary = service.get_quarterly_summary(quarter, int(location_id))
        except (ValueError, KeyError) as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        response = HttpResponse(content_type='text/csv')
        filename = f"26Q_{quarter}_loc{location_id}.csv"
        response['Content-Disposition'] = f'attachment; filename="{filename}"'

        writer = csv.writer(response)
        writer.writerow(['Deductee Name', 'PAN', 'Section', 'Nature of Payment', 'Transaction Date', 'Gross Amount', 'TDS Rate (%)', 'TDS Amount', 'Deductee Type', 'Status', 'Challan No', 'Challan Date', 'BSR Code'])

        for deduction in summary['deductions']:
            writer.writerow([deduction.get('deductee_name', ''), deduction.get('deductee_pan', ''), deduction.get('section', ''), deduction.get('nature_of_payment', ''), deduction.get('transaction_date', ''), deduction.get('gross_amount', ''), deduction.get('tds_rate', ''), deduction.get('tds_amount', ''), deduction.get('deductee_type', ''), deduction.get('status', ''), deduction.get('challan_no', ''), deduction.get('challan_date', ''), deduction.get('bsr_code', '')])

        writer.writerow([])
        writer.writerow(['', '', '', '', 'TOTAL', summary['total_gross'], '', summary['total_tds']])

        return response

    @action(detail=False, methods=['get'], url_path='export-27q-fvu')
    def export_27q_fvu(self, request):
        """Form 27Q FVU text file — non-resident TDS quarterly return."""
        quarter = request.query_params.get('quarter')
        location_id = request.query_params.get('location_id')
        if not quarter or not location_id:
            return Response({'error': 'quarter and location_id are required'},
                            status=status.HTTP_400_BAD_REQUEST)
        service = TDSService()
        try:
            payload = service.export_27q_fvu(quarter, int(location_id))
        except (ValueError, KeyError) as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        response = HttpResponse(payload, content_type='text/plain')
        response['Content-Disposition'] = (
            f'attachment; filename="27Q_{quarter}_loc{location_id}.txt"'
        )
        return response

    @action(detail=False, methods=['get'], url_path='export-26q-fvu')
    def export_26q_fvu(self, request):
        """NSDL FVU-format text file for the quarterly e-TDS return."""
        quarter = request.query_params.get('quarter')
        location_id = request.query_params.get('location_id')
        if not quarter or not location_id:
            return Response({'error': 'quarter and location_id are required'},
                            status=status.HTTP_400_BAD_REQUEST)

        service = TDSService()
        try:
            payload = service.export_26q_fvu(quarter, int(location_id))
        except (ValueError, KeyError) as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        response = HttpResponse(payload, content_type='text/plain')
        response['Content-Disposition'] = (
            f'attachment; filename="26Q_{quarter}_loc{location_id}.txt"'
        )
        return response

    @action(detail=False, methods=['get'], url_path='form-16a')
    def form_16a(self, request):
        """Form-16A PDF certificate for one deductee for a quarter."""
        quarter = request.query_params.get('quarter')
        location_id = request.query_params.get('location_id')
        deductee_pan = request.query_params.get('deductee_pan', '')
        deductee_name = request.query_params.get('deductee_name', '')

        if not quarter or not location_id:
            return Response({'error': 'quarter and location_id are required'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not deductee_pan and not deductee_name:
            return Response({'error': 'deductee_pan or deductee_name is required'},
                            status=status.HTTP_400_BAD_REQUEST)

        service = TDSService()
        data = service.form_16a_data(quarter, int(location_id),
                                     deductee_pan=deductee_pan,
                                     deductee_name=deductee_name)
        if not data:
            return Response({'detail': 'No deductions found for this deductee in this quarter.'},
                            status=status.HTTP_404_NOT_FOUND)

        # Render PDF using reportlab
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib import colors
        from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                        TableStyle)

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=24, bottomMargin=24,
                                leftMargin=24, rightMargin=24)
        styles = getSampleStyleSheet()
        story = []

        story.append(Paragraph('<b>FORM No. 16A</b>', styles['Title']))
        story.append(Paragraph(
            '[See rule 31(1)(b)] — Certificate under Section 203 of the Income-tax Act, 1961, '
            'for tax deducted at source',
            styles['Normal']))
        story.append(Spacer(1, 12))

        deductor_block = (
            f"<b>Deductor</b><br/>"
            f"{data['deductor']['name'] or ''}<br/>"
            f"{(data['deductor']['address'] or '').replace(chr(10), '<br/>')}<br/>"
            f"PAN: {data['deductor']['pan'] or '-'}  &nbsp;  "
            f"TAN: {data['deductor']['tan'] or '-'}"
        )
        story.append(Paragraph(deductor_block, styles['Normal']))
        story.append(Spacer(1, 8))
        deductee_block = (
            f"<b>Deductee</b><br/>"
            f"{data['deductee']['name']}<br/>"
            f"PAN: {data['deductee']['pan']}"
        )
        story.append(Paragraph(deductee_block, styles['Normal']))
        story.append(Spacer(1, 8))
        story.append(Paragraph(f"<b>Quarter:</b> {data['quarter']}", styles['Normal']))
        story.append(Spacer(1, 12))

        table_data = [['Date', 'Section', 'Nature of payment', 'Amount paid', 'TDS rate', 'TDS deducted']]
        for r in data['rows']:
            table_data.append([
                r['transaction_date'], r['section'], r['nature_of_payment'],
                r['gross_amount'], f"{r['tds_rate']}%", r['tds_amount'],
            ])
        table_data.append(['', '', 'Total',
                           f"{data['total_paid']:.2f}", '',
                           f"{data['total_tds']:.2f}"])

        tbl = Table(table_data, repeatRows=1, hAlign='LEFT')
        tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e5e7eb')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.25, colors.grey),
            ('ALIGN', (3, 1), (5, -1), 'RIGHT'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 18))
        story.append(Paragraph(
            'Verified that the information given above is true, complete and correct.',
            styles['Italic']))
        story.append(Spacer(1, 32))
        story.append(Paragraph(
            f"For {data['deductor']['name']}<br/><br/>Authorised Signatory",
            styles['Normal']))

        doc.build(story)
        pdf_bytes = buf.getvalue()
        buf.close()

        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        ident = (deductee_pan or deductee_name).replace(' ', '_')
        response['Content-Disposition'] = (
            f'attachment; filename="Form16A_{quarter}_{ident}.pdf"'
        )
        return response


class TDSChallanViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = TDSChallan.objects.all()
    serializer_class = TDSChallanSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['section', 'period']
    ordering_fields = ['deposit_date', 'total_tds_amount', 'created_at']
    ordering = ['-deposit_date']
    http_method_names = ['get', 'post', 'head', 'options']

    @action(detail=False, methods=['post'], url_path='auto-generate')
    def auto_generate(self, request):
        section = request.data.get('section')
        period = request.data.get('period')

        if not section or not period:
            return Response({'error': 'section and period are required'}, status=status.HTTP_400_BAD_REQUEST)

        # Challans are store-scoped: explicit location_id in the body wins,
        # else the active store. Admin in All-Stores mode (no header) keeps
        # the company-wide sweep.
        location_id = request.data.get('location_id')
        if not location_id:
            location = get_active_location(request)
            location_id = location.id if location else None

        service = TDSService()
        challan = service.auto_generate_challan(section, period, location_id=location_id)
        if not challan:
            return Response({'detail': 'No pending deductions found for this section/period.'}, status=status.HTTP_404_NOT_FOUND)

        return Response(TDSChallanSerializer(challan).data)


class TCSCollectionViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = TCSCollection.objects.all()
    serializer_class = TCSCollectionSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['fy_label', 'status', 'buyer_id']
    ordering_fields = ['transaction_date', 'tcs_amount']
    ordering = ['-transaction_date']

    @action(detail=False, methods=['get'], url_path='fy-summary')
    def fy_summary(self, request):
        """Per-buyer TCS rolled up for a FY."""
        from django.db.models import Sum
        fy = request.query_params.get('fy_label')
        qs = self.get_queryset()
        if fy:
            qs = qs.filter(fy_label=fy)
        rows = list(
            qs.values('buyer_id', 'buyer_name', 'fy_label')
            .annotate(total_sales=Sum('sale_amount'),
                      total_taxable=Sum('taxable_amount'),
                      total_tcs=Sum('tcs_amount'))
            .order_by('-total_tcs')
        )
        return Response({'rows': rows, 'count': len(rows)})


class Form26ASViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    """Form 26AS — TDS deducted on payments received by the company.

    Workflow:
      1. POST /api/tds/form-26as/  with one row per 26AS line (manual entry
         or batch import from a parsed 26AS PDF/CSV).
      2. POST /api/tds/form-26as/reconcile/ to auto-match each 26AS row
         against TDS Receivable JE lines by (TAN, section, FY, amount).
      3. Review remaining unmatched rows and resolve manually.
    """
    queryset = Form26ASEntry.objects.all()
    serializer_class = Form26ASEntrySerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['fy_label', 'deductor_tan', 'section', 'match_status']
    ordering_fields = ['transaction_date', 'tds_amount']
    ordering = ['-transaction_date']

    @action(detail=False, methods=['post'], url_path='reconcile')
    def reconcile(self, request):
        """Match 26AS entries against TDS-Receivable JE lines.

        Heuristic: same FY + section + amount within ±₹1 → matched.
        ±5% tolerance → partial. Outside that → unmatched / mismatch.
        """
        from decimal import Decimal as _D
        from journals.models import JournalEntryLine
        from core.models import AccountMapping

        # 26AS reconciliation is TAN-level: match against EVERY TDS-Receivable
        # account (the shared default + all per-store clones), not just one.
        tds_recv_ids = list(
            AccountMapping.objects.filter(key='TDS_RECEIVABLE')
            .values_list('account_id', flat=True)
        )
        if not tds_recv_ids:
            return Response({'detail': 'TDS_RECEIVABLE mapping not configured'},
                            status=400)

        fy = request.data.get('fy_label')
        qs = self.get_queryset()
        if fy:
            qs = qs.filter(fy_label=fy)

        # Pre-load candidate JE lines (TDS Receivable debits in this FY)
        candidates = JournalEntryLine.objects.filter(
            account_id__in=tds_recv_ids, debit__gt=0, entry__is_posted=True,
        ).select_related('entry')

        matched = partial = unmatched = 0
        for row in qs.filter(match_status='unmatched'):
            best = None
            best_delta = None
            for c in candidates:
                if c.entry.date.year != row.transaction_date.year:
                    continue
                delta = abs(c.debit - row.tds_amount)
                if best_delta is None or delta < best_delta:
                    best, best_delta = c, delta
            if best is None:
                unmatched += 1
                continue
            tol = max(_D('1'), row.tds_amount * _D('0.05'))
            if best_delta <= _D('1'):
                row.match_status = 'matched'
                row.matched_journal_entry = best.entry
                matched += 1
            elif best_delta <= tol:
                row.match_status = 'partial'
                row.matched_journal_entry = best.entry
                partial += 1
            else:
                row.match_status = 'mismatch'
                unmatched += 1
            row.save(update_fields=['match_status', 'matched_journal_entry'])

        log_action('GENERATE', 'Form26ASEntry', fy or 'all',
                   f'26AS reconcile: matched={matched} partial={partial} '
                   f'unmatched={unmatched}', request=request)
        return Response({
            'fy_label': fy, 'matched': matched, 'partial': partial,
            'unmatched': unmatched,
        })

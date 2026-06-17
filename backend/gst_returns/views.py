import csv
import io
import json
from datetime import date, datetime
from decimal import Decimal

import django_filters
from django.http import HttpResponse
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .models import GSTR1Entry, GSTR1HSNSummary, GSTR3BSummary, GSTR2BEntry, ITCReconciliation, RCMEntry, EWayBill
from .serializers import (
    GSTR1EntrySerializer, GSTR1HSNSummarySerializer, GSTR3BSummarySerializer,
    GSTR2BEntrySerializer, ITCReconciliationSerializer, RCMEntrySerializer,
    EWayBillSerializer,
)
from .services import GSTR1Generator, GSTR3BGenerator, GSTR2BGenerator, ITCReconciliationService
from audit.utils import log_action
from core.mixins import (
    LocationFilterMixin, get_active_location, assert_location_access,
)

# Same cap as the bill/expense attachment uploads (MAX_ATTACHMENT_BYTES
# there) — nginx allows 100 MB, so the view must bound reads itself.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


class GSTR1EntryFilter(django_filters.FilterSet):
    period = django_filters.CharFilter(field_name='period')
    invoice_type = django_filters.CharFilter(field_name='invoice_type')
    source_type = django_filters.CharFilter(field_name='source_type')
    invoice_date_from = django_filters.DateFilter(field_name='invoice_date', lookup_expr='gte')
    invoice_date_to = django_filters.DateFilter(field_name='invoice_date', lookup_expr='lte')

    class Meta:
        model = GSTR1Entry
        fields = ['period', 'invoice_type', 'source_type']


class GSTR1EntryViewSet(LocationFilterMixin, viewsets.ReadOnlyModelViewSet):
    queryset = GSTR1Entry.objects.filter(is_active=True)
    serializer_class = GSTR1EntrySerializer
    filterset_class = GSTR1EntryFilter
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.OrderingFilter]
    ordering_fields = ['invoice_date', 'invoice_no', 'taxable_value']
    ordering = ['-invoice_date']
    pagination_class = None

    @action(detail=False, methods=['post'], url_path='generate')
    def generate(self, request):
        period = request.data.get('period')
        location_id = request.data.get('location_id')

        # Default to active location from header if not in body
        if not location_id:
            location = get_active_location(request)
            if location:
                location_id = location.id

        if not period or not location_id:
            return Response({'detail': 'Both period and location_id are required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            year, month = map(int, period.split('-'))
            if not (1 <= month <= 12):
                raise ValueError
        except (ValueError, AttributeError):
            return Response({'detail': 'period must be in YYYY-MM format.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            location_id = int(location_id)
        except (TypeError, ValueError):
            return Response({'detail': 'location_id must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)
        assert_location_access(request, location_id)

        generator = GSTR1Generator()
        try:
            summary = generator.generate(period=period, location_id=location_id)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        log_action('GENERATE', 'GSTR1Entry', period, f'GSTR-1 {period} Location #{location_id}', request=request, extra={'location_id': location_id})
        return Response(summary, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='export_csv')
    def export_csv(self, request):
        period = request.query_params.get('period')
        location = get_active_location(request)
        location_id = location.id if location else None

        qs = self.get_queryset()
        if period:
            qs = qs.filter(period=period)

        filename = f"GSTR1_{period or 'all'}_{location_id or 'all'}.csv"
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'

        writer = csv.writer(response)
        writer.writerow(['Period', 'Location ID', 'Invoice No', 'Invoice Date', 'Customer GSTIN', 'Invoice Type', 'Place of Supply', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'CESS', 'HSN Code', 'GST Rate (%)', 'Source Type', 'Source ID'])

        for entry in qs.order_by('invoice_date', 'invoice_no'):
            writer.writerow([entry.period, entry.location_id, entry.invoice_no, entry.invoice_date, entry.customer_gstin, entry.get_invoice_type_display(), entry.place_of_supply, entry.taxable_value, entry.cgst, entry.sgst, entry.igst, entry.cess, entry.hsn_code, entry.rate, entry.get_source_type_display(), entry.source_id])

        return response

    @action(detail=False, methods=['get'], url_path='doc-summary')
    def doc_summary(self, request):
        """GSTR-1 Table 13 — Documents Issued for the period (see
        services.build_doc_summary for the grouping rules)."""
        from .services import build_doc_summary

        period = request.query_params.get('period')
        if not period:
            return Response({'detail': 'period is required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            year, month = map(int, period.split('-'))
            if not (1 <= month <= 12):
                raise ValueError
        except (ValueError, AttributeError):
            return Response({'detail': 'period must be YYYY-MM.'},
                            status=status.HTTP_400_BAD_REQUEST)
        location = get_active_location(request)
        rows = build_doc_summary(period, location.id if location else None)
        return Response({'period': period, 'rows': rows})

    @action(detail=True, methods=['post'], url_path='generate-irn')
    def generate_irn_action(self, request, pk=None):
        """Compute and persist IRN/QR/ack for a single GSTR-1 entry."""
        from .einvoice import build_qr_payload, generate_irn_for_entry
        entry = self.get_object()
        try:
            generate_irn_for_entry(entry)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=400)
        from core.models import LocationTaxProfile
        qr = build_qr_payload(
            irn=entry.irn,
            supplier_gstin=LocationTaxProfile.resolve(entry.location_id).gstin,
            recipient_gstin=entry.customer_gstin or '',
            doc_no=entry.invoice_no,
            doc_date=entry.invoice_date,
            total_value=entry.taxable_value + entry.cgst + entry.sgst + entry.igst + entry.cess,
            total_igst=entry.igst,
            main_hsn=entry.hsn_code,
        )
        log_action('GENERATE', 'GSTR1Entry', entry.pk,
                   f'IRN {entry.irn[:10]}…', request=request)
        return Response({**GSTR1EntrySerializer(entry).data, 'qr_payload': qr})

    @action(detail=False, methods=['post'], url_path='generate-irn-bulk')
    def generate_irn_bulk(self, request):
        """Generate IRN for every B2B/CDNR entry in the period that doesn't have one yet."""
        from .einvoice import generate_irn_for_entry
        period = request.data.get('period')
        if not period:
            return Response({'detail': 'period required'}, status=400)
        qs = self.get_queryset().filter(period=period, irn='').exclude(invoice_type='NIL')
        n = 0
        errors = []
        for e in qs:
            try:
                generate_irn_for_entry(e)
                n += 1
            except Exception as exc:
                errors.append(f'{e.invoice_no}: {exc}')
        log_action('GENERATE', 'GSTR1Entry', period,
                   f'Bulk IRN: {n} generated', request=request)
        return Response({'period': period, 'generated': n, 'errors': errors})

    @action(detail=False, methods=['get'], url_path='export-json')
    def export_json(self, request):
        """
        WP 649 — GSTR-1 export in the JSON shape the GST portal accepts.
        Mirrors the official offline-tool schema for `b2b`, `b2cl`, `b2cs`,
        `cdnr` and `cdnur` sections.
        """
        period = request.query_params.get('period')
        if not period:
            return Response({'detail': 'period is required (YYYY-MM)'}, status=400)

        qs = self.get_queryset().filter(period=period)
        location = get_active_location(request)
        if location:
            qs = qs.filter(location_id=location.id)

        # Group by section
        sections = {'b2b': {}, 'b2cl': [], 'b2cs': [], 'cdnr': {}, 'cdnur': []}

        for e in qs:
            itm = {
                'num': 1,
                'itm_det': {
                    'txval': float(e.taxable_value),
                    'rt': float(e.rate),
                    'iamt': float(e.igst),
                    'camt': float(e.cgst),
                    'samt': float(e.sgst),
                    'csamt': float(e.cess),
                },
            }
            inv = {
                'inum': e.invoice_no,
                'idt': e.invoice_date.strftime('%d-%m-%Y'),
                'val': float(e.taxable_value + e.igst + e.cgst + e.sgst + e.cess),
                'pos': e.place_of_supply or '',
                'rchrg': 'N',
                'inv_typ': 'R',
                'itms': [itm],
            }
            if e.invoice_type == 'B2B':
                gstin = e.customer_gstin or 'UNKNOWN'
                sections['b2b'].setdefault(gstin, {'ctin': gstin, 'inv': []})
                sections['b2b'][gstin]['inv'].append(inv)
            elif e.invoice_type == 'B2C_LARGE':
                sections['b2cl'].append({**inv, 'pos': e.place_of_supply or ''})
            elif e.invoice_type == 'B2C_SMALL':
                sections['b2cs'].append({
                    'sply_ty': 'INTRA' if not e.igst else 'INTER',
                    'pos': e.place_of_supply or '',
                    'typ': 'OE',
                    'rt': float(e.rate),
                    'txval': float(e.taxable_value),
                    'iamt': float(e.igst),
                    'camt': float(e.cgst),
                    'samt': float(e.sgst),
                    'csamt': float(e.cess),
                })
            elif e.invoice_type in ('CDNR', 'CREDIT_NOTE', 'DEBIT_NOTE'):
                gstin = e.customer_gstin or 'UNKNOWN'
                sections['cdnr'].setdefault(gstin, {'ctin': gstin, 'nt': []})
                sections['cdnr'][gstin]['nt'].append({
                    'ntty': 'C' if e.invoice_type in ('CDNR', 'CREDIT_NOTE') else 'D',
                    'nt_num': e.invoice_no,
                    'nt_dt': e.invoice_date.strftime('%d-%m-%Y'),
                    'p_gst': 'N',
                    'inum': e.original_invoice_no or '',
                    'idt': (e.original_invoice_date.strftime('%d-%m-%Y')
                            if e.original_invoice_date else ''),
                    'val': float(e.taxable_value + e.igst + e.cgst + e.sgst + e.cess),
                    'itms': [itm],
                })
            elif e.invoice_type == 'CDNUR':
                sections['cdnur'].append({
                    'ntty': 'C',
                    'nt_num': e.invoice_no,
                    'nt_dt': e.invoice_date.strftime('%d-%m-%Y'),
                    'val': float(e.taxable_value + e.igst + e.cgst + e.sgst + e.cess),
                    'itms': [itm],
                })

        # Table 12 — HSN summary, Phase-3 bifurcated into B2B / B2C tabs
        # (offline-tool schema: hsn.hsn_b2b / hsn.hsn_b2c).
        hsn_qs = GSTR1HSNSummary.objects.filter(period=period, is_active=True)
        if location:
            hsn_qs = hsn_qs.filter(location_id=location.id)
        hsn_b2b, hsn_b2c = [], []
        for i, h in enumerate(hsn_qs.order_by('segment', 'hsn_code', 'rate'), start=1):
            row = {
                'num': i,
                'hsn_sc': h.hsn_code,
                'desc': (h.description or '')[:30],
                'uqc': h.uqc or 'NOS',
                'qty': float(h.quantity),
                'rt': float(h.rate),
                'txval': float(h.taxable_value),
                'iamt': float(h.igst),
                'camt': float(h.cgst),
                'samt': float(h.sgst),
                'csamt': 0,
            }
            (hsn_b2b if h.segment == 'B2B' else hsn_b2c).append(row)

        # Table 13 — Documents Issued. Portal doc_num codes: 1 = Invoices for
        # outward supply, 5 = Credit Note.
        from .services import build_doc_summary
        DOC_NUM = {'Invoices for outward supply': 1, 'Credit Note': 5}
        doc_groups = {}
        for r in build_doc_summary(period, location.id if location else None):
            doc_num = DOC_NUM.get(r['nature'])
            if doc_num is None:
                continue
            grp = doc_groups.setdefault(doc_num, {'doc_num': doc_num, 'docs': []})
            grp['docs'].append({
                'num': len(grp['docs']) + 1,
                'from': r['sr_from'],
                'to': r['sr_to'],
                'totnum': r['total_issued'],
                'cancel': r['cancelled'],
                'net_issue': r['net_issued'],
            })

        # Convert dict groupings to portal-style list shape
        from core.models import LocationTaxProfile
        payload = {
            # Filer GSTIN of the store this export is scoped to.
            'gstin': LocationTaxProfile.resolve(location.id if location else None).gstin,
            'fp': period.replace('-', ''),
            'gt': 0,
            'cur_gt': 0,
            'b2b': list(sections['b2b'].values()),
            'b2cl': sections['b2cl'],
            'b2cs': sections['b2cs'],
            'cdnr': list(sections['cdnr'].values()),
            'cdnur': sections['cdnur'],
            'hsn': {'hsn_b2b': hsn_b2b, 'hsn_b2c': hsn_b2c},
            'doc_issue': {'doc_det': sorted(doc_groups.values(), key=lambda g: g['doc_num'])},
        }

        response = HttpResponse(json.dumps(payload, indent=2),
                                content_type='application/json')
        response['Content-Disposition'] = (
            f'attachment; filename="GSTR1_{period}.json"'
        )
        return response


class GSTR1HSNSummaryViewSet(LocationFilterMixin, viewsets.ReadOnlyModelViewSet):
    queryset = GSTR1HSNSummary.objects.filter(is_active=True)
    serializer_class = GSTR1HSNSummarySerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend]
    filterset_fields = ['period']
    pagination_class = None


class GSTR3BSummaryFilter(django_filters.FilterSet):
    period = django_filters.CharFilter(field_name='period')
    status = django_filters.CharFilter(field_name='status')

    class Meta:
        model = GSTR3BSummary
        fields = ['period', 'status']


class GSTR3BSummaryViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = GSTR3BSummary.objects.all()
    serializer_class = GSTR3BSummarySerializer
    filterset_class = GSTR3BSummaryFilter
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.OrderingFilter]
    ordering_fields = ['period', 'created_at', 'updated_at']
    ordering = ['-period']

    @action(detail=False, methods=['post'], url_path='generate')
    def generate(self, request):
        period = request.data.get('period')
        location_id = request.data.get('location_id')

        if not location_id:
            location = get_active_location(request)
            if location:
                location_id = location.id

        if not period or not location_id:
            return Response({'detail': 'Both period and location_id are required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            year, month = map(int, period.split('-'))
            if not (1 <= month <= 12):
                raise ValueError
        except (ValueError, AttributeError):
            return Response({'detail': 'period must be in YYYY-MM format.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            location_id = int(location_id)
        except (TypeError, ValueError):
            return Response({'detail': 'location_id must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)
        assert_location_access(request, location_id)

        existing = GSTR3BSummary.objects.filter(period=period, location_id=location_id).first()
        if existing and existing.status == 'filed':
            return Response({'detail': 'Cannot regenerate a filed GSTR-3B return.'}, status=status.HTTP_400_BAD_REQUEST)

        generator = GSTR3BGenerator()
        try:
            summary = generator.generate(period=period, location_id=location_id)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        log_action('GENERATE', 'GSTR3BSummary', period, f'GSTR-3B {period} Location #{location_id}', request=request, extra={'location_id': location_id})
        serializer = GSTR3BSummarySerializer(summary)
        return Response(serializer.data, status=status.HTTP_200_OK)


class GSTR9View(viewsets.ViewSet):
    """GSTR-9 Annual Return — POST {fy_start_year, location_id} → JSON payload."""

    def create(self, request):
        from .annual_return import generate_gstr9
        try:
            fy = int(request.data.get('fy_start_year'))
            loc = int(request.data.get('location_id'))
        except (TypeError, ValueError):
            return Response({'detail': 'fy_start_year and location_id are required ints'},
                            status=400)
        assert_location_access(request, loc)
        try:
            payload = generate_gstr9(fy_start_year=fy, location_id=loc)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=500)
        log_action('GENERATE', 'GSTR9', f'{fy}-{loc}',
                   f'GSTR-9 for FY {fy}-{fy+1} location {loc}', request=request)
        return Response(payload)


class EWayBillViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    """e-Way Bill register + NIC-portal payload export."""
    queryset = EWayBill.objects.all()
    serializer_class = EWayBillSerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['status', 'supply_type', 'reference_type', 'from_gstin']
    ordering_fields = ['invoice_date', 'generated_date']
    ordering = ['-invoice_date']

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'EWayBill', instance.pk, str(instance), request=self.request)

    @action(detail=True, methods=['get'], url_path='nic-payload')
    def nic_payload(self, request, pk=None):
        """JSON payload formatted for the NIC e-Way Bill portal API."""
        ewb = self.get_object()
        return Response(ewb.to_nic_payload())

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        ewb = self.get_object()
        if ewb.status == 'cancelled':
            return Response({'detail': 'Already cancelled.'}, status=400)
        ewb.status = 'cancelled'
        ewb.cancellation_reason = request.data.get('reason', '')
        ewb.save(update_fields=['status', 'cancellation_reason', 'updated_at'])
        log_action('UPDATE', 'EWayBill', ewb.pk,
                   f'Cancelled e-Way Bill {ewb.eway_bill_no}', request=request,
                   extra={'reason': ewb.cancellation_reason})
        return Response(EWayBillSerializer(ewb).data)


class GSTR9CView(viewsets.ViewSet):
    """GSTR-9C Reconciliation Statement (turnover > ₹5 Cr).

    POST body:
      fy_start_year, location_id  — required
      audited_turnover, audited_taxable_turnover, audited_total_tax_paid,
      audited_itc_availed         — optional; if omitted, defaults to GSTR-9 figure.
    """

    def create(self, request):
        from .gstr9c import generate_gstr9c
        try:
            fy = int(request.data.get('fy_start_year'))
            loc = int(request.data.get('location_id'))
        except (TypeError, ValueError):
            return Response({'detail': 'fy_start_year and location_id required ints'},
                            status=400)
        assert_location_access(request, loc)
        try:
            payload = generate_gstr9c(
                fy_start_year=fy, location_id=loc,
                audited_turnover=request.data.get('audited_turnover'),
                audited_taxable_turnover=request.data.get('audited_taxable_turnover'),
                audited_total_tax_paid=request.data.get('audited_total_tax_paid'),
                audited_itc_availed=request.data.get('audited_itc_availed'),
            )
        except Exception as exc:
            return Response({'detail': str(exc)}, status=500)
        log_action('GENERATE', 'GSTR9C', f'{fy}-{loc}',
                   f'GSTR-9C for FY {fy}-{fy+1} location {loc}', request=request)
        return Response(payload)


class GSTLateFeeView(viewsets.ViewSet):
    """GET /api/gst/late-fee/?due_date=YYYY-MM-DD&payment_date=…&tax_amount=…&return_type=gstr3b"""

    def list(self, request):
        from .annual_return import gstr_late_fee_and_interest
        try:
            due = date.fromisoformat(request.query_params['due_date'])
            paid = date.fromisoformat(request.query_params['payment_date'])
            tax = Decimal(request.query_params.get('tax_amount', '0'))
        except (KeyError, ValueError) as exc:
            return Response({'detail': f'Invalid params: {exc}'}, status=400)
        rt = request.query_params.get('return_type', 'gstr3b')
        return Response(gstr_late_fee_and_interest(
            due_date=due, payment_date=paid, tax_amount=tax, return_type=rt,
        ))


class GSTSetoffPreviewView(viewsets.ViewSet):
    """Pure-compute endpoint: GET /api/gst/setoff-preview/?itc_igst=...&out_igst=... etc.

    Wraps `core.gst_setoff.compute_gst_setoff` so the UI can show users
    exactly how IGST → CGST → SGST credits will be applied per Sec 49(2)(b)
    before they finalise GSTR-3B.
    """

    def list(self, request):
        from core.gst_setoff import compute_gst_setoff

        def _num(name):
            try:
                return Decimal(request.query_params.get(name, '0') or '0')
            except Exception:
                return Decimal('0')

        result = compute_gst_setoff(
            itc_igst=_num('itc_igst'), itc_cgst=_num('itc_cgst'), itc_sgst=_num('itc_sgst'),
            out_igst=_num('out_igst'), out_cgst=_num('out_cgst'), out_sgst=_num('out_sgst'),
        )
        # Decimals → str so JSON renderer is happy
        def _stringify(d):
            if isinstance(d, dict):
                return {k: _stringify(v) for k, v in d.items()}
            if isinstance(d, Decimal):
                return f'{d:.2f}'
            return d
        return Response(_stringify(result))


class GSTR2BEntryViewSet(LocationFilterMixin, viewsets.ReadOnlyModelViewSet):
    queryset = GSTR2BEntry.objects.all()
    serializer_class = GSTR2BEntrySerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['period', 'match_status', 'itc_eligible']
    ordering = ['-invoice_date']
    pagination_class = None

    @action(detail=False, methods=['post'], url_path='generate')
    def generate(self, request):
        period = request.data.get('period')
        location_id = request.data.get('location_id')

        if not location_id:
            location = get_active_location(request)
            if location:
                location_id = location.id

        if not period or not location_id:
            return Response({'detail': 'Both period and location_id are required.'}, status=status.HTTP_400_BAD_REQUEST)
        assert_location_access(request, location_id)

        generator = GSTR2BGenerator()
        try:
            result = generator.generate(period=period, location_id=int(location_id))
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        log_action('GENERATE', 'GSTR2BEntry', period, f'GSTR-2B {period} Location #{location_id}', request=request)
        return Response(result)

    @action(detail=True, methods=['patch'], url_path='toggle-itc')
    def toggle_itc(self, request, pk=None):
        entry = self.get_object()
        entry.itc_eligible = not entry.itc_eligible
        entry.save()
        return Response(GSTR2BEntrySerializer(entry).data)

    @action(detail=False, methods=['post'], url_path='upload-json',
            parser_classes=[JSONParser, MultiPartParser, FormParser])
    def upload_json(self, request):
        """
        WP 651 — accept the official GSTR-2B JSON download and create
        GSTR2BEntry rows. Deduplicates on (period, supplier_gstin,
        invoice_no, invoice_date).
        """
        period = request.data.get('period') or request.query_params.get('period')
        location_id = request.data.get('location_id') or request.query_params.get('location_id')

        if not period or not location_id:
            return Response({'detail': 'period and location_id are required'},
                            status=400)
        try:
            location_id = int(location_id)
        except (TypeError, ValueError):
            return Response({'detail': 'location_id must be an integer'}, status=400)
        assert_location_access(request, location_id)

        # JSON payload may come as request.data['payload'] (string) or
        # as a multipart file upload at request.FILES['file'].
        raw = None
        if 'file' in request.FILES:
            upload = request.FILES['file']
            # Bound the read before touching the content — uploads spill to
            # disk with no framework limit and nginx allows 100 MB.
            if upload.size > MAX_UPLOAD_BYTES:
                mb = MAX_UPLOAD_BYTES // (1024 * 1024)
                return Response({'detail': f'File too large. Max {mb} MB.'},
                                status=400)
            ctype = (upload.content_type or '').lower()
            name = (upload.name or '').lower()
            if not (name.endswith('.json')
                    or ctype in ('application/json', 'text/json')):
                return Response(
                    {'detail': 'Upload the GSTR-2B JSON file downloaded from '
                               'the portal (.json).'},
                    status=400,
                )
            raw = upload.read().decode('utf-8', errors='replace')
        elif 'payload' in request.data:
            raw = request.data['payload']
        else:
            raw = request.body.decode('utf-8', errors='replace')

        try:
            doc = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError as exc:
            return Response({'detail': f'Invalid JSON: {exc}'}, status=400)

        # GSTR-2B JSON schema: data → docdata → b2b → [{ ctin, supname, inv: [...] }]
        # Some downloads put it under data.docdata, others put it directly under data.
        data = doc.get('data', doc)
        docdata = data.get('docdata') or data
        b2b_groups = docdata.get('b2b') or []
        cdnr_groups = docdata.get('cdnr') or []

        created = 0
        skipped = 0
        for grp in b2b_groups:
            ctin = grp.get('ctin') or grp.get('GSTIN') or ''
            supname = grp.get('supname') or grp.get('trdnm') or ''
            for inv in (grp.get('inv') or []):
                inv_no = inv.get('inum') or inv.get('invoice_no') or ''
                inv_dt = inv.get('idt') or inv.get('invoice_date') or ''
                inv_date = _parse_gst_date(inv_dt)
                if not inv_no or not inv_date:
                    skipped += 1
                    continue
                taxable = Decimal(str(inv.get('txval', 0) or 0))
                cgst = Decimal(str(inv.get('camt', 0) or 0))
                sgst = Decimal(str(inv.get('samt', 0) or 0))
                igst = Decimal(str(inv.get('iamt', 0) or 0))
                pos = inv.get('pos') or ''
                obj, was_created = GSTR2BEntry.objects.update_or_create(
                    period=period, location_id=location_id,
                    supplier_gstin=ctin, invoice_no=inv_no,
                    invoice_date=inv_date,
                    defaults={
                        'supplier_name': supname,
                        'place_of_supply': pos,
                        'taxable_value': taxable,
                        'cgst': cgst, 'sgst': sgst, 'igst': igst,
                    },
                )
                if was_created:
                    created += 1
                else:
                    skipped += 1

        # Credit/debit notes too
        for grp in cdnr_groups:
            ctin = grp.get('ctin') or ''
            supname = grp.get('supname') or grp.get('trdnm') or ''
            for nt in (grp.get('nt') or []):
                nt_no = nt.get('nt_num') or ''
                nt_dt = nt.get('nt_dt') or ''
                nt_date = _parse_gst_date(nt_dt)
                if not nt_no or not nt_date:
                    skipped += 1
                    continue
                sign = -1 if (nt.get('ntty') or '').upper() == 'C' else 1
                taxable = Decimal(str(nt.get('txval', 0) or 0)) * sign
                cgst = Decimal(str(nt.get('camt', 0) or 0)) * sign
                sgst = Decimal(str(nt.get('samt', 0) or 0)) * sign
                igst = Decimal(str(nt.get('iamt', 0) or 0)) * sign
                obj, was_created = GSTR2BEntry.objects.update_or_create(
                    period=period, location_id=location_id,
                    supplier_gstin=ctin, invoice_no=nt_no,
                    invoice_date=nt_date,
                    defaults={
                        'supplier_name': supname,
                        'taxable_value': taxable,
                        'cgst': cgst, 'sgst': sgst, 'igst': igst,
                    },
                )
                if was_created:
                    created += 1
                else:
                    skipped += 1

        log_action('GENERATE', 'GSTR2BEntry', period,
                   f'GSTR-2B JSON upload: {created} created, {skipped} skipped',
                   request=request,
                   extra={'period': period, 'location_id': location_id,
                          'created': created, 'skipped': skipped})
        return Response({'created': created, 'skipped_or_updated': skipped,
                         'period': period, 'location_id': location_id})


def _parse_gst_date(value):
    """Parse '01-04-2026' (DD-MM-YYYY) or '2026-04-01' or '01/04/2026'."""
    if not value:
        return None
    if hasattr(value, 'isoformat'):
        return value
    for fmt in ('%d-%m-%Y', '%Y-%m-%d', '%d/%m/%Y', '%d-%b-%Y'):
        try:
            return datetime.strptime(value, fmt).date()
        except (ValueError, TypeError):
            continue
    return None


class ITCReconciliationViewSet(LocationFilterMixin, viewsets.ReadOnlyModelViewSet):
    queryset = ITCReconciliation.objects.all()
    serializer_class = ITCReconciliationSerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend]
    filterset_fields = ['period', 'status']
    pagination_class = None

    @action(detail=False, methods=['get'], url_path='discrepancies-csv')
    def discrepancies_csv(self, request):
        """WP 654 — export discrepancies (mismatch / unmatched) as CSV."""
        period = request.query_params.get('period')
        location = get_active_location(request)
        location_id = location.id if location else None

        qs = self.get_queryset().exclude(status='matched')
        if period:
            qs = qs.filter(period=period)
        if location_id:
            qs = qs.filter(location_id=location_id)

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = (
            f'attachment; filename="ITC_Discrepancies_{period or "all"}.csv"'
        )
        writer = csv.writer(response)
        writer.writerow([
            'Period', 'Supplier GSTIN', 'Status',
            'Books Taxable', 'Books CGST', 'Books SGST', 'Books IGST',
            'GSTR-2B Taxable', 'GSTR-2B CGST', 'GSTR-2B SGST', 'GSTR-2B IGST',
            'Δ Taxable', 'Δ CGST', 'Δ SGST', 'Δ IGST', 'Action Taken',
        ])
        for r in qs.order_by('period', 'supplier_gstin'):
            writer.writerow([
                r.period, r.supplier_gstin, r.get_status_display(),
                r.books_taxable, r.books_cgst, r.books_sgst, r.books_igst,
                r.gstr2b_taxable, r.gstr2b_cgst, r.gstr2b_sgst, r.gstr2b_igst,
                r.books_taxable - r.gstr2b_taxable,
                r.books_cgst - r.gstr2b_cgst,
                r.books_sgst - r.gstr2b_sgst,
                r.books_igst - r.gstr2b_igst,
                r.action_taken,
            ])
        return response

    @action(detail=False, methods=['post'], url_path='run')
    def run(self, request):
        period = request.data.get('period')
        location_id = request.data.get('location_id')

        if not location_id:
            location = get_active_location(request)
            if location:
                location_id = location.id

        if not period or not location_id:
            return Response({'detail': 'Both period and location_id are required.'}, status=status.HTTP_400_BAD_REQUEST)
        assert_location_access(request, location_id)

        service = ITCReconciliationService()
        try:
            result = service.reconcile(period=period, location_id=int(location_id))
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        log_action('GENERATE', 'ITCReconciliation', period, f'ITC Recon {period} Location #{location_id}', request=request)
        return Response(result)


class RCMEntryViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = RCMEntry.objects.all()
    serializer_class = RCMEntrySerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend]
    filterset_fields = ['period']
    ordering = ['-period']

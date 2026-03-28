import csv
import django_filters
from django.http import HttpResponse
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import GSTR1Entry, GSTR1HSNSummary, GSTR3BSummary, GSTR2BEntry, ITCReconciliation, RCMEntry
from .serializers import (
    GSTR1EntrySerializer, GSTR1HSNSummarySerializer, GSTR3BSummarySerializer,
    GSTR2BEntrySerializer, ITCReconciliationSerializer, RCMEntrySerializer,
)
from .services import GSTR1Generator, GSTR3BGenerator, GSTR2BGenerator, ITCReconciliationService
from audit.utils import log_action
from core.mixins import LocationFilterMixin, get_active_location


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


class ITCReconciliationViewSet(LocationFilterMixin, viewsets.ReadOnlyModelViewSet):
    queryset = ITCReconciliation.objects.all()
    serializer_class = ITCReconciliationSerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend]
    filterset_fields = ['period', 'status']
    pagination_class = None

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

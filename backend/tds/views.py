import csv
from django.http import HttpResponse
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import TDSDeduction, TDSChallan, TDSRateConfig
from .serializers import TDSDeductionSerializer, TDSChallanSerializer, TDSRateConfigSerializer
from .services import TDSService
from core.mixins import LocationFilterMixin


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


class TDSChallanViewSet(viewsets.ModelViewSet):
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

        service = TDSService()
        challan = service.auto_generate_challan(section, period)
        if not challan:
            return Response({'detail': 'No pending deductions found for this section/period.'}, status=status.HTTP_404_NOT_FOUND)

        return Response(TDSChallanSerializer(challan).data)

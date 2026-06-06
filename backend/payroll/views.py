from django.http import HttpResponse
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Employee, SalaryStructure, PayrollRun
from .serializers import EmployeeSerializer, SalaryStructureSerializer, PayrollRunSerializer
from .services import (
    PayrollService, generate_payslip_pdf, generate_bank_disbursement_file,
    generate_epfo_ecr_file, generate_esi_contribution_file,
)
from audit.utils import log_action
from core.mixins import LocationFilterMixin, get_active_location


class EmployeeViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = Employee.objects.all()
    serializer_class = EmployeeSerializer
    pagination_class = None

    def perform_create(self, serializer):
        location = get_active_location(self.request)
        extra = {}
        if location and 'location_id' not in serializer.validated_data:
            extra['location_id'] = location.id
        instance = serializer.save(**extra)
        log_action('CREATE', 'Employee', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'Employee', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        log_action('DELETE', 'Employee', instance.pk, str(instance), request=self.request)
        instance.delete()


class SalaryStructureViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = SalaryStructure.objects.select_related('employee').all()
    serializer_class = SalaryStructureSerializer
    pagination_class = None
    # Scope through the employee's store (SalaryStructure has no own location).
    location_field = 'employee__location_id'

    def get_queryset(self):
        qs = super().get_queryset()  # LocationFilterMixin scopes via employee__location_id
        employee_id = self.request.query_params.get('employee_id')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'SalaryStructure', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'SalaryStructure', instance.pk, str(instance), request=self.request)


class PayrollRunViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PayrollRun.objects.select_related('employee', 'journal_entry').all()
    serializer_class = PayrollRunSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        period = self.request.query_params.get('period')
        if period:
            qs = qs.filter(period=period)
        return qs

    @action(detail=False, methods=['post'], url_path='process')
    def process_payroll(self, request):
        period = request.data.get('period')
        location_id = request.data.get('location_id')
        if not period:
            return Response({'detail': 'period is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            svc = PayrollService()
            runs = svc.process_payroll(period, location_id)
            log_action('CREATE', 'PayrollRun', 'batch', f'Processed {len(runs)} payroll runs for {period}',
                       request=request)
            return Response({
                'detail': f'Processed {len(runs)} payroll runs',
                'runs': PayrollRunSerializer(runs, many=True).data,
            }, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='mark-paid')
    def mark_paid(self, request, pk=None):
        try:
            svc = PayrollService()
            run = svc.mark_paid(pk)
            log_action('UPDATE', 'PayrollRun', run.pk, f'Marked paid: {run}', request=request)
            return Response(PayrollRunSerializer(run).data)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'], url_path='payslip')
    def payslip(self, request, pk=None):
        try:
            run = PayrollRun.objects.select_related('employee').get(pk=pk)
        except PayrollRun.DoesNotExist:
            return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        pdf = generate_payslip_pdf(run)
        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = (
            f'attachment; filename="payslip_{run.period}_{run.employee.employee_code}.pdf"'
        )
        return response

    @action(detail=False, methods=['get'], url_path='ecr')
    def ecr(self, request):
        """EPFO Electronic Challan-cum-Return file (PF + EPS + EDLI)."""
        period = request.query_params.get('period')
        if not period:
            return Response({'detail': 'period required'}, status=status.HTTP_400_BAD_REQUEST)
        location_id = request.query_params.get('location_id')
        text = generate_epfo_ecr_file(period, int(location_id) if location_id else None)
        response = HttpResponse(text, content_type='text/plain')
        response['Content-Disposition'] = (
            f'attachment; filename="ecr_{period}.txt"'
        )
        return response

    @action(detail=False, methods=['get'], url_path='esi')
    def esi(self, request):
        """ESIC contribution upload CSV."""
        period = request.query_params.get('period')
        if not period:
            return Response({'detail': 'period required'}, status=status.HTTP_400_BAD_REQUEST)
        location_id = request.query_params.get('location_id')
        text = generate_esi_contribution_file(period, int(location_id) if location_id else None)
        response = HttpResponse(text, content_type='text/csv')
        response['Content-Disposition'] = (
            f'attachment; filename="esi_{period}.csv"'
        )
        return response

    @action(detail=False, methods=['get'], url_path='bank-disbursement')
    def bank_disbursement(self, request):
        period = request.query_params.get('period')
        location_id = request.query_params.get('location_id')
        fmt = request.query_params.get('format', 'csv')
        if not period:
            return Response({'detail': 'period is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = generate_bank_disbursement_file(
                period, int(location_id) if location_id else None, fmt
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        ext = 'csv' if fmt == 'csv' else 'txt'
        response = HttpResponse(payload, content_type='text/plain' if ext == 'txt' else 'text/csv')
        response['Content-Disposition'] = (
            f'attachment; filename="salary_disbursement_{period}.{ext}"'
        )
        return response

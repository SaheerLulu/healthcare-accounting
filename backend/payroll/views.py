from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Employee, SalaryStructure, PayrollRun
from .serializers import EmployeeSerializer, SalaryStructureSerializer, PayrollRunSerializer
from .services import PayrollService
from audit.utils import log_action


class EmployeeViewSet(viewsets.ModelViewSet):
    queryset = Employee.objects.all()
    serializer_class = EmployeeSerializer
    pagination_class = None

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'Employee', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'Employee', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        log_action('DELETE', 'Employee', instance.pk, str(instance), request=self.request)
        instance.delete()


class SalaryStructureViewSet(viewsets.ModelViewSet):
    queryset = SalaryStructure.objects.select_related('employee').all()
    serializer_class = SalaryStructureSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
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

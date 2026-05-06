from datetime import date as date_cls

from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from audit.utils import log_action
from core.mixins import LocationFilterMixin

from .models import EMISchedule, Loan
from .serializers import EMIScheduleSerializer, LoanSerializer
from .services import compute_emi, generate_schedule, pay_emi, post_disbursement


class LoanViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = Loan.objects.select_related(
        'liability_account', 'interest_expense_account',
    ).prefetch_related('emi_schedule')
    serializer_class = LoanSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if (s := self.request.query_params.get('status')):
            qs = qs.filter(status=s)
        return qs

    def perform_create(self, serializer):
        from datetime import timedelta
        instance = serializer.save(
            created_by=self.request.user if self.request.user.is_authenticated else None,
        )
        # Compute EMI + end_date now that we have the values
        instance.emi_amount = compute_emi(
            instance.principal_amount, instance.interest_rate_pct,
            instance.tenure_months,
        )
        # end_date = start + tenure months (last installment due date)
        from calendar import monthrange
        y, m = instance.start_date.year, instance.start_date.month
        m += instance.tenure_months
        y += (m - 1) // 12
        m = ((m - 1) % 12) + 1
        last_day = monthrange(y, m)[1]
        from datetime import date as date_cls
        instance.end_date = date_cls(y, m, min(instance.emi_day, last_day))
        instance.save(update_fields=['emi_amount', 'end_date'])

        # Generate the amortization schedule immediately
        generate_schedule(instance)
        log_action('CREATE', 'Loan', instance.pk, str(instance),
                   request=self.request, extra={'emi': str(instance.emi_amount)})

    @action(detail=True, methods=['get'], url_path='schedule')
    def schedule(self, request, pk=None):
        loan = self.get_object()
        rows = loan.emi_schedule.all()
        return Response({
            'rows': EMIScheduleSerializer(rows, many=True).data,
            'count': rows.count(),
            'outstanding_principal': str(loan.outstanding_principal),
        })

    @action(detail=True, methods=['post'], url_path='post-disbursement')
    def disburse(self, request, pk=None):
        loan = self.get_object()
        try:
            je = post_disbursement(
                loan, mode=request.data.get('mode', 'bank'),
                user=request.user if request.user.is_authenticated else None,
            )
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('POST', 'Loan', loan.pk,
                   f'Disbursement JE {je.entry_no}', request=request)
        return Response(LoanSerializer(loan).data)


class EMIPayView(viewsets.ViewSet):
    """POST /api/loans/emi/{id}/pay/ — mark a scheduled EMI as paid."""

    def create(self, request, *args, **kwargs):
        emi_id = request.data.get('emi_id')
        if not emi_id:
            return Response({'detail': 'emi_id is required'}, status=400)
        emi = get_object_or_404(EMISchedule, pk=emi_id)
        try:
            payment_date = (date_cls.fromisoformat(request.data['payment_date'])
                            if request.data.get('payment_date') else None)
            je = pay_emi(emi, payment_date=payment_date,
                         mode=request.data.get('mode', 'bank'),
                         user=request.user if request.user.is_authenticated else None)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('POST', 'EMISchedule', emi.pk,
                   f'EMI {emi.installment_no} paid via {je.entry_no}',
                   request=request)
        return Response(EMIScheduleSerializer(emi).data)

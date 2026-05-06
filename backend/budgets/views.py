from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from audit.utils import log_action

from .models import Budget
from .serializers import BudgetSerializer
from .services import variance_report


class BudgetViewSet(viewsets.ModelViewSet):
    queryset = Budget.objects.select_related('account')
    serializer_class = BudgetSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        if (p := self.request.query_params.get('period')):
            qs = qs.filter(period=p)
        if (loc := self.request.query_params.get('location_id')):
            qs = qs.filter(location_id=int(loc))
        if (cc := self.request.query_params.get('cost_center')):
            qs = qs.filter(cost_center=cc)
        return qs

    def perform_create(self, serializer):
        instance = serializer.save(
            created_by=self.request.user if self.request.user.is_authenticated else None,
        )
        log_action('CREATE', 'Budget', instance.pk, str(instance), request=self.request)


class BudgetVarianceView(viewsets.ViewSet):
    """GET /api/budgets/variance/?period=2026-04&period_kind=monthly"""

    def list(self, request):
        period = request.query_params.get('period')
        if not period:
            return Response({'detail': 'period required'}, status=status.HTTP_400_BAD_REQUEST)
        period_kind = request.query_params.get('period_kind', 'monthly')
        location_id = request.query_params.get('location_id')
        cost_center = request.query_params.get('cost_center')
        try:
            payload = variance_report(
                period=period, period_kind=period_kind,
                location_id=int(location_id) if location_id else None,
                cost_center=cost_center,
            )
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(payload)

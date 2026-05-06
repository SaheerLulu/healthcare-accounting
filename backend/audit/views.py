import csv

import django_filters
from django.http import HttpResponse
from rest_framework import generics, filters
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogFilter(django_filters.FilterSet):
    action = django_filters.CharFilter(field_name='action')
    model_name = django_filters.CharFilter(field_name='model_name')
    object_id = django_filters.CharFilter(field_name='object_id')
    date_from = django_filters.DateTimeFilter(field_name='timestamp', lookup_expr='gte')
    date_to = django_filters.DateTimeFilter(field_name='timestamp', lookup_expr='lte')
    user = django_filters.CharFilter(field_name='user__username', lookup_expr='iexact')

    class Meta:
        model = AuditLog
        fields = ['action', 'model_name', 'object_id', 'date_from', 'date_to', 'user']


class AuditLogListView(generics.ListAPIView):
    """
    Read-only list of audit log events.
    Filter by: action, model_name, object_id, date_from, date_to, user.
    """
    queryset = AuditLog.objects.select_related('user').order_by('-timestamp')
    serializer_class = AuditLogSerializer
    filterset_class = AuditLogFilter
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.SearchFilter]
    search_fields = ['object_repr', 'model_name', 'user__username']


class AuditLogCSVExportView(APIView):
    """WP 672 — CSV export of filtered audit log."""

    def get(self, request):
        qs = AuditLog.objects.select_related('user').order_by('-timestamp')
        f = AuditLogFilter(request.query_params, queryset=qs)
        qs = f.qs[:50000]  # cap

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = (
            'attachment; filename="audit_log.csv"'
        )
        w = csv.writer(response)
        w.writerow(['Timestamp', 'User', 'Action', 'Model', 'Object ID',
                    'Object', 'IP', 'Changes', 'Extra', 'Prev Hash', 'Content Hash'])
        for row in qs.iterator():
            w.writerow([
                row.timestamp.isoformat(),
                row.user.username if row.user else '',
                row.action, row.model_name, row.object_id,
                row.object_repr, row.ip_address or '',
                row.changes or '', row.extra or '',
                row.prev_hash, row.content_hash,
            ])
        return response


class AuditChainVerifyView(APIView):
    """WP 673 — verify the tamper-evident hash chain. Returns first break or null."""

    def get(self, request):
        from .utils import verify_chain
        result = verify_chain()
        if result is None:
            return Response({'ok': True, 'message': 'Chain intact.'})
        return Response({'ok': False, **result}, status=409)

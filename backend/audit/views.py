import django_filters
from rest_framework import generics, filters
from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogFilter(django_filters.FilterSet):
    action = django_filters.CharFilter(field_name='action')
    model_name = django_filters.CharFilter(field_name='model_name')
    object_id = django_filters.CharFilter(field_name='object_id')
    date_from = django_filters.DateTimeFilter(field_name='timestamp', lookup_expr='gte')
    date_to = django_filters.DateTimeFilter(field_name='timestamp', lookup_expr='lte')

    class Meta:
        model = AuditLog
        fields = ['action', 'model_name', 'object_id', 'date_from', 'date_to']


class AuditLogListView(generics.ListAPIView):
    """
    Read-only list of audit log events.
    Filter by: action, model_name, object_id, date_from, date_to.
    """
    queryset = AuditLog.objects.select_related('user').order_by('-timestamp')
    serializer_class = AuditLogSerializer
    filterset_class = AuditLogFilter
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.SearchFilter]
    search_fields = ['object_repr', 'model_name', 'user__username']

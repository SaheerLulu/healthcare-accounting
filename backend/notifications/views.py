from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Notification
from .serializers import NotificationSerializer
from .services import generate_alerts


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """Notifications visible to the current user (or their role).

    GET  /api/notifications/         — own + role-broadcast unread, newest first
    POST /api/notifications/{id}/read/  — mark single notification as read
    POST /api/notifications/mark-all-read/  — bulk mark
    POST /api/notifications/generate/       — admin trigger for the alert rules
    """
    serializer_class = NotificationSerializer

    def get_queryset(self):
        qs = Notification.objects.all().order_by('-created_at')
        user = self.request.user
        if user.is_authenticated and not user.is_superuser:
            from django.db.models import Q
            # Resolve user's role codes
            try:
                from core.models import AccountingRole
                role_codes = list(
                    AccountingRole.objects.filter(users=user).values_list('code', flat=True)
                )
            except Exception as exc:
                import logging
                logging.getLogger('notifications').warning(
                    'Could not resolve AccountingRole codes for user %s: %s',
                    user.id, exc,
                )
                role_codes = []
            qs = qs.filter(Q(user=user) | Q(user__isnull=True, role_code__in=role_codes))
        params = self.request.query_params
        if params.get('unread') == 'true':
            qs = qs.filter(is_read=False)
        if (k := params.get('kind')):
            qs = qs.filter(kind=k)
        if (p := params.get('priority')):
            qs = qs.filter(priority=p)
        return qs

    @action(detail=True, methods=['post'], url_path='read')
    def mark_read(self, request, pk=None):
        n = self.get_object()
        if not n.is_read:
            n.is_read = True
            n.read_at = timezone.now()
            n.save(update_fields=['is_read', 'read_at'])
        return Response(NotificationSerializer(n).data)

    @action(detail=False, methods=['post'], url_path='mark-all-read')
    def mark_all_read(self, request):
        qs = self.get_queryset().filter(is_read=False)
        n = qs.update(is_read=True, read_at=timezone.now())
        return Response({'marked_read': n})

    @action(detail=False, methods=['post'], url_path='generate')
    def generate(self, request):
        """Admin endpoint — trigger alert generation right now."""
        result = generate_alerts()
        return Response(result)

    @action(detail=False, methods=['get'], url_path='counts')
    def counts(self, request):
        from django.db.models import Count
        qs = self.get_queryset().filter(is_read=False)
        by_priority = {row['priority']: row['count']
                       for row in qs.values('priority').annotate(count=Count('id'))}
        return Response({'unread_total': qs.count(), 'by_priority': by_priority})

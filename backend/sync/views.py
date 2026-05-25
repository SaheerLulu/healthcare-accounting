from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import serializers, status
from .services import InventorySyncService, full_resync
from .models import SyncLog, SyncError
from audit.utils import log_action


class SyncLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncLog
        fields = '__all__'


class SyncErrorSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncError
        fields = '__all__'


class SyncRunView(APIView):
    def post(self, request):
        service = InventorySyncService()
        result = service.sync_all()
        log_action('SYNC', 'SyncLog', '', 'Inventory Sync', request=request, extra=result)
        return Response({'status': 'success', 'result': result})


class SyncLogListView(APIView):
    def get(self, request):
        """Optional ?sync_type=X filter so the UI can show a single type's history."""
        qs = SyncLog.objects.all()
        sync_type = request.query_params.get('sync_type')
        if sync_type:
            qs = qs.filter(sync_type=sync_type)
        serializer = SyncLogSerializer(qs[:50], many=True)
        return Response(serializer.data)


class SyncRetryView(APIView):
    def post(self, request):
        service = InventorySyncService()
        result = service.retry_failed()
        log_action('SYNC', 'SyncError', '', 'Retry failed syncs', request=request, extra=result)
        return Response({'status': 'success', 'result': result})


class SyncErrorListView(APIView):
    def get(self, request):
        """Default returns unresolved errors. Pass ?include_resolved=true to
        see everything, or ?status=resolved/open to filter explicitly."""
        qs = SyncError.objects.all()
        s = request.query_params.get('status')
        include_resolved = request.query_params.get('include_resolved', '').lower() in ('true', '1', 'yes')
        if s == 'resolved':
            qs = qs.filter(resolved=True)
        elif s == 'open' or (not include_resolved and not s):
            qs = qs.filter(resolved=False)
        sync_type = request.query_params.get('sync_type')
        if sync_type:
            qs = qs.filter(sync_type=sync_type)
        serializer = SyncErrorSerializer(qs[:200], many=True)
        return Response(serializer.data)


class SyncErrorResolveView(APIView):
    """POST /api/sync/errors/{pk}/resolve/ — flip resolved=True without retrying."""
    def post(self, request, pk):
        try:
            err = SyncError.objects.get(pk=pk)
        except SyncError.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not err.resolved:
            err.resolved = True
            err.save(update_fields=['resolved', 'updated_at'])
            log_action('UPDATE', 'SyncError', err.pk,
                       f'Manually resolved {err.sync_type}:{err.source_id}',
                       request=request)
        return Response(SyncErrorSerializer(err).data)


class FullResyncView(APIView):
    """
    WP 668 — full re-sync.

    GET  /api/sync/full-resync/  → dry-run count (safe, read-only).
    POST /api/sync/full-resync/  → wipe + regenerate. Requires `confirm=true`
                                   in the body to defeat accidental clicks.
    """

    def get(self, request):
        return Response(full_resync(dry_run=True))

    def post(self, request):
        if not str(request.data.get('confirm', '')).lower() in ('true', '1', 'yes'):
            return Response(
                {'detail': 'Pass {"confirm": true} to actually run a full re-sync.',
                 'preview': full_resync(dry_run=True)},
                status=400,
            )
        result = full_resync(dry_run=False)
        log_action('SYNC', 'JournalEntry', 'full-resync',
                   f"Full re-sync wiped {result['wiped_entries']} entries",
                   request=request, extra=result)
        return Response(result)

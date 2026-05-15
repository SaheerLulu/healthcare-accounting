from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import serializers
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
        logs = SyncLog.objects.all()[:50]
        serializer = SyncLogSerializer(logs, many=True)
        return Response(serializer.data)


class SyncRetryView(APIView):
    def post(self, request):
        service = InventorySyncService()
        result = service.retry_failed()
        log_action('SYNC', 'SyncError', '', 'Retry failed syncs', request=request, extra=result)
        return Response({'status': 'success', 'result': result})


class SyncErrorListView(APIView):
    def get(self, request):
        errors = SyncError.objects.filter(resolved=False)[:50]
        serializer = SyncErrorSerializer(errors, many=True)
        return Response(serializer.data)


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

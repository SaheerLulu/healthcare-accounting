from django.contrib import admin
from .models import SyncLog


@admin.register(SyncLog)
class SyncLogAdmin(admin.ModelAdmin):
    list_display = [
        'sync_type',
        'last_synced_id',
        'last_synced_at',
        'records_processed',
        'status',
    ]
    list_filter = ['sync_type', 'status']
    readonly_fields = [
        'sync_type',
        'last_synced_id',
        'last_synced_at',
        'records_processed',
        'status',
        'error_message',
    ]
    ordering = ['-last_synced_at']

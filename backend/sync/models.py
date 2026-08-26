from django.db import models


class SyncLog(models.Model):
    SYNC_TYPES = [
        ('purchase', 'Purchase Orders'),
        ('pos', 'POS Orders'),
        ('b2b', 'B2B Sales Orders'),
        ('return', 'Sales Returns'),
        ('purchase_return', 'Purchase Returns'),
        ('b2b_amendment', 'B2B Invoice Amendments'),
        ('all', 'All'),
    ]

    sync_type = models.CharField(max_length=20, choices=SYNC_TYPES)
    last_synced_id = models.PositiveIntegerField(default=0)
    last_synced_at = models.DateTimeField(auto_now=True)
    records_processed = models.IntegerField(default=0)
    # Track how many records failed (logged as SyncError) during this run.
    # Distinct from records_processed which counts successes only.
    error_count = models.IntegerField(default=0)
    # Wall-clock duration of the most recent run, useful to spot stalled syncs.
    duration_seconds = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, default='success')
    error_message = models.TextField(blank=True)

    class Meta:
        ordering = ['-last_synced_at']

    def __str__(self):
        return f"{self.sync_type} sync at {self.last_synced_at}"

    @classmethod
    def get_last_id(cls, sync_type: str) -> int:
        log = cls.objects.filter(sync_type=sync_type).first()
        return log.last_synced_id if log else 0


class SyncError(models.Model):
    """Tracks individual sync failures for retry."""
    sync_type = models.CharField(max_length=20)
    source_id = models.PositiveIntegerField()
    error_message = models.TextField()
    traceback = models.TextField(blank=True)
    retry_count = models.IntegerField(default=0)
    max_retries = models.IntegerField(default=3)
    resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['sync_type', 'resolved']),
        ]

    def __str__(self):
        return f"SyncError {self.sync_type}:{self.source_id} (retries: {self.retry_count})"

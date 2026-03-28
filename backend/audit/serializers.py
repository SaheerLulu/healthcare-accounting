from rest_framework import serializers
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = [
            'id', 'timestamp', 'username', 'action',
            'model_name', 'object_id', 'object_repr',
            'changes', 'ip_address', 'extra',
        ]

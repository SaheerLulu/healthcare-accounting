from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = [
            'id', 'user', 'role_code', 'kind', 'title', 'body', 'priority',
            'link_url', 'related_model', 'related_id',
            'is_read', 'read_at', 'created_at', 'expires_at',
        ]
        read_only_fields = ['id', 'created_at']

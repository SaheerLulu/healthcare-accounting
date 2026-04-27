from rest_framework import serializers
from .models import PartyCommunication, PartyOpeningBalance


class PartyCommunicationSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = PartyCommunication
        fields = [
            'id', 'party_type', 'party_id', 'channel', 'direction',
            'subject', 'body', 'contact', 'communicated_at',
            'created_at', 'created_by', 'created_by_username',
        ]
        read_only_fields = ['id', 'created_at', 'created_by', 'created_by_username']


class PartyOpeningBalanceSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = PartyOpeningBalance
        fields = [
            'id', 'party_type', 'party_id', 'amount', 'as_of_date', 'narration',
            'created_at', 'updated_at', 'created_by', 'created_by_username',
        ]
        read_only_fields = ['id', 'party_type', 'party_id',
                            'created_at', 'updated_at', 'created_by', 'created_by_username']

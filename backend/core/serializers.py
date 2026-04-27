from django.db.models import Count
from rest_framework import serializers
from .models import AccountingSettings, ChartOfAccount, AccountMapping


class AccountingSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountingSettings
        fields = [
            'id', 'company_name', 'gstin', 'tan', 'state_code',
            'financial_year_start', 'registered_address', 'pan',
            'is_fy_closed', 'last_closed_fy',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ChartOfAccountSerializer(serializers.ModelSerializer):
    parent_code = serializers.CharField(source='parent.account_code', read_only=True, default=None)
    parent_name = serializers.CharField(source='parent.account_name', read_only=True, default=None)
    documents_count = serializers.SerializerMethodField()

    class Meta:
        model = ChartOfAccount
        fields = [
            'id', 'account_code', 'account_name', 'account_type',
            'account_subtype', 'parent', 'parent_code', 'parent_name',
            'is_leaf', 'is_active', 'description',
            'documents_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'is_leaf', 'created_at', 'updated_at']

    def get_documents_count(self, obj):
        # If the queryset annotated this, prefer it; otherwise fall back to a query.
        annotated = getattr(obj, '_documents_count', None)
        if annotated is not None:
            return annotated
        return obj.journal_lines.count()


class ChartOfAccountTreeSerializer(serializers.ModelSerializer):
    children = serializers.SerializerMethodField()

    class Meta:
        model = ChartOfAccount
        fields = [
            'id', 'account_code', 'account_name', 'account_type',
            'account_subtype', 'parent', 'is_leaf', 'is_active',
            'description', 'children',
        ]

    def get_children(self, obj):
        child_qs = obj.children.all().order_by('account_code')
        return ChartOfAccountTreeSerializer(child_qs, many=True).data


class AccountMappingSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source='account.account_code', read_only=True)
    account_name = serializers.CharField(source='account.account_name', read_only=True)

    class Meta:
        model = AccountMapping
        fields = ['id', 'key', 'account', 'account_code', 'account_name']

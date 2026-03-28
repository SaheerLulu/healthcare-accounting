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
    class Meta:
        model = ChartOfAccount
        fields = [
            'id', 'account_code', 'account_name', 'account_type',
            'account_subtype', 'parent', 'is_leaf', 'description',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ChartOfAccountTreeSerializer(serializers.ModelSerializer):
    children = serializers.SerializerMethodField()

    class Meta:
        model = ChartOfAccount
        fields = [
            'id', 'account_code', 'account_name', 'account_type',
            'account_subtype', 'parent', 'is_leaf', 'description', 'children',
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

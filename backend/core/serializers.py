from django.db.models import Count
from rest_framework import serializers
from .models import AccountingSettings, ChartOfAccount, AccountMapping, CostCategory, CostCentre
from .period_lock import LockedPeriod


class CostCategorySerializer(serializers.ModelSerializer):
    centre_count = serializers.SerializerMethodField()

    class Meta:
        model = CostCategory
        fields = [
            'id', 'name', 'description',
            'allocate_revenue', 'allocate_non_revenue',
            'is_active', 'centre_count',
        ]

    def get_centre_count(self, obj):
        return obj.centres.count()


class CostCentreSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    parent_name = serializers.CharField(source='parent.name', read_only=True, default=None)

    class Meta:
        model = CostCentre
        fields = [
            'id', 'name', 'code',
            'category', 'category_name',
            'parent', 'parent_name',
            'location_id', 'is_active', 'description',
        ]


class AccountingSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountingSettings
        fields = [
            'id', 'company_name', 'gstin', 'tan', 'state_code',
            'financial_year_start', 'registered_address', 'pan',
            'is_fy_closed', 'last_closed_fy', 'bill_approval_threshold',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_financial_year_start(self, value):
        # An out-of-range month (e.g. the UI's misleading 'MM-DD' field letting
        # '13' through) makes date(year, month, 1) raise deep in the Dashboard
        # and FY/period-lock math → HTTP 500 with the Dashboard inaccessible.
        if value is not None and not (1 <= value <= 12):
            raise serializers.ValidationError(
                'Financial year start must be a month number between 1 and 12.'
            )
        return value


class ChartOfAccountSerializer(serializers.ModelSerializer):
    parent_code = serializers.CharField(source='parent.account_code', read_only=True, default=None)
    parent_name = serializers.CharField(source='parent.account_name', read_only=True, default=None)
    documents_count = serializers.SerializerMethodField()

    class Meta:
        model = ChartOfAccount
        fields = [
            'id', 'account_code', 'account_name', 'account_type',
            'account_subtype', 'parent', 'parent_code', 'parent_name',
            'location_id', 'is_leaf', 'is_active', 'description',
            'party_type', 'party_id',
            'documents_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'is_leaf', 'party_type', 'party_id',
                            'created_at', 'updated_at']

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
        # location_id exposed since 53f6624c so the UI can read/write
        # per-store overrides; NULL = the shared default applies.
        fields = ['id', 'key', 'account', 'account_code', 'account_name', 'location_id']

    def validate_account(self, account):
        # Every auto-generated posting routes through these mappings, and
        # JournalEntryLine.save() rejects non-leaf accounts — so a mapping to a
        # group/inactive account doesn't fail here but bricks an entire posting
        # category (payroll, COGS-sync, bills, year-end) the moment it's used.
        if not account.is_leaf:
            raise serializers.ValidationError(
                f'{account.account_code} {account.account_name} is a group account; '
                f'map to a leaf account that can be posted to.'
            )
        if not account.is_active:
            raise serializers.ValidationError(
                f'{account.account_code} {account.account_name} is inactive.'
            )
        return account


class LockedPeriodSerializer(serializers.ModelSerializer):
    locked_by_name = serializers.CharField(source='locked_by.username', read_only=True, default=None)

    class Meta:
        model = LockedPeriod
        fields = ['id', 'period', 'locked_at', 'locked_by', 'locked_by_name', 'reason']
        read_only_fields = ['id', 'locked_at', 'locked_by_name']

    def validate_period(self, value):
        import re
        if not re.fullmatch(r'\d{4}-\d{2}', value):
            raise serializers.ValidationError("Period must be in YYYY-MM format.")
        month = int(value.split('-')[1])
        if not 1 <= month <= 12:
            raise serializers.ValidationError("Month must be 01-12.")
        return value

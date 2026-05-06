from rest_framework import serializers

from .models import AssetClass, DepreciationEntry, FixedAsset


class AssetClassSerializer(serializers.ModelSerializer):
    asset_account_code = serializers.CharField(source='asset_account.account_code', read_only=True)
    accum_dep_account_code = serializers.CharField(source='accum_dep_account.account_code', read_only=True)
    dep_expense_account_code = serializers.CharField(source='dep_expense_account.account_code', read_only=True)

    class Meta:
        model = AssetClass
        fields = ['id', 'code', 'name', 'description',
                  'dep_method', 'useful_life_years', 'salvage_value_pct', 'wdv_rate_pct',
                  'asset_account', 'asset_account_code',
                  'accum_dep_account', 'accum_dep_account_code',
                  'dep_expense_account', 'dep_expense_account_code']


class FixedAssetSerializer(serializers.ModelSerializer):
    asset_class_name = serializers.CharField(source='asset_class.name', read_only=True)
    accumulated_depreciation = serializers.SerializerMethodField()
    net_book_value = serializers.SerializerMethodField()
    acquisition_entry_no = serializers.CharField(
        source='acquisition_journal_entry.entry_no', read_only=True, default=None,
    )

    class Meta:
        model = FixedAsset
        fields = [
            'id', 'asset_no', 'name', 'description', 'asset_class', 'asset_class_name',
            'location_id', 'serial_no', 'vendor_name', 'vendor_id',
            'acquisition_date', 'acquisition_cost', 'salvage_value', 'useful_life_months',
            'status', 'disposal_date', 'disposal_proceeds', 'gain_loss_on_disposal',
            'acquisition_journal_entry', 'acquisition_entry_no', 'disposal_journal_entry',
            'accumulated_depreciation', 'net_book_value',
            'notes', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'status', 'disposal_date', 'disposal_proceeds',
                            'gain_loss_on_disposal', 'acquisition_journal_entry',
                            'disposal_journal_entry', 'created_at', 'updated_at']

    def get_accumulated_depreciation(self, obj):
        return str(obj.accumulated_depreciation())

    def get_net_book_value(self, obj):
        return str(obj.net_book_value())


class DepreciationEntrySerializer(serializers.ModelSerializer):
    asset_no = serializers.CharField(source='fixed_asset.asset_no', read_only=True)
    entry_no = serializers.CharField(source='journal_entry.entry_no', read_only=True, default=None)

    class Meta:
        model = DepreciationEntry
        fields = ['id', 'fixed_asset', 'asset_no', 'period', 'amount', 'method',
                  'journal_entry', 'entry_no', 'created_at']

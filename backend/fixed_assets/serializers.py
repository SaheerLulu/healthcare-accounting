from decimal import Decimal

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

    # Once the acquisition JE is posted (immutable) or depreciation has run,
    # these are locked — changing them desyncs the register from the GL and
    # mis-computes every future depreciation charge.
    FROZEN_AFTER_POST = (
        'acquisition_cost', 'acquisition_date', 'salvage_value',
        'asset_class', 'useful_life_months',
    )

    def validate(self, data):
        # A negative cost books a reversed (Cr Asset / Dr Bank) acquisition JE
        # that the balance check can't catch; salvage > cost makes the
        # depreciable base negative so the asset never depreciates.
        cost = data.get('acquisition_cost',
                        getattr(self.instance, 'acquisition_cost', None))
        salvage = data.get('salvage_value',
                           getattr(self.instance, 'salvage_value', None))
        if cost is not None and cost <= 0:
            raise serializers.ValidationError(
                {'acquisition_cost': 'Acquisition cost must be greater than zero.'}
            )
        if cost is not None and salvage is not None and not (Decimal('0') <= salvage <= cost):
            raise serializers.ValidationError(
                {'salvage_value': 'Salvage value must be between 0 and the acquisition cost.'}
            )

        inst = self.instance
        if inst is not None and (
            inst.acquisition_journal_entry_id is not None
            or inst.depreciation_entries.exists()
        ):
            for field in self.FROZEN_AFTER_POST:
                if field in data and data[field] != getattr(inst, field):
                    raise serializers.ValidationError({
                        field: 'Cannot change this once the acquisition entry is posted or '
                               'depreciation has run — reverse/adjust via a new entry instead.'
                    })
        return data

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

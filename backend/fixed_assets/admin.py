from django.contrib import admin

from .models import AssetClass, DepreciationEntry, FixedAsset


@admin.register(AssetClass)
class AssetClassAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'dep_method', 'useful_life_years', 'wdv_rate_pct')
    search_fields = ('code', 'name')


@admin.register(FixedAsset)
class FixedAssetAdmin(admin.ModelAdmin):
    list_display = ('asset_no', 'name', 'asset_class', 'acquisition_date',
                    'acquisition_cost', 'status')
    list_filter = ('status', 'asset_class', 'location_id')
    search_fields = ('asset_no', 'name', 'serial_no')


@admin.register(DepreciationEntry)
class DepreciationEntryAdmin(admin.ModelAdmin):
    list_display = ('fixed_asset', 'period', 'amount', 'method', 'journal_entry')
    list_filter = ('period', 'method')

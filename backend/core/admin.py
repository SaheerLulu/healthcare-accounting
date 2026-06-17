from django.contrib import admin
from .models import AccountingSettings, ChartOfAccount, LocationTaxProfile


@admin.register(AccountingSettings)
class AccountingSettingsAdmin(admin.ModelAdmin):
    list_display = ['company_name', 'gstin', 'pan', 'state_code', 'financial_year_start', 'updated_at']
    readonly_fields = ['created_at', 'updated_at']

    def has_add_permission(self, request):
        if AccountingSettings.objects.exists():
            return False
        return super().has_add_permission(request)

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(LocationTaxProfile)
class LocationTaxProfileAdmin(admin.ModelAdmin):
    list_display = ['location_id', 'gstin', 'state_code', 'legal_name', 'updated_at']
    search_fields = ['location_id', 'gstin', 'legal_name']
    readonly_fields = ['created_at', 'updated_at']
    ordering = ['location_id']


@admin.register(ChartOfAccount)
class ChartOfAccountAdmin(admin.ModelAdmin):
    list_display = ['account_code', 'account_name', 'account_type', 'account_subtype', 'parent', 'is_leaf']
    list_filter = ['account_type', 'account_subtype', 'is_leaf']
    search_fields = ['account_code', 'account_name']
    readonly_fields = ['created_at', 'updated_at']
    ordering = ['account_code']

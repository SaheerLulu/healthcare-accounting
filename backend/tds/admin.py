from django.contrib import admin
from .models import TDSDeduction, TDSChallan


@admin.register(TDSDeduction)
class TDSDeductionAdmin(admin.ModelAdmin):
    list_display = [
        'deductee_name',
        'deductee_pan',
        'section',
        'transaction_date',
        'gross_amount',
        'tds_rate',
        'tds_amount',
        'status',
        'location_id',
    ]
    list_filter = ['section', 'status', 'deductee_type', 'source_type']
    search_fields = ['deductee_name', 'deductee_pan', 'challan_no']
    ordering = ['-transaction_date']
    date_hierarchy = 'transaction_date'


@admin.register(TDSChallan)
class TDSChallanAdmin(admin.ModelAdmin):
    list_display = [
        'challan_no',
        'bsr_code',
        'period',
        'section',
        'deposit_date',
        'total_tds_amount',
    ]
    list_filter = ['section', 'period']
    search_fields = ['challan_no', 'bsr_code']
    ordering = ['-deposit_date']
    filter_horizontal = ['deductions']

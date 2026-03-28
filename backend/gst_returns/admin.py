from django.contrib import admin
from .models import GSTR1Entry, GSTR3BSummary


@admin.register(GSTR1Entry)
class GSTR1EntryAdmin(admin.ModelAdmin):
    list_display = [
        'period',
        'location_id',
        'invoice_no',
        'invoice_date',
        'invoice_type',
        'customer_gstin',
        'taxable_value',
        'cgst',
        'sgst',
        'igst',
        'source_type',
        'source_id',
    ]
    list_filter = ['period', 'invoice_type', 'source_type']
    search_fields = ['invoice_no', 'customer_gstin', 'hsn_code']
    ordering = ['-invoice_date']
    readonly_fields = ['created_at']

    fieldsets = [
        ('Invoice Details', {
            'fields': [
                'period',
                'location_id',
                'invoice_no',
                'invoice_date',
                'customer_gstin',
                'invoice_type',
                'place_of_supply',
            ],
        }),
        ('Tax Amounts', {
            'fields': ['taxable_value', 'cgst', 'sgst', 'igst', 'cess', 'rate', 'hsn_code'],
        }),
        ('Source', {
            'fields': ['source_type', 'source_id', 'created_at'],
        }),
    ]


@admin.register(GSTR3BSummary)
class GSTR3BSummaryAdmin(admin.ModelAdmin):
    list_display = [
        'period',
        'location_id',
        'outward_taxable',
        'outward_cgst',
        'outward_sgst',
        'outward_igst',
        'itc_cgst',
        'itc_sgst',
        'net_payable_cgst',
        'net_payable_sgst',
        'status',
        'filed_date',
    ]
    list_filter = ['period', 'status']
    search_fields = ['period']
    ordering = ['-period']
    readonly_fields = ['created_at', 'updated_at']

    fieldsets = [
        ('Period & Location', {
            'fields': ['period', 'location_id', 'status', 'filed_date'],
        }),
        ('3.1 Outward Supplies', {
            'fields': [
                'outward_taxable',
                'outward_igst',
                'outward_cgst',
                'outward_sgst',
                'outward_zero_rated',
            ],
        }),
        ('4. Input Tax Credit (ITC)', {
            'fields': ['itc_igst', 'itc_cgst', 'itc_sgst'],
        }),
        ('Net Tax Payable', {
            'fields': ['net_payable_igst', 'net_payable_cgst', 'net_payable_sgst'],
        }),
        ('Timestamps', {
            'fields': ['created_at', 'updated_at'],
            'classes': ['collapse'],
        }),
    ]

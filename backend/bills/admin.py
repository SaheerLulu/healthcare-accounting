from django.contrib import admin
from .models import Bill, BillLine, BillPayment, RecurringBill, RecurringBillItem


class BillLineInline(admin.TabularInline):
    model = BillLine
    extra = 0


class BillPaymentInline(admin.TabularInline):
    model = BillPayment
    extra = 0
    readonly_fields = ('journal_entry', 'created_at')


@admin.register(Bill)
class BillAdmin(admin.ModelAdmin):
    list_display = ('bill_no', 'vendor_name', 'bill_date', 'due_date',
                    'total_amount', 'amount_paid', 'status')
    list_filter = ('status',)
    search_fields = ('bill_no', 'vendor_name', 'notes')
    inlines = [BillLineInline, BillPaymentInline]
    readonly_fields = ('amount_paid', 'status', 'journal_entry', 'created_at', 'updated_at')


@admin.register(BillPayment)
class BillPaymentAdmin(admin.ModelAdmin):
    list_display = ('bill', 'date', 'amount', 'mode', 'reference')
    list_filter = ('mode',)
    readonly_fields = ('journal_entry', 'created_at')


class RecurringBillItemInline(admin.TabularInline):
    model = RecurringBillItem
    extra = 0


@admin.register(RecurringBill)
class RecurringBillAdmin(admin.ModelAdmin):
    list_display = ('profile_name', 'vendor_name', 'frequency', 'next_run_date',
                    'total_amount', 'status', 'auto_approve')
    list_filter = ('status', 'frequency', 'auto_approve')
    search_fields = ('profile_name', 'vendor_name')
    inlines = [RecurringBillItemInline]
    readonly_fields = ('last_run_date', 'last_error', 'created_at', 'updated_at')

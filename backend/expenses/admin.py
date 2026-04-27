from django.contrib import admin
from .models import Expense, ExpenseItem, ExpenseAttachment


class ExpenseItemInline(admin.TabularInline):
    model = ExpenseItem
    extra = 0


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ('expense_date', 'vendor_name', 'paid_through_account', 'total_amount', 'status')
    list_filter = ('status',)
    search_fields = ('vendor_name', 'reference', 'notes')
    inlines = [ExpenseItemInline]
    readonly_fields = ('status', 'journal_entry', 'created_at', 'updated_at')


@admin.register(ExpenseAttachment)
class ExpenseAttachmentAdmin(admin.ModelAdmin):
    list_display = ('expense', 'original_name', 'content_type', 'size', 'uploaded_at')

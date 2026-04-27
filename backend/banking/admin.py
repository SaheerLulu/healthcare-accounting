from django.contrib import admin
from .models import BankAccount, BankTransaction


@admin.register(BankAccount)
class BankAccountAdmin(admin.ModelAdmin):
    list_display = ('name', 'account_type', 'bank_name', 'chart_account', 'is_active')
    list_filter = ('account_type', 'is_active')
    search_fields = ('name', 'bank_name', 'account_number')


@admin.register(BankTransaction)
class BankTransactionAdmin(admin.ModelAdmin):
    list_display = ('date', 'bank_account', 'description', 'amount', 'status', 'matched_journal_entry')
    list_filter = ('status', 'source', 'bank_account')
    search_fields = ('description', 'reference')
    readonly_fields = ('imported_at', 'created_at', 'updated_at')

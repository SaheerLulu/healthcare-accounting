from django.contrib import admin
from .models import JournalEntry, JournalEntryLine


class JournalEntryLineInline(admin.TabularInline):
    model = JournalEntryLine
    extra = 0
    fields = ['account', 'debit', 'credit', 'narration', 'party_type', 'party_id']
    readonly_fields = []

    def get_readonly_fields(self, request, obj=None):
        if obj and obj.is_posted:
            return ['account', 'debit', 'credit', 'narration', 'party_type', 'party_id']
        return []


@admin.register(JournalEntry)
class JournalEntryAdmin(admin.ModelAdmin):
    list_display = [
        'entry_no',
        'date',
        'voucher_type',
        'reference_type',
        'reference_id',
        'location_id',
        'is_posted',
        'created_at',
        'created_by',
    ]
    list_filter = ['voucher_type', 'reference_type', 'is_posted', 'date']
    search_fields = ['entry_no', 'narration', 'reference_id']
    ordering = ['-date', '-created_at']
    readonly_fields = ['entry_no', 'created_at']
    inlines = [JournalEntryLineInline]

    def get_readonly_fields(self, request, obj=None):
        base = list(self.readonly_fields)
        if obj and obj.is_posted:
            base += ['date', 'narration', 'voucher_type', 'reference_type', 'reference_id', 'location_id']
        return base


@admin.register(JournalEntryLine)
class JournalEntryLineAdmin(admin.ModelAdmin):
    list_display = ['id', 'entry', 'account', 'debit', 'credit', 'party_type', 'party_id']
    list_filter = ['party_type']
    search_fields = ['entry__entry_no', 'account__account_name', 'narration']
    raw_id_fields = ['entry', 'account']

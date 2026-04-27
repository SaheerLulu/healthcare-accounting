from django.contrib import admin
from .models import PartyCommunication, PartyOpeningBalance


@admin.register(PartyCommunication)
class PartyCommunicationAdmin(admin.ModelAdmin):
    list_display = ('party_type', 'party_id', 'channel', 'direction', 'subject', 'communicated_at')
    list_filter = ('party_type', 'channel', 'direction')
    search_fields = ('subject', 'body', 'contact')


@admin.register(PartyOpeningBalance)
class PartyOpeningBalanceAdmin(admin.ModelAdmin):
    list_display = ('party_type', 'party_id', 'amount', 'as_of_date', 'updated_at')
    list_filter = ('party_type',)
    search_fields = ('narration',)

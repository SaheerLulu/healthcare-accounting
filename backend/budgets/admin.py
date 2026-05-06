from django.contrib import admin

from .models import Budget


@admin.register(Budget)
class BudgetAdmin(admin.ModelAdmin):
    list_display = ('period', 'account', 'cost_center', 'location_id', 'amount')
    list_filter = ('period_kind', 'period', 'cost_center')

from django.contrib import admin

from .models import EMISchedule, Loan


@admin.register(Loan)
class LoanAdmin(admin.ModelAdmin):
    list_display = ('loan_no', 'lender_name', 'loan_type', 'principal_amount',
                    'tenure_months', 'emi_amount', 'status')
    list_filter = ('status', 'loan_type')
    search_fields = ('loan_no', 'lender_name')


@admin.register(EMISchedule)
class EMIScheduleAdmin(admin.ModelAdmin):
    list_display = ('loan', 'installment_no', 'due_date', 'principal',
                    'interest', 'status', 'paid_date')
    list_filter = ('status',)

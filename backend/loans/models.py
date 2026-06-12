"""
Loan master + EMI schedule + repayment with auto-JV.

Each loan generates an amortization schedule on creation. When an EMI is
posted as paid, the principal portion reduces the loan liability and the
interest portion hits Interest Expense (P&L). This avoids the common error
where bookkeepers treat the entire EMI as interest.
"""
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class Loan(models.Model):
    LOAN_TYPES = [
        ('term', 'Term Loan'),
        ('working_capital', 'Working Capital'),
        ('overdraft', 'Bank Overdraft'),
        ('vehicle', 'Vehicle Loan'),
        ('mortgage', 'Property Mortgage'),
    ]
    STATUS = [
        ('active', 'Active'),
        ('closed', 'Closed'),
        ('written_off', 'Written off'),
    ]

    loan_no = models.CharField(max_length=40, unique=True)
    lender_name = models.CharField(max_length=255)
    lender_id = models.PositiveIntegerField(null=True, blank=True,
        help_text='Optional FK to inventory SupplierRO if lender is a known vendor.')
    loan_type = models.CharField(max_length=20, choices=LOAN_TYPES, default='term')

    principal_amount = models.DecimalField(max_digits=15, decimal_places=2)
    interest_rate_pct = models.DecimalField(
        max_digits=5, decimal_places=2,
        help_text='Annual nominal rate (%). Reducing-balance EMIs assumed.',
    )
    tenure_months = models.PositiveSmallIntegerField()
    start_date = models.DateField()
    end_date = models.DateField()
    emi_day = models.PositiveSmallIntegerField(default=5,
        # 29-31 (and 0) crash date() in schedule generation for short months
        # — see AUDIT H18. 1-28 is valid in every month.
        validators=[MinValueValidator(1), MaxValueValidator(28)],
        help_text='Day of month EMI is auto-debited (1-28).')
    emi_amount = models.DecimalField(max_digits=15, decimal_places=2,
        help_text='Computed at create-time using PMT formula.')

    location_id = models.PositiveIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=15, choices=STATUS, default='active')

    # Account mappings (per-loan to support different lenders / books)
    liability_account = models.ForeignKey(
        'core.ChartOfAccount', on_delete=models.PROTECT,
        related_name='loan_liability_for',
        help_text='Loan Liability GL (e.g. "HDFC Term Loan A/c")',
    )
    interest_expense_account = models.ForeignKey(
        'core.ChartOfAccount', on_delete=models.PROTECT,
        related_name='loan_interest_for',
        help_text='Interest Expense GL',
    )

    disbursement_journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='loan_disbursements',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='loans_created',
    )

    class Meta:
        ordering = ['-start_date']
        indexes = [models.Index(fields=['status', 'start_date'])]

    def __str__(self):
        return f'{self.loan_no} — {self.lender_name}'

    @property
    def outstanding_principal(self) -> Decimal:
        from django.db.models import Sum
        paid = self.emi_schedule.filter(status='paid').aggregate(
            s=Sum('principal'))['s'] or Decimal('0.00')
        return self.principal_amount - paid


class EMISchedule(models.Model):
    STATUS = [
        ('pending', 'Pending'),
        ('paid', 'Paid'),
        ('overdue', 'Overdue'),
    ]

    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name='emi_schedule')
    installment_no = models.PositiveSmallIntegerField()
    due_date = models.DateField()
    principal = models.DecimalField(max_digits=15, decimal_places=2)
    interest = models.DecimalField(max_digits=15, decimal_places=2)
    balance_principal = models.DecimalField(
        max_digits=15, decimal_places=2,
        help_text='Outstanding principal AFTER this EMI.',
    )

    status = models.CharField(max_length=10, choices=STATUS, default='pending')
    paid_date = models.DateField(null=True, blank=True)
    journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='emi_payments',
    )

    class Meta:
        unique_together = [['loan', 'installment_no']]
        ordering = ['loan', 'installment_no']
        indexes = [models.Index(fields=['status', 'due_date'])]

    def __str__(self):
        return f'EMI {self.installment_no}/{self.loan.tenure_months} for {self.loan.loan_no}'

    @property
    def total_emi(self) -> Decimal:
        return self.principal + self.interest

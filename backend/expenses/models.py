from decimal import Decimal
from django.db import models
from django.contrib.auth.models import User


def _attachment_path(instance, filename):
    eid = instance.expense_id or 'new'
    return f"expenses/{eid}/{filename}"


class Expense(models.Model):
    """A direct expenditure paid immediately (cash, bank, or credit card).

    Distinct from a Bill: there's no due date or payable tracking — the money
    has already left when the expense is recorded. Supports itemization so a
    single payment can be split across multiple expense categories.
    """

    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('recorded', 'Recorded'),
    ]

    expense_date = models.DateField()
    paid_through_account = models.ForeignKey(
        'core.ChartOfAccount', on_delete=models.PROTECT,
        related_name='paid_through_expenses',
        help_text='The bank/cash/credit-card GL account that funded this expense.',
    )
    vendor_name = models.CharField(max_length=255, blank=True,
                                   help_text='Optional payee (free text or supplier).')
    vendor_id = models.PositiveIntegerField(null=True, blank=True,
                                            help_text='Optional FK to inventory SupplierRO.')
    reference = models.CharField(max_length=120, blank=True,
                                 help_text='Cheque #, invoice ref, receipt #')

    subtotal = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    tax_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    tax_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    tax_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    total_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    notes = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')

    journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='expenses',
    )
    location_id = models.PositiveIntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='expenses_created',
    )

    class Meta:
        ordering = ['-expense_date', '-id']
        indexes = [
            models.Index(fields=['status', 'expense_date']),
            models.Index(fields=['paid_through_account']),
        ]

    def __str__(self):
        label = self.vendor_name or 'Expense'
        return f"{label} {self.total_amount} on {self.expense_date}"


class ExpenseItem(models.Model):
    expense = models.ForeignKey(Expense, on_delete=models.CASCADE, related_name='items')
    account = models.ForeignKey(
        'core.ChartOfAccount', on_delete=models.PROTECT,
        related_name='expense_items',
        help_text='Expense account this line is recorded against',
    )
    description = models.CharField(max_length=500, blank=True)
    amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    class Meta:
        ordering = ['id']

    def __str__(self):
        return f"{self.account.account_code if self.account_id else '?'} {self.amount}"


class ExpenseAttachment(models.Model):
    expense = models.ForeignKey(Expense, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to=_attachment_path)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    uploaded_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='expense_attachments_uploaded',
    )

    class Meta:
        ordering = ['-uploaded_at', '-id']

    def __str__(self):
        return f"{self.original_name} on expense {self.expense_id}"

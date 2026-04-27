from decimal import Decimal
from django.db import models
from django.contrib.auth.models import User


class Bill(models.Model):
    """A vendor bill for non-inventory expenses (utilities, rent, professional services).

    Inventory purchases come from `inventory_reader.PurchaseOrderRO` and auto-post
    via the sync service. Bills cover everything else and are posted manually.
    """

    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('open', 'Open'),
        ('partially_paid', 'Partially Paid'),
        ('paid', 'Paid'),
        ('cancelled', 'Cancelled'),
    ]

    bill_no = models.CharField(max_length=100, blank=True,
                               help_text="Vendor's invoice/reference number")
    bill_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)

    vendor_id = models.PositiveIntegerField(null=True, blank=True,
                                            help_text="Optional link to inventory SupplierRO")
    vendor_name = models.CharField(max_length=255)

    subtotal = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    tax_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    tax_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    tax_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    total_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    amount_paid = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    notes = models.TextField(blank=True)

    location_id = models.PositiveIntegerField(null=True, blank=True)
    journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='bills',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='bills_created',
    )

    class Meta:
        ordering = ['-bill_date', '-id']
        indexes = [
            models.Index(fields=['status', 'due_date']),
            models.Index(fields=['vendor_id']),
            models.Index(fields=['bill_date']),
        ]

    def __str__(self):
        return f"Bill {self.bill_no or self.id} — {self.vendor_name}"

    @property
    def balance_due(self) -> Decimal:
        return (self.total_amount or Decimal('0.00')) - (self.amount_paid or Decimal('0.00'))

    def recalc_status(self) -> str:
        """Compute status based on amount_paid and journal_entry presence."""
        if self.status == 'cancelled':
            return 'cancelled'
        if self.journal_entry_id is None:
            return 'draft'
        if self.amount_paid >= self.total_amount and self.total_amount > 0:
            return 'paid'
        if self.amount_paid > 0:
            return 'partially_paid'
        return 'open'


class BillLine(models.Model):
    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name='lines')
    account = models.ForeignKey('core.ChartOfAccount', on_delete=models.PROTECT,
                                related_name='bill_lines',
                                help_text='Expense account this line is recorded against')
    description = models.CharField(max_length=500, blank=True)
    amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    class Meta:
        ordering = ['id']

    def __str__(self):
        return f"{self.account.account_code if self.account_id else '?'} — {self.amount}"


def _bill_attachment_path(instance, filename):
    bill_id = instance.bill_id or 'new'
    return f"bills/{bill_id}/{filename}"


class BillAttachment(models.Model):
    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to=_bill_attachment_path)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    uploaded_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='bill_attachments_uploaded',
    )

    class Meta:
        ordering = ['-uploaded_at', '-id']

    def __str__(self):
        return f"{self.original_name} on bill {self.bill_id}"


class RecurringBill(models.Model):
    """Template that auto-generates a Bill on each cycle date.

    Lifecycle:
      active  → service runs daily, creating a Bill whenever next_run_date <= today.
                If the user pauses (status='paused'), generation stops; resuming
                re-arms the same next_run_date.
      stopped → end_date reached or user-stopped; no more bills.

    `auto_approve=True` → generated Bill is posted immediately. Otherwise a draft
    is created so the user can review before approving.
    """

    FREQ_CHOICES = [
        ('daily', 'Daily'),
        ('weekly', 'Weekly'),
        ('monthly', 'Monthly'),
        ('quarterly', 'Quarterly'),
        ('yearly', 'Yearly'),
    ]
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('paused', 'Paused'),
        ('stopped', 'Stopped'),
    ]

    profile_name = models.CharField(max_length=120,
                                    help_text="Internal label, e.g. 'Monthly rent — Office'.")
    vendor_id = models.PositiveIntegerField(null=True, blank=True)
    vendor_name = models.CharField(max_length=255)

    subtotal = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    tax_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    tax_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    tax_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    total_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    notes = models.TextField(blank=True)
    location_id = models.PositiveIntegerField(null=True, blank=True)

    frequency = models.CharField(max_length=12, choices=FREQ_CHOICES, default='monthly')
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True,
                                help_text='Leave blank to run indefinitely.')
    next_run_date = models.DateField()
    last_run_date = models.DateField(null=True, blank=True)
    due_days = models.PositiveIntegerField(default=30,
        help_text='Days from bill date to set as due date on each generated bill.')

    auto_approve = models.BooleanField(default=False,
        help_text='If true, generated bills are posted to books immediately.')
    bill_no_pattern = models.CharField(max_length=120, blank=True,
        help_text='Optional pattern for generated bill numbers. Tokens: {YYYY-MM}, {YYYY}, {MM}, {DD}, {MON}, {SEQ}.')

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='active')
    last_error = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='recurring_bills_created',
    )

    class Meta:
        ordering = ['-status', 'next_run_date']
        indexes = [
            models.Index(fields=['status', 'next_run_date']),
        ]

    def __str__(self):
        return f"{self.profile_name} ({self.get_frequency_display()})"


class RecurringBillItem(models.Model):
    recurring_bill = models.ForeignKey(RecurringBill, on_delete=models.CASCADE,
                                       related_name='items')
    account = models.ForeignKey('core.ChartOfAccount', on_delete=models.PROTECT,
                                related_name='recurring_bill_items')
    description = models.CharField(max_length=500, blank=True)
    amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    class Meta:
        ordering = ['id']


class BillPayment(models.Model):
    PAYMENT_MODES = [('bank', 'Bank'), ('cash', 'Cash')]

    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name='payments')
    date = models.DateField()
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    mode = models.CharField(max_length=10, choices=PAYMENT_MODES, default='bank')
    reference = models.CharField(max_length=100, blank=True,
                                 help_text='Cheque #, UTR, transaction ref, etc.')
    notes = models.CharField(max_length=500, blank=True)
    journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='bill_payments',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='bill_payments_created',
    )

    class Meta:
        ordering = ['-date', '-id']

    def __str__(self):
        return f"Payment {self.amount} on {self.date} for {self.bill}"

from django.db import models
from decimal import Decimal


class TDSRateConfig(models.Model):
    """DB-stored TDS rates, editable via settings UI."""
    DEDUCTEE_TYPE_CHOICES = [
        ('Company', 'Company'),
        ('Individual', 'Individual/HUF'),
    ]

    section = models.CharField(max_length=10)
    deductee_type = models.CharField(max_length=20, choices=DEDUCTEE_TYPE_CHOICES)
    rate = models.DecimalField(max_digits=5, decimal_places=2)
    threshold = models.DecimalField(max_digits=15, decimal_places=2)
    fy_start = models.DateField()
    fy_end = models.DateField()
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['section', 'deductee_type']
        unique_together = [['section', 'deductee_type', 'fy_start']]

    def __str__(self):
        return f"{self.section} | {self.deductee_type} | {self.rate}%"


class TDSDeduction(models.Model):
    SECTION_CHOICES = [
        ('194C', '194C - Contractors'),
        ('194H', '194H - Commission/Brokerage'),
        ('194J', '194J - Professional/Technical Services'),
        ('194Q', '194Q - Purchase of Goods'),
        ('194I', '194I - Rent'),
        ('194O', '194O - E-Commerce Operator'),
        ('OTHER', 'Other'),
    ]
    DEDUCTEE_TYPE_CHOICES = [
        ('Company', 'Company'),
        ('Individual', 'Individual/HUF'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('challan_paid', 'Challan Paid'),
        ('returned', 'Returned'),
    ]
    SOURCE_TYPES = [
        ('PurchaseOrder', 'Purchase Order'),
        ('Manual', 'Manual Entry'),
    ]

    deductee_name = models.CharField(max_length=255)
    deductee_pan = models.CharField(max_length=10, blank=True)
    section = models.CharField(max_length=10, choices=SECTION_CHOICES)
    nature_of_payment = models.CharField(max_length=255)
    transaction_date = models.DateField()
    gross_amount = models.DecimalField(max_digits=15, decimal_places=2)
    tds_rate = models.DecimalField(max_digits=5, decimal_places=2)
    tds_amount = models.DecimalField(max_digits=15, decimal_places=2)
    deductee_type = models.CharField(max_length=20, choices=DEDUCTEE_TYPE_CHOICES, default='Company')
    source_type = models.CharField(max_length=20, choices=SOURCE_TYPES, default='Manual')
    source_id = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    challan_no = models.CharField(max_length=100, blank=True)
    challan_date = models.DateField(null=True, blank=True)
    bsr_code = models.CharField(max_length=20, blank=True)
    location_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-transaction_date']

    def __str__(self):
        return f"{self.deductee_name} | {self.section} | {self.tds_amount}"


class TDSChallan(models.Model):
    challan_no = models.CharField(max_length=100, unique=True)
    bsr_code = models.CharField(max_length=20)
    deposit_date = models.DateField()
    period = models.CharField(max_length=7)  # YYYY-MM
    section = models.CharField(max_length=10)
    total_tds_amount = models.DecimalField(max_digits=15, decimal_places=2)
    # NULL = company-wide challan (admin All-Stores sweep / legacy rows).
    location_id = models.PositiveIntegerField(null=True, blank=True)
    deductions = models.ManyToManyField(TDSDeduction, blank=True, related_name='challans')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-deposit_date']

    def __str__(self):
        return f"Challan {self.challan_no} | {self.period}"


class TCSCollection(models.Model):
    """
    TCS u/s 206C(1H) — sellers with turnover > ₹10 Cr collect 0.1% TCS on
    sales > ₹50 L per buyer per FY (on the amount EXCEEDING the threshold).

    Each collected row links back to the source sale (B2BSalesOrder) for
    traceability. Status tracks the same three-stage lifecycle as TDS:
    pending → challan_paid → returned.
    """

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('challan_paid', 'Challan Paid'),
        ('returned', 'Returned (Form 27EQ)'),
    ]

    buyer_name = models.CharField(max_length=255)
    buyer_pan = models.CharField(max_length=10, blank=True)
    buyer_id = models.PositiveIntegerField(null=True, blank=True,
        help_text='Inventory CustomerRO id, if known.')

    transaction_date = models.DateField()
    fy_label = models.CharField(max_length=7, db_index=True,
        help_text="e.g. '2025-26'")
    invoice_no = models.CharField(max_length=100, blank=True)
    source_type = models.CharField(max_length=30, default='B2BSalesOrder')
    source_id = models.PositiveIntegerField(null=True, blank=True)

    sale_amount = models.DecimalField(max_digits=15, decimal_places=2,
        help_text='Total sale amount on the invoice (incl. GST per Circular 17/2020).')
    cumulative_sales_fy = models.DecimalField(
        max_digits=15, decimal_places=2,
        help_text='Cumulative sales to this buyer in FY at time of this txn.',
    )
    taxable_amount = models.DecimalField(
        max_digits=15, decimal_places=2,
        help_text='Portion of this sale exceeding ₹50L FY-cumulative threshold.',
    )
    tcs_rate = models.DecimalField(max_digits=5, decimal_places=2,
                                   default=Decimal('0.10'))
    tcs_amount = models.DecimalField(max_digits=15, decimal_places=2)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    challan_no = models.CharField(max_length=100, blank=True)
    challan_date = models.DateField(null=True, blank=True)
    location_id = models.PositiveIntegerField(null=True, blank=True)
    journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='tcs_collections',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-transaction_date']
        indexes = [
            models.Index(fields=['fy_label', 'buyer_id']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f'TCS u/s 206C(1H) {self.buyer_name} | FY {self.fy_label} | {self.tcs_amount}'


class Form26ASEntry(models.Model):
    """
    A single TDS-credit row from Form 26AS (the IT Dept's consolidated tax
    statement showing TDS deducted on payments received by the company).
    Reconciled against journal entries that booked TDS Receivable.
    """

    MATCH_STATUS = [
        ('unmatched', 'Unmatched'),
        ('matched', 'Matched'),
        ('partial', 'Partial Match'),
        ('mismatch', 'Mismatch'),
    ]

    fy_label = models.CharField(max_length=7, db_index=True)
    deductor_tan = models.CharField(max_length=10)
    deductor_name = models.CharField(max_length=255)
    section = models.CharField(max_length=10)
    period = models.CharField(max_length=7, blank=True)
    transaction_date = models.DateField()
    booking_date = models.DateField(null=True, blank=True)

    gross_amount = models.DecimalField(max_digits=15, decimal_places=2)
    tds_amount = models.DecimalField(max_digits=15, decimal_places=2)
    challan_no = models.CharField(max_length=40, blank=True)
    challan_bsr = models.CharField(max_length=20, blank=True)

    match_status = models.CharField(max_length=15, choices=MATCH_STATUS,
                                    default='unmatched')
    matched_journal_entry = models.ForeignKey(
        'journals.JournalEntry', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='form_26as_entries',
    )
    notes = models.CharField(max_length=255, blank=True)
    location_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-transaction_date']
        indexes = [
            models.Index(fields=['fy_label', 'deductor_tan']),
            models.Index(fields=['match_status']),
        ]

    def __str__(self):
        return f'26AS {self.deductor_tan} | {self.section} | ₹{self.tds_amount}'

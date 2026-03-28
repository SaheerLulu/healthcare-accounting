from django.db import models
from decimal import Decimal


class GSTR1Entry(models.Model):
    INVOICE_TYPES = [
        ('B2B', 'B2B Invoice'),
        ('B2C_LARGE', 'B2C Large (>2.5L)'),
        ('B2C_SMALL', 'B2C Small'),
        ('CREDIT_NOTE', 'Credit Note'),
        ('DEBIT_NOTE', 'Debit Note'),
        ('CDNR', 'Credit/Debit Note (Registered)'),
        ('CDNUR', 'Credit/Debit Note (Unregistered)'),
        ('NIL', 'Nil Rated/Exempt'),
    ]
    SOURCE_TYPES = [
        ('pos', 'POS Sale'),
        ('b2b', 'B2B Sale'),
        ('return', 'Sales Return'),
    ]

    period = models.CharField(max_length=7)  # YYYY-MM
    location_id = models.PositiveIntegerField()
    invoice_no = models.CharField(max_length=100)
    invoice_date = models.DateField()
    customer_gstin = models.CharField(max_length=15, blank=True)
    invoice_type = models.CharField(max_length=20, choices=INVOICE_TYPES)
    place_of_supply = models.CharField(max_length=2, blank=True)
    taxable_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    cess = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    hsn_code = models.CharField(max_length=20, blank=True)
    rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    source_type = models.CharField(max_length=10, choices=SOURCE_TYPES)
    source_id = models.PositiveIntegerField()

    # Non-destructive regeneration (Phase 2A)
    version = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)

    # CDNR fields (Phase 2B)
    original_invoice_no = models.CharField(max_length=100, blank=True)
    original_invoice_date = models.DateField(null=True, blank=True)
    is_time_barred = models.BooleanField(default=False)

    # E-invoicing fields (Phase 2G)
    irn = models.CharField(max_length=64, blank=True)
    irn_date = models.DateField(null=True, blank=True)
    ack_no = models.CharField(max_length=100, blank=True)
    ack_date = models.DateField(null=True, blank=True)
    e_invoice_status = models.CharField(max_length=20, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-invoice_date']
        indexes = [
            models.Index(fields=['period', 'location_id']),
            models.Index(fields=['is_active', 'period']),
        ]

    def __str__(self):
        return f"GSTR1 {self.period} | {self.invoice_no} | {self.invoice_type}"


class GSTR1HSNSummary(models.Model):
    """HSN-code level summary for GSTR-1 filing."""
    period = models.CharField(max_length=7)
    location_id = models.PositiveIntegerField()
    hsn_code = models.CharField(max_length=20)
    description = models.CharField(max_length=255, blank=True)
    uqc = models.CharField(max_length=10, default='NOS')  # Unit Quantity Code
    quantity = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    taxable_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    version = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['hsn_code']
        indexes = [
            models.Index(fields=['period', 'location_id', 'is_active']),
        ]

    def __str__(self):
        return f"HSN {self.hsn_code} | {self.period}"


class GSTR3BSummary(models.Model):
    STATUS_CHOICES = [('draft', 'Draft'), ('filed', 'Filed')]

    period = models.CharField(max_length=7)  # YYYY-MM
    location_id = models.PositiveIntegerField()
    # 3.1 Outward supplies
    outward_taxable = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    outward_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    outward_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    outward_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    outward_zero_rated = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    # 4. ITC (Input Tax Credit)
    itc_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    itc_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    itc_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    # Net payable
    net_payable_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    net_payable_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    net_payable_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    filed_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [['period', 'location_id']]
        ordering = ['-period']

    def __str__(self):
        return f"GSTR3B {self.period} | Location {self.location_id} | {self.status}"


class GSTR2BEntry(models.Model):
    """Auto-populated purchase register (books-side) for ITC matching."""
    MATCH_STATUS_CHOICES = [
        ('matched', 'Matched'),
        ('unmatched', 'Unmatched'),
        ('missing', 'Missing in Books'),
        ('mismatch', 'Amount Mismatch'),
    ]

    period = models.CharField(max_length=7)
    location_id = models.PositiveIntegerField()
    supplier_gstin = models.CharField(max_length=15)
    supplier_name = models.CharField(max_length=255)
    invoice_no = models.CharField(max_length=100)
    invoice_date = models.DateField()
    place_of_supply = models.CharField(max_length=2, blank=True)
    taxable_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    itc_eligible = models.BooleanField(default=True)
    source_po_id = models.PositiveIntegerField(null=True, blank=True)
    match_status = models.CharField(max_length=20, choices=MATCH_STATUS_CHOICES, default='unmatched')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-invoice_date']
        indexes = [
            models.Index(fields=['period', 'location_id']),
            models.Index(fields=['match_status']),
        ]

    def __str__(self):
        return f"GSTR2B {self.period} | {self.supplier_name} | {self.invoice_no}"


class ITCReconciliation(models.Model):
    """Reconciliation of ITC between books and GSTR-2B."""
    STATUS_CHOICES = [
        ('matched', 'Matched'),
        ('unmatched', 'Unmatched'),
        ('partial', 'Partial Match'),
    ]

    period = models.CharField(max_length=7)
    location_id = models.PositiveIntegerField()
    supplier_gstin = models.CharField(max_length=15)
    # Books-side amounts
    books_taxable = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    books_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    books_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    books_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    # GSTR-2B side amounts
    gstr2b_taxable = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    gstr2b_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    gstr2b_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    gstr2b_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='unmatched')
    action_taken = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-period', 'supplier_gstin']
        indexes = [
            models.Index(fields=['period', 'location_id']),
        ]

    def __str__(self):
        return f"ITC Recon {self.period} | {self.supplier_gstin} | {self.status}"


class RCMEntry(models.Model):
    """Reverse Charge Mechanism tracking."""
    period = models.CharField(max_length=7)
    location_id = models.PositiveIntegerField()
    supplier_gstin = models.CharField(max_length=15, blank=True)
    supplier_name = models.CharField(max_length=255)
    service_type = models.CharField(max_length=100)
    sac_code = models.CharField(max_length=20, blank=True)
    taxable_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    journal_entry = models.ForeignKey(
        'journals.JournalEntry', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='rcm_entries'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-period']
        indexes = [
            models.Index(fields=['period', 'location_id']),
        ]

    def __str__(self):
        return f"RCM {self.period} | {self.supplier_name} | {self.service_type}"

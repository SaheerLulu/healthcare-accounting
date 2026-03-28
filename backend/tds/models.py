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
    deductions = models.ManyToManyField(TDSDeduction, blank=True, related_name='challans')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-deposit_date']

    def __str__(self):
        return f"Challan {self.challan_no} | {self.period}"

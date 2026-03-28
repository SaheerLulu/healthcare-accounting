from django.db import models
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from decimal import Decimal


class JournalEntry(models.Model):
    VOUCHER_TYPES = [
        ('PURCHASE', 'Purchase Invoice'),
        ('SALE', 'Sale Invoice'),
        ('PAYMENT', 'Payment'),
        ('RECEIPT', 'Receipt'),
        ('CONTRA', 'Contra'),
        ('JOURNAL', 'Journal'),
        ('CREDIT_NOTE', 'Credit Note'),
        ('DEBIT_NOTE', 'Debit Note'),
    ]
    REFERENCE_TYPES = [
        ('PurchaseOrder', 'Purchase Order'),
        ('POSOrder', 'POS Order'),
        ('B2BSalesOrder', 'B2B Sales Order'),
        ('SalesReturn', 'Sales Return'),
        ('PurchaseReturn', 'Purchase Return'),
        ('RCM', 'RCM Entry'),
        ('Manual', 'Manual Entry'),
    ]

    entry_no = models.CharField(max_length=20, unique=True, editable=False)
    date = models.DateField()
    narration = models.TextField(blank=True)
    voucher_type = models.CharField(max_length=20, choices=VOUCHER_TYPES)
    reference_type = models.CharField(max_length=30, choices=REFERENCE_TYPES, blank=True)
    reference_id = models.PositiveIntegerField(null=True, blank=True)
    is_posted = models.BooleanField(default=False)
    location_id = models.PositiveIntegerField(null=True, blank=True)  # matches inventory location
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='journal_entries',
    )

    class Meta:
        verbose_name_plural = 'Journal Entries'
        ordering = ['-date', '-created_at']
        indexes = [
            models.Index(fields=['date']),
            models.Index(fields=['reference_type', 'reference_id']),
            models.Index(fields=['voucher_type']),
        ]

    def save(self, *args, **kwargs):
        if not self.entry_no:
            self.entry_no = self._generate_entry_no()
        super().save(*args, **kwargs)

    def _generate_entry_no(self):
        from django.utils import timezone
        year = timezone.now().year
        last = (
            JournalEntry.objects
            .filter(entry_no__startswith=f'JV-{year}-')
            .order_by('-entry_no')
            .first()
        )
        if last:
            try:
                seq = int(last.entry_no.split('-')[-1]) + 1
            except (ValueError, IndexError):
                seq = 1
        else:
            seq = 1
        return f'JV-{year}-{seq:06d}'

    def clean(self):
        if self.is_posted:
            lines = self.lines.all()
            total_debit = sum(line.debit for line in lines)
            total_credit = sum(line.credit for line in lines)
            if total_debit != total_credit:
                raise ValidationError(
                    f'Journal entry is unbalanced: Debit={total_debit}, Credit={total_credit}'
                )

    def post(self):
        """Post this journal entry after validating balance."""
        self.clean()
        self.is_posted = True
        self.save()

    def __str__(self):
        return f"{self.entry_no} ({self.date})"


class JournalEntryLine(models.Model):
    PARTY_TYPES = [
        ('Customer', 'Customer'),
        ('Supplier', 'Supplier'),
        ('None', 'None'),
    ]

    entry = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name='lines')
    account = models.ForeignKey(
        'core.ChartOfAccount',
        on_delete=models.PROTECT,
        related_name='journal_lines',
    )
    debit = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    credit = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    narration = models.CharField(max_length=500, blank=True)
    party_type = models.CharField(max_length=10, choices=PARTY_TYPES, default='None')
    party_id = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['id']

    def clean(self):
        if self.debit < 0 or self.credit < 0:
            raise ValidationError('Debit and Credit must be non-negative.')
        if self.debit > 0 and self.credit > 0:
            raise ValidationError('A line cannot have both debit and credit.')

    def __str__(self):
        return f"{self.entry.entry_no} | {self.account} | Dr:{self.debit} Cr:{self.credit}"

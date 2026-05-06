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
    # Cost center / department tag — used for departmental P&L. Free-form so
    # the user can introduce new departments without a migration; UI feeds
    # a recommended list.
    cost_center = models.CharField(max_length=50, blank=True, db_index=True,
        help_text='Cost center / department tag, e.g. "OPD", "PHARMACY", "LAB".')
    # Reverse-once invariant: a posted entry can be reversed exactly once.
    # The reversing entry points back via reversal_of.
    reversal_of = models.OneToOneField(
        'self', null=True, blank=True,
        on_delete=models.PROTECT,
        related_name='reversal_entry',
        help_text='The original posted entry that this reversal cancels (if any).',
    )
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
        # Block any save (create or update) into a locked period.
        # Skip this guard when the model is being loaded from a fixture or
        # imported via management command that explicitly opts out.
        if not getattr(self, '_skip_period_lock', False):
            from core.period_lock import assert_unlocked
            assert_unlocked(self.date)
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

    # Brief §3.2 tolerance for posted-entry balance.
    BALANCE_TOLERANCE = Decimal('0.005')

    def clean(self):
        if self.is_posted:
            self._assert_balanced()

    def _assert_balanced(self):
        lines = self.lines.all()
        total_debit = sum((l.debit for l in lines), Decimal('0'))
        total_credit = sum((l.credit for l in lines), Decimal('0'))
        if abs(total_debit - total_credit) > self.BALANCE_TOLERANCE:
            raise ValidationError(
                f'Journal entry is unbalanced: Debit={total_debit}, '
                f'Credit={total_credit}, Δ={total_debit - total_credit}'
            )

    def post(self):
        """Post this journal entry after validating balance.

        Validates regardless of current is_posted state — clean() guards by
        is_posted, which used to skip the check on first post().
        """
        self._assert_balanced()
        self.is_posted = True
        self.save()

    def __str__(self):
        return f"{self.entry_no} ({self.date})"


class RecurringJournal(models.Model):
    """Template that auto-generates a JournalEntry on each cycle date.

    Use cases: monthly depreciation, prepaid expense amortization, accruals,
    standing internal transfers — anything that's a balanced JE you'd otherwise
    type out manually every period.
    """

    FREQ_CHOICES = [
        ('daily', 'Daily'), ('weekly', 'Weekly'),
        ('monthly', 'Monthly'), ('quarterly', 'Quarterly'),
        ('yearly', 'Yearly'),
    ]
    STATUS_CHOICES = [
        ('active', 'Active'), ('paused', 'Paused'), ('stopped', 'Stopped'),
    ]

    profile_name = models.CharField(max_length=120,
                                    help_text="e.g. 'Monthly depreciation', 'Insurance prepaid'")
    voucher_type = models.CharField(max_length=20, choices=JournalEntry.VOUCHER_TYPES, default='JOURNAL')
    narration_template = models.CharField(max_length=500, blank=True,
        help_text='Tokens: {YYYY-MM}, {YYYY}, {MM}, {MON}, {DD}')
    location_id = models.PositiveIntegerField(null=True, blank=True)

    frequency = models.CharField(max_length=12, choices=FREQ_CHOICES, default='monthly')
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    next_run_date = models.DateField()
    last_run_date = models.DateField(null=True, blank=True)

    auto_post = models.BooleanField(default=True,
        help_text='Auto-post the generated entry. Off = create as draft.')

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='active')
    last_error = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='recurring_journals_created',
    )

    class Meta:
        ordering = ['-status', 'next_run_date']
        indexes = [models.Index(fields=['status', 'next_run_date'])]

    def __str__(self):
        return f"{self.profile_name} ({self.get_frequency_display()})"


class RecurringJournalLine(models.Model):
    recurring_journal = models.ForeignKey(RecurringJournal, on_delete=models.CASCADE,
                                          related_name='lines')
    account = models.ForeignKey('core.ChartOfAccount', on_delete=models.PROTECT,
                                related_name='recurring_journal_lines')
    debit = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    credit = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    narration = models.CharField(max_length=500, blank=True)
    party_type = models.CharField(max_length=10,
                                  choices=[('Customer', 'Customer'), ('Supplier', 'Supplier'), ('None', 'None')],
                                  default='None')
    party_id = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['id']

    def clean(self):
        if self.debit < 0 or self.credit < 0:
            raise ValidationError('Debit and Credit must be non-negative.')
        if self.debit > 0 and self.credit > 0:
            raise ValidationError('A line cannot have both debit and credit.')


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

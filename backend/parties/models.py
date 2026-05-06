from decimal import Decimal
from django.db import models
from django.contrib.auth.models import User


class PartyCommunication(models.Model):
    """Manual log of communications (email, phone, note) with a supplier or customer.

    Suppliers/customers themselves are sourced read-only from the parent inventory
    system via inventory_reader proxy models; this app only stores the comms log.
    """

    PARTY_TYPES = [
        ('Supplier', 'Supplier'),
        ('Customer', 'Customer'),
    ]
    DIRECTIONS = [
        ('out', 'Outgoing'),
        ('in', 'Incoming'),
    ]
    CHANNELS = [
        ('email', 'Email'),
        ('phone', 'Phone'),
        ('whatsapp', 'WhatsApp'),
        ('note', 'Note'),
    ]

    party_type = models.CharField(max_length=10, choices=PARTY_TYPES)
    party_id = models.PositiveIntegerField()
    channel = models.CharField(max_length=20, choices=CHANNELS, default='email')
    direction = models.CharField(max_length=3, choices=DIRECTIONS, default='out')
    subject = models.CharField(max_length=255)
    body = models.TextField(blank=True)
    contact = models.CharField(max_length=255, blank=True)
    communicated_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='party_communications',
    )

    class Meta:
        ordering = ['-communicated_at', '-id']
        indexes = [
            models.Index(fields=['party_type', 'party_id']),
            models.Index(fields=['communicated_at']),
        ]

    def __str__(self):
        return f"{self.get_channel_display()} • {self.party_type}#{self.party_id} • {self.subject}"


class PartyOpeningBalance(models.Model):
    """Carry-forward opening balance for a supplier or customer.

    Sign convention (matches the parties feature throughout):
      Customer: positive amount = customer owes us (receivable).
      Supplier: positive amount = we owe supplier (payable).

    Stored independently of journal entries — the parties services layer adds
    this amount to all running-balance / outstanding computations. It is NOT
    auto-posted to the general ledger; if you want it reflected in trial
    balance, post a manual journal entry against an opening-balance equity
    account separately.
    """

    PARTY_TYPES = [
        ('Supplier', 'Supplier'),
        ('Customer', 'Customer'),
    ]

    party_type = models.CharField(max_length=10, choices=PARTY_TYPES)
    party_id = models.PositiveIntegerField()
    amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    as_of_date = models.DateField()
    narration = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='opening_balances',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['party_type', 'party_id'],
                name='parties_openingbalance_unique_party',
            ),
        ]
        indexes = [models.Index(fields=['party_type', 'party_id'])]

    def __str__(self):
        return f"OB {self.party_type}#{self.party_id} = {self.amount} as of {self.as_of_date}"


class PartyMetadata(models.Model):
    """
    Augments inventory's read-only Supplier/Customer rows with accounting-
    specific metadata that doesn't belong in inventory: MSME registration,
    income-tax PAN, lower-deduction-certificate flags, etc.
    """

    PARTY_TYPES = [('Supplier', 'Supplier'), ('Customer', 'Customer')]

    MSME_CATEGORIES = [
        ('', 'Not registered'),
        ('micro', 'Micro Enterprise'),
        ('small', 'Small Enterprise'),
        ('medium', 'Medium Enterprise'),
    ]

    party_type = models.CharField(max_length=10, choices=PARTY_TYPES)
    party_id = models.PositiveIntegerField()

    pan = models.CharField(max_length=10, blank=True)
    msme_category = models.CharField(max_length=10, choices=MSME_CATEGORIES,
                                     blank=True, default='')
    msme_udyam_no = models.CharField(max_length=30, blank=True,
        help_text='UDYAM-XX-00-0000000 — MSME registration number')
    msme_credit_period_days = models.PositiveSmallIntegerField(
        default=45,
        help_text='Per Section 15 of MSMED Act 2006: max 45 days from acceptance.',
    )

    # Lower deduction certificate u/s 197 IT Act — applies a reduced TDS rate
    has_lower_deduction_cert = models.BooleanField(default=False)
    lower_tds_rate_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0.00'),
    )
    lower_cert_valid_from = models.DateField(null=True, blank=True)
    lower_cert_valid_to = models.DateField(null=True, blank=True)

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['party_type', 'party_id'],
                name='parties_metadata_unique_party',
            ),
        ]
        indexes = [
            models.Index(fields=['msme_category']),
            models.Index(fields=['party_type', 'party_id']),
        ]

    def __str__(self):
        return f'Metadata {self.party_type}#{self.party_id}'

    @property
    def is_msme(self) -> bool:
        return bool(self.msme_category and self.msme_udyam_no)

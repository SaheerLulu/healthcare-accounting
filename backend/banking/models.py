from decimal import Decimal
from django.db import models
from django.contrib.auth.models import User


class BankAccount(models.Model):
    """A real-world bank or cash account that you reconcile against book balances.

    Linked to a leaf ChartOfAccount of subtype Bank or Cash. The book balance is
    derived from posted JournalEntryLines on that GL account; the bank balance
    is the running total of imported BankTransactions on this account.
    """

    ACCOUNT_TYPES = [
        ('bank', 'Bank'),
        ('credit_card', 'Credit Card'),
        ('cash', 'Cash'),
    ]

    name = models.CharField(max_length=120)
    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPES, default='bank')
    bank_name = models.CharField(max_length=120, blank=True)
    account_number = models.CharField(max_length=40, blank=True)
    ifsc = models.CharField(max_length=20, blank=True)
    currency = models.CharField(max_length=3, default='INR')

    chart_account = models.ForeignKey(
        'core.ChartOfAccount', on_delete=models.PROTECT,
        related_name='bank_accounts',
        help_text='GL account this bank account posts to (Bank/Cash leaf)',
    )
    opening_balance = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    opening_date = models.DateField(null=True, blank=True)

    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    location_id = models.PositiveIntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='bank_accounts_created',
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class BankTransaction(models.Model):
    """A single line from a bank statement (or manually added).

    `amount` is signed:
      positive = money in (credit on the bank statement, debit to the GL bank a/c)
      negative = money out (debit on the bank statement, credit to the GL bank a/c)
    """

    STATUS_CHOICES = [
        ('unmatched', 'Unmatched'),
        ('matched', 'Matched'),
        ('excluded', 'Excluded'),
    ]
    SOURCE_CHOICES = [
        ('imported', 'Imported'),
        ('manual', 'Manual'),
    ]

    bank_account = models.ForeignKey(
        BankAccount, on_delete=models.CASCADE, related_name='transactions',
    )
    date = models.DateField()
    value_date = models.DateField(null=True, blank=True)
    description = models.CharField(max_length=500, blank=True)
    reference = models.CharField(max_length=120, blank=True,
                                 help_text='Cheque #, UTR, transaction ref')

    amount = models.DecimalField(max_digits=15, decimal_places=2,
                                 help_text='Signed: positive = money in, negative = money out')
    running_balance = models.DecimalField(max_digits=15, decimal_places=2,
                                          null=True, blank=True,
                                          help_text='Balance reported by the statement at this row')

    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='unmatched')
    source = models.CharField(max_length=12, choices=SOURCE_CHOICES, default='imported')

    matched_journal_entry = models.ForeignKey(
        'journals.JournalEntry', null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='bank_transactions',
    )
    notes = models.CharField(max_length=500, blank=True)

    imported_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='bank_transactions_created',
    )

    class Meta:
        ordering = ['-date', '-id']
        indexes = [
            models.Index(fields=['bank_account', 'status']),
            models.Index(fields=['bank_account', 'date']),
        ]
        constraints = [
            # Best-effort dedupe on import — same account, same day, same exact amount,
            # same description; manually-added rows can still bypass this if the user
            # enters something distinct.
            models.UniqueConstraint(
                fields=['bank_account', 'date', 'amount', 'description'],
                name='banking_transaction_dedupe',
            ),
        ]

    def __str__(self):
        return f"{self.date} {self.amount} on {self.bank_account_id}"

    @property
    def direction(self) -> str:
        return 'in' if self.amount > 0 else 'out'

    @property
    def abs_amount(self):
        return abs(self.amount)


class Cheque(models.Model):
    """Tracks individual cheques (issued + received) through their lifecycle.

    A cheque is *paper* — even after the JE is booked, the cheque can still
    bounce, get cancelled, or sit pending for weeks. We model that lifecycle
    separately so reconciliation reflects the real bank position.
    """

    KIND = [
        ('issued', 'Issued (we paid)'),
        ('received', 'Received (we collected)'),
    ]
    STATUS = [
        ('pending', 'Pending'),
        ('cleared', 'Cleared'),
        ('bounced', 'Bounced'),
        ('cancelled', 'Cancelled'),
    ]

    cheque_no = models.CharField(max_length=40)
    kind = models.CharField(max_length=10, choices=KIND)
    bank_account = models.ForeignKey(
        BankAccount, on_delete=models.PROTECT, related_name='cheques',
        help_text='For issued: drawer account. For received: deposit account.',
    )
    cheque_date = models.DateField()
    expected_clear_date = models.DateField(null=True, blank=True,
        help_text='Use for post-dated cheques (PDC).')
    amount = models.DecimalField(max_digits=15, decimal_places=2)

    party_type = models.CharField(max_length=10, blank=True,
        help_text='"Customer" or "Supplier"')
    party_id = models.PositiveIntegerField(null=True, blank=True)
    party_name = models.CharField(max_length=255, blank=True)

    status = models.CharField(max_length=12, choices=STATUS, default='pending')
    bounce_reason = models.CharField(max_length=255, blank=True)
    bounce_charge = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
        help_text='Bank charge debited on bounce (if any).',
    )

    # Original posting JE — Dr Bank Cr Trade-Receivables, etc.
    journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='cheques',
    )
    # If bounced, the reversal JE
    bounce_journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='bounced_cheques',
    )
    # Optional link back to a bill payment if this cheque paid a vendor bill
    bill_payment = models.ForeignKey(
        'bills.BillPayment', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='cheques',
    )

    notes = models.TextField(blank=True)
    location_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cheques_created',
    )

    class Meta:
        ordering = ['-cheque_date', '-id']
        indexes = [
            models.Index(fields=['kind', 'status']),
            models.Index(fields=['expected_clear_date']),
            models.Index(fields=['party_type', 'party_id']),
        ]
        constraints = [
            # Same drawer + cheque-no must be unique (banks reuse cheque numbers
            # but only inside a cheque book — within a single bank account they
            # are unique).
            models.UniqueConstraint(
                fields=['bank_account', 'cheque_no', 'kind'],
                name='banking_cheque_unique_per_account',
            ),
        ]

    def __str__(self):
        return f'{self.kind.title()} cheque {self.cheque_no} — {self.amount}'

    @property
    def is_pdc(self) -> bool:
        return bool(self.expected_clear_date and self.expected_clear_date > self.cheque_date)


class PettyCashFloat(models.Model):
    """Per-location petty cash imprest float — small-value cash kept on hand
    for routine expenses. Replenished from the bank when balance drops below
    `replenishment_threshold`.
    """

    location_id = models.PositiveIntegerField(unique=True)
    location_name = models.CharField(max_length=120, blank=True)
    chart_account = models.ForeignKey(
        'core.ChartOfAccount', on_delete=models.PROTECT,
        related_name='petty_cash_floats',
        help_text='Cash GL — typically 1110 (Cash in Hand) or a sub-account.',
    )
    imprest_amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        help_text='The standing float to be maintained.',
    )
    replenishment_threshold = models.DecimalField(
        max_digits=12, decimal_places=2,
        help_text='Trigger replenishment when current_balance < this.',
    )
    is_active = models.BooleanField(default=True)
    custodian_name = models.CharField(max_length=120, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['location_id']

    def __str__(self):
        return f'PettyCash@{self.location_id} (₹{self.imprest_amount})'


class PettyCashTransaction(models.Model):
    """One spend (or receipt) from a petty-cash float."""

    KIND_CHOICES = [
        ('spend', 'Spend (debit expense)'),
        ('receipt', 'Receipt into float (rare)'),
    ]

    float = models.ForeignKey(PettyCashFloat, on_delete=models.PROTECT,
                              related_name='transactions')
    date = models.DateField()
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default='spend')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    expense_account = models.ForeignKey(
        'core.ChartOfAccount', on_delete=models.PROTECT,
        related_name='petty_cash_transactions',
    )
    description = models.CharField(max_length=255)
    voucher_no = models.CharField(max_length=40, blank=True)
    journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='petty_cash_transactions',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='petty_cash_created',
    )

    class Meta:
        ordering = ['-date', '-id']
        indexes = [models.Index(fields=['float', 'date'])]

    def __str__(self):
        return f'{self.kind} ₹{self.amount} @ {self.float.location_id} on {self.date}'

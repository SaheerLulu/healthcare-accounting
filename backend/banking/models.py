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

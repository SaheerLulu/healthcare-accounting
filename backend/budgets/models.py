"""
Budget vs Actual.

Budget rows are at the GL-account × period × location level. The variance
report joins these against posted JEs to show absolute and % variance.
"""
from decimal import Decimal

from django.contrib.auth.models import User
from django.db import models


class Budget(models.Model):
    """One budget figure for an account in a period.

    `period` is YYYY-MM for monthly budgets, YYYY-Qx for quarterly, or just
    YYYY for annual — the variance report aggregates JEs accordingly.
    """

    PERIOD_KINDS = [
        ('monthly', 'Monthly'),
        ('quarterly', 'Quarterly'),
        ('annual', 'Annual'),
    ]

    period_kind = models.CharField(max_length=10, choices=PERIOD_KINDS, default='monthly')
    period = models.CharField(max_length=10, db_index=True,
        help_text='YYYY-MM (monthly), YYYY-Qx (quarterly), or YYYY (annual)')
    account = models.ForeignKey(
        'core.ChartOfAccount', on_delete=models.PROTECT, related_name='budgets',
    )
    cost_center = models.CharField(max_length=50, blank=True,
        help_text='Optional — restrict budget to a department / cost center.')
    location_id = models.PositiveIntegerField(null=True, blank=True)
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    notes = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='budgets_created',
    )

    class Meta:
        ordering = ['period', 'account__account_code']
        constraints = [
            models.UniqueConstraint(
                fields=['period', 'account', 'cost_center', 'location_id'],
                name='budgets_unique_per_period_account_cc_location',
            ),
        ]

    def __str__(self):
        return f'{self.account.account_code} — {self.period}: ₹{self.amount}'

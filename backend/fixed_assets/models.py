"""
Fixed-asset register + depreciation.

Aligned with Companies Act 2013 Schedule II (useful-life-based) and Income
Tax Act §32 (rate-based, WDV / SLM). The AssetClass record holds both so a
single asset row can compute either book or tax depreciation.
"""
from decimal import Decimal, ROUND_HALF_UP

from django.contrib.auth.models import User
from django.db import models


class AssetClass(models.Model):
    """A category of asset with its standard depreciation policy."""
    DEP_METHODS = [
        ('SLM', 'Straight Line Method'),
        ('WDV', 'Written Down Value'),
    ]

    code = models.CharField(max_length=30, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)

    dep_method = models.CharField(max_length=3, choices=DEP_METHODS, default='SLM')
    useful_life_years = models.PositiveSmallIntegerField(
        help_text='Per Companies Act 2013 Sch II (e.g. Computers=3, Furniture=10)',
    )
    salvage_value_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('5.00'),
        help_text='Default residual value (% of cost) — typically 5% per Sch II',
    )
    # WDV rate alternative (used only when dep_method='WDV')
    wdv_rate_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0.00'),
        help_text='WDV rate per IT Act §32 (e.g. Computers=40, Furniture=10).',
    )

    # Account mapping for posting JEs
    asset_account = models.ForeignKey(
        'core.ChartOfAccount', on_delete=models.PROTECT,
        related_name='asset_class_as_asset',
        help_text='Asset GL (e.g. Computers — at cost)',
    )
    accum_dep_account = models.ForeignKey(
        'core.ChartOfAccount', on_delete=models.PROTECT,
        related_name='asset_class_as_accum_dep',
        help_text='Accumulated Depreciation GL (contra-asset)',
    )
    dep_expense_account = models.ForeignKey(
        'core.ChartOfAccount', on_delete=models.PROTECT,
        related_name='asset_class_as_dep_expense',
        help_text='Depreciation Expense GL (P&L)',
    )

    class Meta:
        ordering = ['code']

    def __str__(self):
        return f'{self.code} — {self.name}'


class FixedAsset(models.Model):
    STATUS = [
        ('active', 'Active'),
        ('disposed', 'Disposed'),
        ('written_off', 'Written off'),
    ]

    asset_no = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    asset_class = models.ForeignKey(AssetClass, on_delete=models.PROTECT,
                                    related_name='assets')

    location_id = models.PositiveIntegerField(null=True, blank=True)
    serial_no = models.CharField(max_length=120, blank=True)
    vendor_name = models.CharField(max_length=255, blank=True)
    vendor_id = models.PositiveIntegerField(null=True, blank=True)

    acquisition_date = models.DateField()
    acquisition_cost = models.DecimalField(max_digits=15, decimal_places=2)
    salvage_value = models.DecimalField(max_digits=15, decimal_places=2,
                                        default=Decimal('0.00'))
    useful_life_months = models.PositiveSmallIntegerField(
        help_text='Override of asset_class.useful_life_years × 12 if needed.',
        default=0,
    )

    status = models.CharField(max_length=15, choices=STATUS, default='active')
    disposal_date = models.DateField(null=True, blank=True)
    disposal_proceeds = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    gain_loss_on_disposal = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )

    # Acquisition + disposal JE links
    acquisition_journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='acquired_assets',
    )
    disposal_journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='disposed_assets',
    )

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='assets_created',
    )

    class Meta:
        ordering = ['asset_no']
        indexes = [
            models.Index(fields=['status', 'asset_class']),
            models.Index(fields=['location_id', 'status']),
        ]

    def __str__(self):
        return f'{self.asset_no} — {self.name}'

    @property
    def effective_life_months(self) -> int:
        if self.useful_life_months:
            return self.useful_life_months
        return self.asset_class.useful_life_years * 12

    @property
    def effective_salvage_value(self) -> Decimal:
        """Residual value used for depreciation. An explicit per-asset
        salvage_value wins; otherwise fall back to the asset class's Schedule II
        percentage (default 5%) so SLM/WDV stop at the residual instead of
        depreciating the asset all the way to zero."""
        if self.salvage_value and self.salvage_value > 0:
            return self.salvage_value
        pct = (self.asset_class.salvage_value_pct or Decimal('0')) if self.asset_class_id else Decimal('0')
        return (self.acquisition_cost * pct / Decimal('100')).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)

    @property
    def depreciable_base(self) -> Decimal:
        return self.acquisition_cost - self.effective_salvage_value

    def accumulated_depreciation(self, *, as_of=None) -> Decimal:
        """Sum of all DepreciationEntry amounts up to `as_of`."""
        from django.db.models import Sum
        qs = self.depreciation_entries.all()
        if as_of:
            qs = qs.filter(period__lte=as_of.strftime('%Y-%m'))
        return qs.aggregate(s=Sum('amount'))['s'] or Decimal('0.00')

    def net_book_value(self, *, as_of=None) -> Decimal:
        return self.acquisition_cost - self.accumulated_depreciation(as_of=as_of)


class DepreciationEntry(models.Model):
    """One month's depreciation hit on one asset."""
    fixed_asset = models.ForeignKey(FixedAsset, on_delete=models.CASCADE,
                                    related_name='depreciation_entries')
    period = models.CharField(max_length=7, help_text='YYYY-MM')
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    method = models.CharField(max_length=3, choices=AssetClass.DEP_METHODS)
    journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='depreciation_entries',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-period']
        unique_together = [['fixed_asset', 'period']]
        indexes = [models.Index(fields=['period'])]

    def __str__(self):
        return f'{self.fixed_asset.asset_no} — {self.period}: {self.amount}'

from django.db import models
from django.db.models import Sum


class AccountingSettings(models.Model):
    company_name = models.CharField(max_length=255)
    gstin = models.CharField(max_length=15, blank=True)
    tan = models.CharField(max_length=10, blank=True)
    state_code = models.CharField(max_length=2, blank=True)
    financial_year_start = models.IntegerField(default=4)
    registered_address = models.TextField(blank=True)
    pan = models.CharField(max_length=10, blank=True)
    is_fy_closed = models.BooleanField(default=False)
    last_closed_fy = models.CharField(max_length=7, blank=True)  # e.g. "2024-25"
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'Accounting Settings'

    def __str__(self):
        return self.company_name

    def save(self, *args, **kwargs):
        if not self.pk and AccountingSettings.objects.exists():
            raise ValueError('Only one AccountingSettings instance is allowed.')
        super().save(*args, **kwargs)

    @classmethod
    def get_settings(cls):
        obj, _ = cls.objects.get_or_create(
            pk=1,
            defaults={'company_name': 'My Company'},
        )
        return obj


class ChartOfAccount(models.Model):
    ACCOUNT_TYPE_CHOICES = [
        ('ASSET', 'Asset'),
        ('LIABILITY', 'Liability'),
        ('EQUITY', 'Equity'),
        ('REVENUE', 'Revenue'),
        ('EXPENSE', 'Expense'),
    ]

    ACCOUNT_SUBTYPE_CHOICES = [
        ('Cash', 'Cash'),
        ('Bank', 'Bank'),
        ('Receivable', 'Receivable'),
        ('Payable', 'Payable'),
        ('Input_GST', 'Input GST'),
        ('Output_GST', 'Output GST'),
        ('TDS_Receivable', 'TDS Receivable'),
        ('TDS_Payable', 'TDS Payable'),
        ('Capital', 'Capital'),
        ('Retained_Earnings', 'Retained Earnings'),
        ('Sales', 'Sales'),
        ('Purchases', 'Purchases'),
        ('Other_Income', 'Other Income'),
        ('Other_Expense', 'Other Expense'),
    ]

    account_code = models.CharField(max_length=10, unique=True)
    account_name = models.CharField(max_length=255)
    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    account_subtype = models.CharField(max_length=50, choices=ACCOUNT_SUBTYPE_CHOICES, blank=True)
    parent = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='children',
    )
    is_leaf = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['account_code']

    def __str__(self):
        return f"{self.account_code} - {self.account_name}"

    def get_balance(self, start_date=None, end_date=None):
        from journals.models import JournalEntryLine

        qs = JournalEntryLine.objects.filter(account=self, entry__is_posted=True)

        if start_date:
            qs = qs.filter(entry__date__gte=start_date)
        if end_date:
            qs = qs.filter(entry__date__lte=end_date)

        totals = qs.aggregate(
            total_debit=Sum('debit'),
            total_credit=Sum('credit'),
        )

        total_debit = totals['total_debit'] or 0
        total_credit = totals['total_credit'] or 0

        return total_debit - total_credit


class AccountMapping(models.Model):
    """Maps semantic account keys to ChartOfAccount FKs, replacing hardcoded account codes."""

    KEY_CHOICES = [
        ('PURCHASES', 'Purchases'),
        ('INPUT_CGST', 'Input CGST'),
        ('INPUT_SGST', 'Input SGST'),
        ('INPUT_IGST', 'Input IGST'),
        ('TRADE_PAYABLES', 'Trade Payables'),
        ('SALES_POS', 'Sales - POS'),
        ('SALES_B2B', 'Sales - B2B'),
        ('OUTPUT_CGST', 'Output CGST'),
        ('OUTPUT_SGST', 'Output SGST'),
        ('OUTPUT_IGST', 'Output IGST'),
        ('CASH', 'Cash'),
        ('TRADE_RECEIVABLES', 'Trade Receivables'),
        ('SALES_RETURNS', 'Sales Returns'),
        ('PURCHASE_RETURNS', 'Purchase Returns'),
        ('TDS_RECEIVABLE', 'TDS Receivable'),
        ('TDS_PAYABLE', 'TDS Payable'),
        ('RETAINED_EARNINGS', 'Retained Earnings'),
        ('ROUND_OFF', 'Round Off'),
        ('RCM_LIABILITY', 'RCM GST Liability'),
        ('BANK', 'Bank'),
        ('SALARY_EXPENSE', 'Salary Expense'),
        ('PF_PAYABLE', 'PF Payable'),
        ('ESI_PAYABLE', 'ESI Payable'),
        ('PT_PAYABLE', 'Professional Tax Payable'),
        ('NET_SALARY_PAYABLE', 'Net Salary Payable'),
        ('RENT_EXPENSE', 'Rent Expense'),
        ('ELECTRICITY_EXPENSE', 'Electricity Expense'),
    ]

    # Default mapping from key to account_code for data migration
    DEFAULT_CODES = {
        'PURCHASES': '5100',
        'INPUT_CGST': '1140',
        'INPUT_SGST': '1150',
        'INPUT_IGST': '1160',
        'TRADE_PAYABLES': '2110',
        'SALES_POS': '4100',
        'SALES_B2B': '4200',
        'OUTPUT_CGST': '2120',
        'OUTPUT_SGST': '2130',
        'OUTPUT_IGST': '2140',
        'CASH': '1110',
        'TRADE_RECEIVABLES': '1130',
        'SALES_RETURNS': '5200',
        'PURCHASE_RETURNS': '5300',
        'TDS_RECEIVABLE': '1170',
        'TDS_PAYABLE': '2150',
        'RETAINED_EARNINGS': '3200',
        'ROUND_OFF': '6100',
        'RCM_LIABILITY': '2160',
        'BANK': '1120',
        'SALARY_EXPENSE': '5400',
        'PF_PAYABLE': '2170',
        'ESI_PAYABLE': '2180',
        'PT_PAYABLE': '2190',
        'NET_SALARY_PAYABLE': '2200',
        'RENT_EXPENSE': '5410',
        'ELECTRICITY_EXPENSE': '5420',
    }

    key = models.CharField(max_length=30, unique=True, choices=KEY_CHOICES)
    account = models.ForeignKey(
        ChartOfAccount,
        on_delete=models.PROTECT,
        related_name='mappings',
    )

    class Meta:
        ordering = ['key']

    def __str__(self):
        return f"{self.key} → {self.account}"

    @classmethod
    def get_all_mappings(cls):
        """Return dict of key→ChartOfAccount for all mappings."""
        return {m.key: m.account for m in cls.objects.select_related('account').all()}

    @classmethod
    def get_account(cls, key):
        """Get ChartOfAccount for a semantic key; raises ValueError if not configured."""
        try:
            return cls.objects.select_related('account').get(key=key).account
        except cls.DoesNotExist:
            raise ValueError(f"Account mapping not configured for key: {key}")

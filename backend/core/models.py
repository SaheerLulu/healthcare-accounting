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
    bill_approval_threshold = models.DecimalField(
        max_digits=15, decimal_places=2, default=0,
        help_text='Bills above this amount require approval before posting. '
                  '0 = no approval required (default).',
    )
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

    # account_code is unique per (code, location_id). NULL location_id =
    # shared template (used for GST, equity, suspense, round-off). Concrete
    # per-store clones carry the location_id and a suffixed code like
    # "1110-MUM". See [[per-location-coa]].
    account_code = models.CharField(max_length=20)
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
    location_id = models.PositiveIntegerField(
        null=True, blank=True, db_index=True,
        help_text='NULL = shared/template account; non-NULL = per-store clone.',
    )
    # Tally-style per-party ledger link. When set, this leaf IS the ledger
    # account for one inventory supplier/customer (a "Sundry Creditor/Debtor"
    # ledger) — see [[party-ledger-per-party]] and core.party_ledgers. Party
    # ledgers are ALWAYS shared (location_id NULL) so a party has ONE
    # consolidated statement across stores; the CheckConstraint below enforces
    # that. Blank/NULL for every ordinary account.
    party_type = models.CharField(
        max_length=10, blank=True, default='',
        choices=[('', '—'), ('Supplier', 'Supplier'), ('Customer', 'Customer')],
        help_text='Set on per-party ledger leaves; blank for ordinary accounts.',
    )
    party_id = models.PositiveIntegerField(
        null=True, blank=True,
        help_text='Inventory supplier/customer PK this ledger represents.',
    )
    is_leaf = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['account_code']
        indexes = [
            models.Index(fields=['party_type', 'party_id']),
            models.Index(fields=['account_subtype', 'location_id']),
        ]
        constraints = [
            # nulls_distinct=False so two template rows (location_id IS NULL)
            # with the same code are also blocked — there should only ever be
            # one template per code.
            models.UniqueConstraint(
                fields=['account_code', 'location_id'],
                name='unique_account_code_per_location',
                nulls_distinct=False,
            ),
            # One ledger per party. Partial: only constrains party leaves.
            models.UniqueConstraint(
                fields=['party_type', 'party_id'],
                condition=models.Q(party_id__isnull=False),
                name='uniq_party_ledger',
            ),
            # Party ledgers are shared-only: a row may carry party_id OR
            # location_id, never both. Guarantees the consolidated statement.
            models.CheckConstraint(
                condition=models.Q(party_id__isnull=True) | models.Q(location_id__isnull=True),
                name='party_ledger_shared_only',
            ),
        ]

    def __str__(self):
        return f"{self.account_code} - {self.account_name}"

    def get_balance(self, start_date=None, end_date=None):
        from journals.models import JournalEntryLine

        # Optional/memorandum vouchers do not affect the books.
        qs = JournalEntryLine.objects.filter(
            account=self,
            entry__is_posted=True,
            entry__is_optional=False,
            entry__is_memorandum=False,
        )

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
        ('CLOSING_STOCK', 'Closing Stock'),
        ('INVENTORY_LOSS', 'Inventory Loss / Shrinkage'),
        ('EXPIRY_LOSS', 'Expired Stock Write-off'),
        ('STOCK_TRANSFER_TRANSIT', 'Stock In Transit (inter-branch)'),
        ('TCS_PAYABLE', 'TCS Payable'),
        ('BAD_DEBTS_EXPENSE', 'Bad Debts Expense (P&L)'),
        ('PROVISION_BAD_DEBTS', 'Provision for Doubtful Debts (contra-receivable)'),
        ('PETTY_CASH', 'Petty Cash'),
        # New mappings for "every activity has accounts" coverage
        ('BANK_CHARGES', 'Bank Charges'),
        ('INTEREST_EXPENSE', 'Interest on Loans / Borrowings'),
        ('INTEREST_INCOME', 'Interest Received'),
        ('DOCTOR_FEES', 'Doctor / Consultant Fees'),
        ('DISCOUNT_ALLOWED', 'Discount Allowed (to customers)'),
        ('DISCOUNT_RECEIVED', 'Discount Received (from suppliers)'),
        ('GST_LATE_FEE', 'GST Late Fee Expense'),
        ('DEPRECIATION_EXPENSE', 'Depreciation Expense'),
        ('PROFESSIONAL_FEES', 'Professional / Consulting Fees'),
        ('AUDIT_FEES', 'Audit Fees'),
        ('LEGAL_FEES', 'Legal Fees'),
        ('INSURANCE_EXPENSE', 'Insurance Expense'),
        ('TRAVEL_CONVEYANCE', 'Travel & Conveyance'),
        ('AMC_CHARGES', 'AMC Charges'),
        ('REPAIRS_MAINTENANCE', 'Repairs & Maintenance'),
        ('OFFICE_MAINTENANCE', 'Office Maintenance'),
        ('PRINTING_STATIONERY', 'Printing & Stationery'),
        ('POSTAGE_COURIER', 'Postage & Courier'),
        ('INTERNET_TELEPHONE', 'Internet & Telephone'),
        ('STAFF_WELFARE', 'Staff Welfare'),
        ('STAFF_ADVANCE', 'Advance to Employees'),
        ('SUPPLIER_ADVANCE', 'Advance to Suppliers'),
        ('CUSTOMER_ADVANCE', 'Customer Advance Received'),
        ('CHEQUES_OUTSTANDING', 'Cheques Issued (Outstanding)'),
        ('SUSPENSE', 'Suspense Account'),
        ('COGS', 'Cost of Goods Sold (perpetual mode)'),
        ('OPENING_BALANCE_EQUITY', 'Opening Balance Equity'),
    ]

    # Default mapping from key to account_code for data migration. These map
    # to the codes seeded by `manage.py seed_coa`.
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
        'CLOSING_STOCK': '1190',
        'INVENTORY_LOSS': '5540',
        'EXPIRY_LOSS': '5550',
        'STOCK_TRANSFER_TRANSIT': '1191',
        'TCS_PAYABLE': '2210',
        'BAD_DEBTS_EXPENSE': '5480',
        'PROVISION_BAD_DEBTS': '2156',
        'PETTY_CASH': '1115',
        # Activity-coverage mappings
        'BANK_CHARGES': '5450',
        'INTEREST_EXPENSE': '5451',
        'INTEREST_INCOME': '4910',
        'DOCTOR_FEES': '5441',
        'DISCOUNT_ALLOWED': '5210',
        'DISCOUNT_RECEIVED': '5310',
        'GST_LATE_FEE': '5454',
        'DEPRECIATION_EXPENSE': '5481',
        'PROFESSIONAL_FEES': '5440',
        'AUDIT_FEES': '5442',
        'LEGAL_FEES': '5443',
        'INSURANCE_EXPENSE': '5430',
        'TRAVEL_CONVEYANCE': '5472',
        'AMC_CHARGES': '5426',
        'REPAIRS_MAINTENANCE': '5424',
        'OFFICE_MAINTENANCE': '5423',
        'PRINTING_STATIONERY': '5460',
        'POSTAGE_COURIER': '5461',
        'INTERNET_TELEPHONE': '5422',
        'STAFF_WELFARE': '5404',
        'STAFF_ADVANCE': '1320',
        'SUPPLIER_ADVANCE': '1310',
        'CUSTOMER_ADVANCE': '2196',
        'CHEQUES_OUTSTANDING': '2113',
        'SUSPENSE': '6200',
        'COGS': '5560',
        'OPENING_BALANCE_EQUITY': '3300',
    }

    key = models.CharField(max_length=30, choices=KEY_CHOICES)
    account = models.ForeignKey(
        ChartOfAccount,
        on_delete=models.PROTECT,
        related_name='mappings',
    )
    # NULL = global default (used when no per-location override exists or for
    # roles that intentionally stay shared, e.g. OUTPUT_*GST, RETAINED_EARNINGS).
    location_id = models.PositiveIntegerField(
        null=True, blank=True, db_index=True,
        help_text='NULL = shared default; non-NULL = per-store override.',
    )

    # Account roles that are NEVER per-location — GST/TDS roll up under a
    # single GSTIN/TAN and equity/control accounts are inherently consolidated.
    # Anything not in this set is eligible to be cloned per-store.
    SHARED_KEYS = frozenset({
        'OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST',
        'INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST',
        'TDS_RECEIVABLE', 'TDS_PAYABLE', 'TCS_PAYABLE',
        'RCM_LIABILITY', 'GST_LATE_FEE',
        'RETAINED_EARNINGS', 'OPENING_BALANCE_EQUITY',
        'SUSPENSE', 'ROUND_OFF',
    })

    class Meta:
        ordering = ['key', 'location_id']
        constraints = [
            models.UniqueConstraint(
                fields=['key', 'location_id'],
                name='unique_mapping_per_location',
                nulls_distinct=False,
            ),
        ]

    def __str__(self):
        loc = f' @loc{self.location_id}' if self.location_id else ''
        return f"{self.key}{loc} → {self.account}"

    @classmethod
    def get_all_mappings(cls, location_id=None):
        """Return dict of key→ChartOfAccount.

        When `location_id` is given, location-specific mappings shadow the
        NULL-location defaults. When omitted, only NULL-location defaults
        are returned (legacy behaviour).
        """
        from django.db.models import Q
        qs = cls.objects.select_related('account')
        if location_id:
            qs = qs.filter(Q(location_id=location_id) | Q(location_id__isnull=True))
        else:
            qs = qs.filter(location_id__isnull=True)
        out = {}
        for m in qs:
            # Per-location row wins over default for the same key.
            if m.key not in out or m.location_id is not None:
                out[m.key] = m.account
        return out

    @classmethod
    def get_account(cls, key, location_id=None):
        """Get ChartOfAccount for a semantic key, preferring the location-specific
        mapping and falling back to the NULL-location default."""
        from django.db.models import Q
        qs = cls.objects.select_related('account').filter(key=key)
        if location_id:
            qs = qs.filter(Q(location_id=location_id) | Q(location_id__isnull=True))
        else:
            qs = qs.filter(location_id__isnull=True)
        rows = list(qs)
        if not rows:
            raise ValueError(f"Account mapping not configured for key: {key}")
        # Prefer the location-specific row over the NULL default.
        rows.sort(key=lambda r: (r.location_id is None, r.location_id or 0))
        return rows[0].account


class AccountingRole(models.Model):
    """
    WP 610 — accounting roles with discrete capability flags.

    These are intentionally **separate from inventory roles** because the
    accounting system has its own approval/post permissions that don't map
    cleanly to inventory's role model. An admin assigns one of these roles
    to a Django user via the admin UI or the seed_roles management command.
    """

    CODE_CHOICES = [
        ('READ_ONLY', 'Read-only'),
        ('BOOKKEEPER', 'Bookkeeper'),
        ('SENIOR_ACCOUNTANT', 'Senior Accountant'),
        ('CFO', 'CFO'),
        ('AUDITOR', 'Auditor'),
    ]

    code = models.CharField(max_length=30, unique=True, choices=CODE_CHOICES)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)

    # Capability flags
    can_view = models.BooleanField(default=True)
    can_create_journals = models.BooleanField(default=False)
    can_post_journals = models.BooleanField(default=False)
    can_reverse_journals = models.BooleanField(default=False)
    can_manage_masters = models.BooleanField(default=False)
    can_manage_settings = models.BooleanField(default=False)
    can_lock_period = models.BooleanField(default=False)
    can_close_fy = models.BooleanField(default=False)
    can_view_audit = models.BooleanField(default=False)

    users = models.ManyToManyField(
        'auth.User', blank=True, related_name='accounting_roles',
    )

    DEFAULT_PERMISSIONS = {
        'READ_ONLY': dict(can_view=True),
        'BOOKKEEPER': dict(can_view=True, can_create_journals=True),
        'SENIOR_ACCOUNTANT': dict(
            can_view=True, can_create_journals=True, can_post_journals=True,
            can_reverse_journals=True, can_manage_masters=True,
        ),
        'CFO': dict(
            can_view=True, can_create_journals=True, can_post_journals=True,
            can_reverse_journals=True, can_manage_masters=True,
            can_manage_settings=True, can_lock_period=True, can_close_fy=True,
            can_view_audit=True,
        ),
        'AUDITOR': dict(can_view=True, can_view_audit=True),
    }

    class Meta:
        ordering = ['code']

    def __str__(self):
        return self.name

    @classmethod
    def has_capability(cls, user, capability: str) -> bool:
        """True if `user` is in any role granting `capability`. Superusers always pass."""
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        return cls.objects.filter(users=user, **{capability: True}).exists()


# ─── Tally Cost Categories & Cost Centres ───────────────────────────────────


class CostCategory(models.Model):
    """Tally-style cost-category — groups related cost centres (Department,
    Doctor, Project, etc.). One voucher line may carry one cost centre per
    category (multiple categories = multi-dimensional allocation)."""

    name = models.CharField(max_length=100, unique=True)
    description = models.CharField(max_length=255, blank=True)
    allocate_revenue = models.BooleanField(
        default=True,
        help_text='Whether this category applies to revenue ledgers (Tally semantics).',
    )
    allocate_non_revenue = models.BooleanField(
        default=True,
        help_text='Whether this category applies to non-revenue ledgers.',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name_plural = 'Cost Categories'

    def __str__(self):
        return self.name


class CostCentre(models.Model):
    """Hierarchical cost centre under a category (e.g. Department > OPD)."""

    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20, blank=True, help_text='Short label')
    category = models.ForeignKey(
        CostCategory, on_delete=models.CASCADE, related_name='centres'
    )
    parent = models.ForeignKey(
        'self', null=True, blank=True,
        on_delete=models.CASCADE, related_name='children',
    )
    location_id = models.IntegerField(
        null=True, blank=True,
        help_text='Optional inventory-system location to scope this centre.',
    )
    is_active = models.BooleanField(default=True)
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['category__name', 'name']
        unique_together = [('category', 'name')]

    def __str__(self):
        return f'{self.category.name} > {self.name}'

from decimal import Decimal
from django.db import models


class LocationRO(models.Model):
    name = models.CharField(max_length=255)
    complete_name = models.CharField(max_length=255)
    usage = models.CharField(max_length=50)

    class Meta:
        managed = False
        db_table = 'product_master_location'

    def __str__(self):
        return self.name


class SystemSettingsRO(models.Model):
    """Read-only proxy for the pharmacy `dashboard_systemsettings` table.

    Per-store registration settings, one row per location (a NULL-location row
    is the pharmacy's global defaults). Accounting reads each store's GSTIN from
    here so it never has to be re-typed — see
    ``inventory_reader.store_settings`` and ``core.LocationTaxProfile.resolve``.
    Never written to (owned by the pharmacy app)."""
    location_id = models.PositiveIntegerField(null=True, blank=True)
    store_name = models.CharField(max_length=255)
    store_address = models.TextField()
    store_phone = models.CharField(max_length=20)
    store_email = models.EmailField(max_length=255)
    gst_number = models.CharField(max_length=50)
    drug_license = models.CharField(max_length=100)

    class Meta:
        managed = False
        db_table = 'dashboard_systemsettings'

    def __str__(self):
        return f'settings loc{self.location_id}: {self.gst_number or "(no GSTIN)"}'


class SupplierRO(models.Model):
    company_name = models.CharField(max_length=255)
    gst_no = models.CharField(max_length=50)
    # Auto-created counterparty for inter-store transfers (STORE-{n}); their
    # documents are stock relocations, never real purchases.
    is_internal = models.BooleanField(default=False)
    contact_person = models.CharField(max_length=255)
    phone = models.CharField(max_length=20)
    email = models.EmailField(blank=True)
    address = models.TextField()
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=100)
    pincode = models.CharField(max_length=10)
    payment_terms = models.CharField(max_length=50)
    credit_days = models.IntegerField(default=0)
    status = models.CharField(max_length=20)
    location = models.ForeignKey(
        LocationRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'supplier_master_supplier'

    def __str__(self):
        return self.company_name


class CustomerRO(models.Model):
    customer_name = models.CharField(max_length=255)
    customer_code = models.CharField(max_length=100, null=True, blank=True)
    gst_no = models.CharField(max_length=50, blank=True)
    # Auto-created counterparty for inter-store transfers (STORE-{n}); their
    # documents are stock relocations, never real sales.
    is_internal = models.BooleanField(default=False)
    phone = models.CharField(max_length=20)
    email = models.EmailField(blank=True)
    address = models.TextField()
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=100)
    pincode = models.CharField(max_length=10)
    payment_terms = models.CharField(max_length=50)
    credit_days = models.IntegerField(default=0)
    credit_limit = models.DecimalField(max_digits=10, decimal_places=2)
    customer_type = models.CharField(max_length=50)
    status = models.CharField(max_length=20)
    location = models.ForeignKey(
        LocationRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'customer_master_customer'

    def __str__(self):
        return self.customer_name


class ProductRO(models.Model):
    name = models.CharField(max_length=255)
    default_code = models.CharField(max_length=100, blank=True)
    pharma_hsn_code = models.CharField(max_length=50, blank=True)
    pharma_gst_percent = models.DecimalField(max_digits=5, decimal_places=2)
    pharma_molecule = models.CharField(max_length=500, blank=True)
    active = models.BooleanField(default=True)
    location = models.ForeignKey(
        LocationRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )

    class Meta:
        managed = False
        db_table = 'product_master_product'

    def __str__(self):
        return self.name


class PurchaseOrderRO(models.Model):
    supplier = models.ForeignKey(
        SupplierRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    bill_no = models.CharField(max_length=100)
    bill_date = models.DateField(null=True, blank=True)
    gst_percent = models.DecimalField(max_digits=5, decimal_places=2)
    payment_type = models.CharField(max_length=50)
    transport_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    other_charges = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # Header-level POST-tax discount on the whole bill (pharmacy audit H11).
    # Reduces what is payable to the supplier; does NOT reduce ITC (the
    # supplier charged tax on the pre-discount value — no credit note).
    additional_discount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    remarks = models.TextField(blank=True)
    round_off = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    state = models.CharField(max_length=50)
    supply_type = models.CharField(max_length=20, blank=True)  # intra_state/inter_state
    total_cgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_sgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_igst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    location = models.ForeignKey(
        LocationRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    # Inter/intra-store transfer markers (Indent-origin GRNs). '' = real purchase.
    transfer_kind = models.CharField(max_length=20, blank=True, default='')
    transfer_source_location_id = models.PositiveIntegerField(null=True, blank=True)
    source_indent_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField()

    TRANSFER_KINDS = ('inter_store', 'intra_store')

    @property
    def is_transfer(self):
        return self.transfer_kind in self.TRANSFER_KINDS

    class Meta:
        managed = False
        db_table = 'purchase_entry_purchaseorder'

    def __str__(self):
        return f"{self.bill_no} ({self.state})"


class PurchaseOrderLineRO(models.Model):
    purchase_order = models.ForeignKey(
        PurchaseOrderRO, on_delete=models.DO_NOTHING,
        related_name='lines', db_constraint=False
    )
    product = models.ForeignKey(
        ProductRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    product_name = models.CharField(max_length=255, blank=True)
    batch_no = models.CharField(max_length=100, blank=True)
    expiry_month = models.CharField(max_length=7, blank=True)
    quantity = models.IntegerField()
    free_qty = models.IntegerField(default=0)
    purchase_rate = models.DecimalField(max_digits=10, decimal_places=2)
    mrp = models.DecimalField(max_digits=10, decimal_places=2)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2)
    tax_percent = models.DecimalField(max_digits=5, decimal_places=2)
    cgst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    sgst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    igst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'purchase_entry_purchaseorderline'


class POSOrderRO(models.Model):
    invoice_no = models.CharField(max_length=100, blank=True)
    customer = models.ForeignKey(
        CustomerRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    location = models.ForeignKey(
        LocationRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    sale_date = models.DateTimeField()
    payment_type = models.CharField(max_length=50)
    gst_percent = models.DecimalField(max_digits=5, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2)
    # Loyalty points redeemed against this bill. Part of the total_amount
    # equation (total = subtotal − discount − loyalty_redemption + round_off),
    # so the JE must book it or the entry won't balance.
    loyalty_redemption_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    round_off = models.DecimalField(max_digits=10, decimal_places=2)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=20)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'pos_posorder'

    def __str__(self):
        return self.invoice_no or f"POS#{self.id}"


class POSOrderLineRO(models.Model):
    pos_order = models.ForeignKey(
        POSOrderRO, on_delete=models.DO_NOTHING,
        related_name='lines', db_constraint=False
    )
    product = models.ForeignKey(
        ProductRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    quantity = models.IntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2)
    tax_percent = models.DecimalField(max_digits=5, decimal_places=2)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)
    # Loose sale: `quantity` is the TABLET count; qty_per_pack converts it to
    # pack-equivalents (the unit purchases and the weighted-avg cost use).
    is_loose = models.BooleanField(default=False)
    qty_per_pack = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'pos_posorderline'


class POSPaymentRO(models.Model):
    """Read-only proxy for pos.POSPayment — per-tender settlement rows of a
    POS order (split payments: part cash, part UPI, …)."""
    pos_order = models.ForeignKey(
        POSOrderRO, on_delete=models.DO_NOTHING,
        related_name='payments', db_constraint=False
    )
    payment_method = models.CharField(max_length=20)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    reference = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'pos_pospayment'


class B2BSalesOrderRO(models.Model):
    invoice_no = models.CharField(max_length=100, blank=True)
    customer = models.ForeignKey(
        CustomerRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    location = models.ForeignKey(
        LocationRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    sale_date = models.DateField(null=True, blank=True)
    payment_type = models.CharField(max_length=50)
    gst_percent = models.DecimalField(max_digits=5, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2)
    round_off = models.DecimalField(max_digits=10, decimal_places=2)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    supply_type = models.CharField(max_length=20, blank=True)
    total_cgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_sgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_igst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Header extra-charges block: total_amount = subtotal + tax + these
    # + freight_tax − discount + round_off (see pharmacy b2b_sales/views.py).
    freight_charge = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    freight_tax_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    freight_tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    service_charge = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    packing_charge = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    transportation_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    other_charges = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # Set when this "sale" is the supplying leg of an inter-store transfer.
    source_indent_id = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=20)
    created_at = models.DateTimeField()

    @property
    def is_internal_transfer(self):
        return self.source_indent_id is not None

    class Meta:
        managed = False
        db_table = 'b2b_sales_b2bsalesorder'

    def __str__(self):
        return self.invoice_no or f"B2B#{self.id}"


class B2BSalesOrderLineRO(models.Model):
    sales_order = models.ForeignKey(
        B2BSalesOrderRO, on_delete=models.DO_NOTHING,
        related_name='lines', db_constraint=False
    )
    product = models.ForeignKey(
        ProductRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    quantity = models.IntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2)
    tax_percent = models.DecimalField(max_digits=5, decimal_places=2)
    cgst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    sgst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    igst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)
    # Same loose-vs-pack semantics as POS lines.
    is_loose = models.BooleanField(default=False)
    qty_per_pack = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'b2b_sales_b2bsalesorderline'


class SalesReturnRO(models.Model):
    return_no = models.CharField(max_length=100, blank=True)
    return_type = models.CharField(max_length=10)
    customer = models.ForeignKey(
        CustomerRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    location = models.ForeignKey(
        LocationRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    original_order = models.ForeignKey(
        POSOrderRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    original_b2b_order = models.ForeignKey(
        B2BSalesOrderRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    return_date = models.DateTimeField()
    gst_percent = models.DecimalField(max_digits=5, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    round_off = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    reason = models.TextField(blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=20)
    # Operator-selected refund route ('cash' | 'bank' | '') for non-credit
    # originals; blank = derive from the original order's payment_type.
    refund_method = models.CharField(max_length=10, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'sales_return_salesreturn'

    def __str__(self):
        return self.return_no or f"RET#{self.id}"


class SalesReturnLineRO(models.Model):
    sales_return = models.ForeignKey(
        SalesReturnRO, on_delete=models.DO_NOTHING,
        related_name='lines', db_constraint=False
    )
    product = models.ForeignKey(
        ProductRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    quantity = models.IntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2)
    tax_percent = models.DecimalField(max_digits=5, decimal_places=2)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        managed = False
        db_table = 'sales_return_salesreturnline'


class PurchaseReturnRO(models.Model):
    """Read-only proxy for purchase returns from inventory system."""
    return_no = models.CharField(max_length=100, blank=True)
    supplier = models.ForeignKey(
        SupplierRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    original_purchase_order = models.ForeignKey(
        PurchaseOrderRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    location = models.ForeignKey(
        LocationRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    return_date = models.DateField()
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    total_cgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_sgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_igst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    round_off = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    supply_type = models.CharField(max_length=20, blank=True)
    reason = models.TextField(blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=20)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'purchase_return_purchasereturn'

    def __str__(self):
        return self.return_no or f"PRET#{self.id}"


class PurchaseReturnLineRO(models.Model):
    purchase_return = models.ForeignKey(
        PurchaseReturnRO, on_delete=models.DO_NOTHING,
        related_name='lines', db_constraint=False
    )
    product = models.ForeignKey(
        ProductRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    batch_no = models.CharField(max_length=100, blank=True)
    expiry_month = models.CharField(max_length=7, blank=True)
    quantity = models.IntegerField()
    purchase_rate = models.DecimalField(max_digits=10, decimal_places=2)
    mrp = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tax_percent = models.DecimalField(max_digits=5, decimal_places=2)
    cgst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    sgst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    igst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'purchase_return_purchasereturnline'


class PurchaseReversalRO(models.Model):
    """Read-only proxy for purchase reversals (internal corrections of a
    confirmed GRN). Distinct from purchase returns; posts its own reversal JE."""
    reversal_no = models.CharField(max_length=100, blank=True)
    supplier = models.ForeignKey(
        SupplierRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    original_purchase_order = models.ForeignKey(
        PurchaseOrderRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    location = models.ForeignKey(
        LocationRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    reversal_type = models.CharField(max_length=10)  # full / partial
    reversal_date = models.DateField()
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    total_cgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_sgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_igst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    round_off = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    supply_type = models.CharField(max_length=20, blank=True)
    reason = models.TextField(blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=20)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'purchase_reversal_purchasereversal'

    def __str__(self):
        return self.reversal_no or f"PREV#{self.id}"


class PurchaseReversalLineRO(models.Model):
    purchase_reversal = models.ForeignKey(
        PurchaseReversalRO, on_delete=models.DO_NOTHING,
        related_name='lines', db_constraint=False
    )
    product = models.ForeignKey(
        ProductRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )
    batch_no = models.CharField(max_length=100, blank=True)
    expiry_month = models.CharField(max_length=7, blank=True)
    quantity = models.IntegerField()
    purchase_rate = models.DecimalField(max_digits=10, decimal_places=2)
    mrp = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    tax_percent = models.DecimalField(max_digits=5, decimal_places=2)
    taxable_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    cgst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    sgst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    igst_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'purchase_reversal_purchasereversalline'


class PurchaseAmendmentRO(models.Model):
    """Read-only proxy for purchase amendments (in-place correction of a
    confirmed purchase that went back through approval). Once `applied`, the
    sync must reverse the stale purchase JE and repost it from the PO's
    corrected values — see sync_purchase_amendments."""
    purchase_order = models.ForeignKey(
        PurchaseOrderRO, on_delete=models.DO_NOTHING,
        related_name='amendments', db_constraint=False,
    )
    status = models.CharField(max_length=20)  # pending / applied / rejected / cancelled
    prev_state = models.CharField(max_length=50, blank=True)
    reason = models.TextField(blank=True)
    original_data = models.JSONField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'purchase_entry_purchaseamendment'

    def __str__(self):
        return f"AMD#{self.id} PO {self.purchase_order_id} ({self.status})"


class StockMovementRO(models.Model):
    product = models.ForeignKey(
        ProductRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    location = models.ForeignKey(
        LocationRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    movement_type = models.CharField(max_length=30)
    # Signed: +ve = stock in, -ve = stock out (e.g. write-off / shortage).
    # CAUTION: loose (tablet-level) sales record the TABLET count here while
    # pack movements record strips — use the quantity_before/after strip
    # snapshots when you need pack-unit deltas (valuation, recon).
    quantity = models.IntegerField()
    quantity_before = models.IntegerField(default=0)
    quantity_after = models.IntegerField(default=0)
    lot_name = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    reference_type = models.CharField(max_length=50, blank=True)
    reference_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'inventory_stockmovement'


# ─── Opening Stock (inventory-side seeding) ─────────────────────────────────


class OpeningStockRO(models.Model):
    """Read-only proxy onto the inventory app's OpeningStock header."""
    location = models.ForeignKey(
        LocationRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    opening_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    # 'intra' / 'inter' — RAW pharmacy column value, NOT this repo's
    # 'intra_state'/'inter_state' vocabulary (core/gst_utils). Do not normalize.
    supply_type = models.CharField(max_length=10, blank=True)
    created_by_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'inventory_openingstock'


class OpeningStockLineRO(models.Model):
    """Read-only proxy onto the per-product lines of an opening-stock entry."""
    opening_stock = models.ForeignKey(
        OpeningStockRO, on_delete=models.DO_NOTHING, db_constraint=False,
        related_name='lines',
    )
    product = models.ForeignKey(
        ProductRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    batch_no = models.CharField(max_length=100, blank=True)
    expiry_month = models.CharField(max_length=7, blank=True)
    quantity = models.IntegerField()
    purchase_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    mrp = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # GST on the purchase value (qty × rate), captured at entry time so the
    # opening JV can bring the input tax credit onto the books.
    tax_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    tax_value = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'inventory_openingstockline'


class OpeningStockCorrectionRO(models.Model):
    """Read-only proxy onto an edit request for an opening-stock entry.

    The pharmacy applies approved corrections to its lines and stock; the
    accounting sync reads the old→new snapshots here to post a delta JV
    (the original OpeningStock JV is never rewritten)."""
    opening_stock = models.ForeignKey(
        OpeningStockRO, on_delete=models.DO_NOTHING, db_constraint=False,
        related_name='corrections',
    )
    location = models.ForeignKey(
        LocationRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    status = models.CharField(max_length=20)  # pending / approved / rejected
    reason = models.TextField(blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'inventory_openingstockcorrection'


class OpeningStockCorrectionLineRO(models.Model):
    """Old→new value snapshot for one corrected opening-stock line."""
    correction = models.ForeignKey(
        OpeningStockCorrectionRO, on_delete=models.DO_NOTHING, db_constraint=False,
        related_name='lines',
    )
    old_quantity = models.IntegerField(default=0)
    old_purchase_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    old_tax_value = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    new_quantity = models.IntegerField(default=0)
    new_purchase_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    new_tax_value = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        managed = False
        db_table = 'inventory_openingstockcorrectionline'


# ─── User / Role / Location Assignment (read-only from inventory) ────────────

class RoleRO(models.Model):
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=50)

    class Meta:
        managed = False
        db_table = 'user_management_role'

    def __str__(self):
        return self.name


class UserProfileRO(models.Model):
    user = models.OneToOneField(
        'auth.User', on_delete=models.DO_NOTHING, db_constraint=False
    )
    role = models.ForeignKey(
        RoleRO, null=True, blank=True,
        on_delete=models.DO_NOTHING, db_constraint=False
    )

    class Meta:
        managed = False
        db_table = 'user_management_userprofile'

    def __str__(self):
        return f"Profile({self.user_id})"


class UserLocationAssignmentRO(models.Model):
    user_profile = models.ForeignKey(
        UserProfileRO, on_delete=models.DO_NOTHING,
        related_name='location_assignments', db_constraint=False
    )
    location = models.ForeignKey(
        LocationRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'user_management_userlocationassignment'


class DispatchEntryRO(models.Model):
    """Read-only proxy for dispatch.DispatchEntry — goods-movement register
    (courier/transport details, delivery challan, e-way bill number)."""
    source_type = models.CharField(max_length=10)
    source_order_id = models.PositiveIntegerField(null=True, blank=True)
    invoice_no = models.CharField(max_length=100, blank=True)
    invoice_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    eway_bill_no = models.CharField(max_length=50, blank=True)
    challan_no = models.CharField(max_length=100, blank=True)
    dispatch_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20)
    location = models.ForeignKey(
        LocationRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'dispatch_dispatchentry'


class FeeCollectionRO(models.Model):
    """Read-only proxy for front_office.FeeCollection — doctor consultation /
    OPD fees collected at the front desk. Healthcare services by clinical
    establishments are GST-exempt (Notification 12/2017-CT(R)), so the sync
    books these as exempt service income with no output-tax legs."""
    fee_id = models.CharField(max_length=20)
    patient_id = models.PositiveIntegerField(null=True, blank=True)
    doctor_id = models.PositiveIntegerField(null=True, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    payment_mode = models.CharField(max_length=20)
    payment_status = models.CharField(max_length=20)
    # FO widened this column to 40 for composite invoice receipts ('INV-…/n').
    receipt_number = models.CharField(max_length=40, blank=True)
    collected_at = models.DateTimeField(null=True, blank=True)
    location = models.ForeignKey(
        LocationRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'front_office_feecollection'

    def __str__(self):
        return f"Fee {self.fee_id} ₹{self.amount}"


class PettyCashTxnRO(models.Model):
    """Read-only proxy for inventory.PettyCashTxn (cash-drawer movements
    recorded at the pharmacy counter). The sync service posts the matching
    journals (Dr Bank/Cr Cash for deposits; Dr Petty Expenses/Cr Cash)."""
    location = models.ForeignKey(
        LocationRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    txn_type = models.CharField(max_length=20)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    txn_date = models.DateField()
    description = models.CharField(max_length=255, blank=True)
    bank_reference = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'inventory_pettycashtxn'

    def __str__(self):
        return f"PettyCash#{self.id} {self.txn_type} {self.amount}"

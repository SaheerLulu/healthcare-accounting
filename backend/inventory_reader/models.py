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


class SupplierRO(models.Model):
    company_name = models.CharField(max_length=255)
    gst_no = models.CharField(max_length=50)
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
    created_at = models.DateTimeField()

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

    class Meta:
        managed = False
        db_table = 'pos_posorderline'


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
    status = models.CharField(max_length=20)
    created_at = models.DateTimeField()

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


class StockMovementRO(models.Model):
    product = models.ForeignKey(
        ProductRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    location = models.ForeignKey(
        LocationRO, on_delete=models.DO_NOTHING, db_constraint=False
    )
    movement_type = models.CharField(max_length=30)
    quantity = models.IntegerField()
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
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'inventory_openingstockline'


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

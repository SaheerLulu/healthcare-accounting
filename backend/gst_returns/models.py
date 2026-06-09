from django.db import models
from decimal import Decimal


class GSTR1Entry(models.Model):
    INVOICE_TYPES = [
        ('B2B', 'B2B Invoice'),
        ('B2C_LARGE', 'B2C Large (>2.5L)'),
        ('B2C_SMALL', 'B2C Small'),
        ('CREDIT_NOTE', 'Credit Note'),
        ('DEBIT_NOTE', 'Debit Note'),
        ('CDNR', 'Credit/Debit Note (Registered)'),
        ('CDNUR', 'Credit/Debit Note (Unregistered)'),
        ('NIL', 'Nil Rated/Exempt'),
    ]
    SOURCE_TYPES = [
        ('pos', 'POS Sale'),
        ('b2b', 'B2B Sale'),
        ('return', 'Sales Return'),
    ]

    period = models.CharField(max_length=7)  # YYYY-MM
    location_id = models.PositiveIntegerField()
    invoice_no = models.CharField(max_length=100)
    invoice_date = models.DateField()
    customer_gstin = models.CharField(max_length=15, blank=True)
    invoice_type = models.CharField(max_length=20, choices=INVOICE_TYPES)
    place_of_supply = models.CharField(max_length=2, blank=True)
    taxable_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    cess = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    hsn_code = models.CharField(max_length=20, blank=True)
    rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    source_type = models.CharField(max_length=10, choices=SOURCE_TYPES)
    source_id = models.PositiveIntegerField()

    # Non-destructive regeneration (Phase 2A)
    version = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)

    # CDNR fields (Phase 2B)
    original_invoice_no = models.CharField(max_length=100, blank=True)
    original_invoice_date = models.DateField(null=True, blank=True)
    is_time_barred = models.BooleanField(default=False)

    # E-invoicing fields (Phase 2G)
    irn = models.CharField(max_length=64, blank=True)
    irn_date = models.DateField(null=True, blank=True)
    ack_no = models.CharField(max_length=100, blank=True)
    ack_date = models.DateField(null=True, blank=True)
    e_invoice_status = models.CharField(max_length=20, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-invoice_date']
        indexes = [
            models.Index(fields=['period', 'location_id']),
            models.Index(fields=['is_active', 'period']),
        ]

    def __str__(self):
        return f"GSTR1 {self.period} | {self.invoice_no} | {self.invoice_type}"


class GSTR1HSNSummary(models.Model):
    """HSN-code level summary for GSTR-1 filing.

    Table 12 Phase-3 (mandatory from May-2025 tax periods) requires the HSN
    summary split into separate B2B and B2C tabs — `segment` carries that
    bifurcation. Amounts are net of credit notes (returns subtract)."""
    SEGMENT_CHOICES = [('B2B', 'B2B'), ('B2C', 'B2C')]

    period = models.CharField(max_length=7)
    location_id = models.PositiveIntegerField()
    hsn_code = models.CharField(max_length=20)
    segment = models.CharField(max_length=3, choices=SEGMENT_CHOICES, default='B2C')
    description = models.CharField(max_length=255, blank=True)
    uqc = models.CharField(max_length=10, default='NOS')  # Unit Quantity Code
    quantity = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    taxable_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    version = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['hsn_code']
        indexes = [
            models.Index(fields=['period', 'location_id', 'is_active']),
        ]

    def __str__(self):
        return f"HSN {self.hsn_code} | {self.period}"


class GSTR3BSummary(models.Model):
    STATUS_CHOICES = [('draft', 'Draft'), ('filed', 'Filed')]

    period = models.CharField(max_length=7)  # YYYY-MM
    location_id = models.PositiveIntegerField()
    # 3.1 Outward supplies
    outward_taxable = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    outward_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    outward_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    outward_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    outward_zero_rated = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    # 3.1(c) Exempt / nil-rated outward supplies (e.g. consultation income —
    # healthcare services are GST-exempt). Sourced from posted JE lines on the
    # CONSULTATION_INCOME account for the period.
    outward_exempt = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    # 3.1(d) Inward supplies liable to reverse charge
    rcm_taxable = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    rcm_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    rcm_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    rcm_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    # 4(A)(5) "All other ITC" — regular purchase ITC excluding RCM ITC
    itc_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    itc_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    itc_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    # 4(A)(3) ITC on RCM (mirrors the 3.1(d) tax — booked back as ITC under §9(3)/(4))
    rcm_itc_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    rcm_itc_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    rcm_itc_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    # Net payable
    net_payable_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    net_payable_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    net_payable_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    filed_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [['period', 'location_id']]
        ordering = ['-period']

    def __str__(self):
        return f"GSTR3B {self.period} | Location {self.location_id} | {self.status}"


class GSTR2BEntry(models.Model):
    """Auto-populated purchase register (books-side) for ITC matching."""
    MATCH_STATUS_CHOICES = [
        ('matched', 'Matched'),
        ('unmatched', 'Unmatched'),
        ('missing', 'Missing in Books'),
        ('mismatch', 'Amount Mismatch'),
    ]

    period = models.CharField(max_length=7)
    location_id = models.PositiveIntegerField()
    supplier_gstin = models.CharField(max_length=15)
    supplier_name = models.CharField(max_length=255)
    invoice_no = models.CharField(max_length=100)
    invoice_date = models.DateField()
    place_of_supply = models.CharField(max_length=2, blank=True)
    taxable_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    itc_eligible = models.BooleanField(default=True)
    source_po_id = models.PositiveIntegerField(null=True, blank=True)
    match_status = models.CharField(max_length=20, choices=MATCH_STATUS_CHOICES, default='unmatched')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-invoice_date']
        indexes = [
            models.Index(fields=['period', 'location_id']),
            models.Index(fields=['match_status']),
        ]

    def __str__(self):
        return f"GSTR2B {self.period} | {self.supplier_name} | {self.invoice_no}"


class ITCReconciliation(models.Model):
    """Reconciliation of ITC between books and GSTR-2B."""
    STATUS_CHOICES = [
        ('matched', 'Matched'),
        ('unmatched', 'Unmatched'),
        ('partial', 'Partial Match'),
    ]

    period = models.CharField(max_length=7)
    location_id = models.PositiveIntegerField()
    supplier_gstin = models.CharField(max_length=15)
    # Books-side amounts
    books_taxable = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    books_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    books_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    books_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    # GSTR-2B side amounts
    gstr2b_taxable = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    gstr2b_cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    gstr2b_sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    gstr2b_igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='unmatched')
    action_taken = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-period', 'supplier_gstin']
        indexes = [
            models.Index(fields=['period', 'location_id']),
        ]

    def __str__(self):
        return f"ITC Recon {self.period} | {self.supplier_gstin} | {self.status}"


class RCMEntry(models.Model):
    """Reverse Charge Mechanism tracking."""
    period = models.CharField(max_length=7)
    location_id = models.PositiveIntegerField()
    supplier_gstin = models.CharField(max_length=15, blank=True)
    supplier_name = models.CharField(max_length=255)
    service_type = models.CharField(max_length=100)
    sac_code = models.CharField(max_length=20, blank=True)
    taxable_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    cgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    sgst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    igst = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    journal_entry = models.ForeignKey(
        'journals.JournalEntry', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='rcm_entries'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-period']
        indexes = [
            models.Index(fields=['period', 'location_id']),
        ]

    def __str__(self):
        return f"RCM {self.period} | {self.supplier_name} | {self.service_type}"


class EWayBill(models.Model):
    """
    e-Way Bill — required under CGST Rule 138 for movement of goods of
    consignment value > ₹50,000 (intra-state thresholds vary by state but
    inter-state is uniform).

    For pharma chains this is unavoidable on every inter-state stock transfer
    or B2B sale shipment. We store the bill metadata + a JSON payload that
    matches the NIC e-Way Bill portal (https://docs.ewaybillgst.gov.in)
    schema for upload via API or download for manual upload.
    """

    SUPPLY_TYPE_CHOICES = [
        ('Outward', 'Outward (Sale / Supply)'),
        ('Inward', 'Inward (Purchase / Return)'),
    ]
    SUB_TYPE_CHOICES = [
        ('Supply', 'Supply'),
        ('Export', 'Export'),
        ('Import', 'Import'),
        ('JobWork', 'Job Work'),
        ('ForOwnUse', 'For Own Use'),
        ('SalesReturn', 'Sales Return'),
        ('Exhibition', 'Exhibition or Fairs'),
        ('Lineksales', 'Line Sales'),
        ('Recipientnotknown', 'Recipient Not Known'),
        ('Others', 'Others'),
        ('SKD/CKD', 'SKD/CKD/Lots'),
    ]
    DOC_TYPE_CHOICES = [
        ('INV', 'Tax Invoice'),
        ('CHL', 'Delivery Challan'),
        ('BIL', 'Bill of Supply'),
        ('BOE', 'Bill of Entry'),
        ('CNT', 'Credit Note'),
        ('OTH', 'Others'),
    ]
    TRANSPORT_MODE = [
        ('1', 'Road'),
        ('2', 'Rail'),
        ('3', 'Air'),
        ('4', 'Ship'),
    ]
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('generated', 'Generated (EWB issued)'),
        ('cancelled', 'Cancelled'),
        ('expired', 'Expired'),
    ]

    # Identity
    eway_bill_no = models.CharField(max_length=20, blank=True,
        help_text='12-digit e-Way Bill number assigned by NIC portal.')
    generated_date = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True,
        help_text='1 day per 200 km (CGST Rule 138(10)).')

    # Source linkage
    reference_type = models.CharField(max_length=30,
        help_text='B2BSalesOrder, PurchaseOrder, SalesReturn, StockTransfer, Manual')
    reference_id = models.PositiveIntegerField(null=True, blank=True)
    invoice_no = models.CharField(max_length=100)
    invoice_date = models.DateField()

    # Header
    supply_type = models.CharField(max_length=10, choices=SUPPLY_TYPE_CHOICES,
                                   default='Outward')
    sub_type = models.CharField(max_length=20, choices=SUB_TYPE_CHOICES,
                                default='Supply')
    doc_type = models.CharField(max_length=10, choices=DOC_TYPE_CHOICES,
                                default='INV')

    # Parties
    from_gstin = models.CharField(max_length=15)
    from_name = models.CharField(max_length=255)
    from_state_code = models.CharField(max_length=2)
    from_pincode = models.CharField(max_length=10, blank=True)
    to_gstin = models.CharField(max_length=15, blank=True,
        help_text='Blank when consignee is unregistered (URP).')
    to_name = models.CharField(max_length=255)
    to_state_code = models.CharField(max_length=2)
    to_pincode = models.CharField(max_length=10, blank=True)

    # Goods
    hsn_code = models.CharField(max_length=20, blank=True)
    product_name = models.CharField(max_length=255, blank=True)
    quantity = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    unit_qty_code = models.CharField(max_length=10, default='NOS')
    taxable_value = models.DecimalField(max_digits=15, decimal_places=2)
    cgst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    sgst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    igst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    cess_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    total_value = models.DecimalField(max_digits=15, decimal_places=2)

    # Transport
    transport_mode = models.CharField(max_length=2, choices=TRANSPORT_MODE,
                                      default='1')
    distance_km = models.PositiveIntegerField(default=0)
    transporter_name = models.CharField(max_length=120, blank=True)
    transporter_id = models.CharField(max_length=15, blank=True,
        help_text='Transporter GSTIN or 15-char Transporter ID.')
    vehicle_no = models.CharField(max_length=15, blank=True)
    transport_doc_no = models.CharField(max_length=40, blank=True)
    transport_doc_date = models.DateField(null=True, blank=True)

    # Lifecycle
    status = models.CharField(max_length=12, choices=STATUS_CHOICES,
                              default='draft')
    cancellation_reason = models.CharField(max_length=255, blank=True)
    location_id = models.PositiveIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-invoice_date', '-id']
        indexes = [
            models.Index(fields=['status', 'invoice_date']),
            models.Index(fields=['from_gstin', 'invoice_date']),
            models.Index(fields=['eway_bill_no']),
        ]

    def __str__(self):
        return (f'EWB {self.eway_bill_no or "(draft)"} — {self.invoice_no} '
                f'({self.from_state_code}→{self.to_state_code})')

    @property
    def is_inter_state(self) -> bool:
        return self.from_state_code != self.to_state_code

    def to_nic_payload(self) -> dict:
        """Convert to the JSON shape the NIC EWB portal accepts.

        Schema reference: https://docs.ewaybillgst.gov.in/Documents/ewbapi/
        EWBAPIDeveloperGuidelinesv1.0.pdf (post-2018 spec).
        """
        return {
            'supplyType': 'O' if self.supply_type == 'Outward' else 'I',
            'subSupplyType': self.sub_type,
            'docType': self.doc_type,
            'docNo': self.invoice_no,
            'docDate': self.invoice_date.strftime('%d/%m/%Y'),
            'fromGstin': self.from_gstin,
            'fromTrdName': self.from_name,
            'fromAddr1': '', 'fromAddr2': '',
            'fromPlace': '', 'fromPincode': int(self.from_pincode or 0),
            'fromStateCode': int(self.from_state_code),
            'actFromStateCode': int(self.from_state_code),
            'toGstin': self.to_gstin or 'URP',
            'toTrdName': self.to_name,
            'toAddr1': '', 'toAddr2': '',
            'toPlace': '', 'toPincode': int(self.to_pincode or 0),
            'toStateCode': int(self.to_state_code),
            'actToStateCode': int(self.to_state_code),
            'transactionType': 1,
            'totalValue': float(self.taxable_value),
            'cgstValue': float(self.taxable_value * self.cgst_rate / 100),
            'sgstValue': float(self.taxable_value * self.sgst_rate / 100),
            'igstValue': float(self.taxable_value * self.igst_rate / 100),
            'cessValue': float(self.taxable_value * self.cess_rate / 100),
            'totInvValue': float(self.total_value),
            'transMode': self.transport_mode,
            'transDistance': str(self.distance_km),
            'transporterName': self.transporter_name,
            'transporterId': self.transporter_id,
            'transDocNo': self.transport_doc_no,
            'transDocDate': (self.transport_doc_date.strftime('%d/%m/%Y')
                             if self.transport_doc_date else ''),
            'vehicleNo': self.vehicle_no,
            'vehicleType': 'R',
            'itemList': [{
                'productName': self.product_name,
                'productDesc': self.product_name,
                'hsnCode': int(self.hsn_code) if self.hsn_code.isdigit() else 0,
                'quantity': float(self.quantity),
                'qtyUnit': self.unit_qty_code,
                'cgstRate': float(self.cgst_rate),
                'sgstRate': float(self.sgst_rate),
                'igstRate': float(self.igst_rate),
                'cessRate': float(self.cess_rate),
                'taxableAmount': float(self.taxable_value),
            }],
        }

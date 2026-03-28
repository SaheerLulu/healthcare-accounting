# Biloop Accounting - System Documentation

## 1. Why This Application Exists

Biloop Accounting is the financial backbone of a multi-location healthcare/pharmacy business in India. The business already operates an inventory management system (Biloop Healthcare Inventory) that handles product catalogs, purchase entries, POS sales, B2B sales, stock movements, and returns across multiple store locations.

However, inventory management alone does not answer critical business questions:

- **How much profit did we make this quarter?** Requires a Profit & Loss statement built from double-entry journal entries.
- **How much GST do we owe the government?** India's GST regime requires GSTR-1 (outward supplies), GSTR-3B (monthly summary), and GSTR-2B (purchase register) filings, each requiring data aggregated from sales and purchase transactions.
- **How much TDS must we deduct and deposit?** Tax Deducted at Source is mandatory for payments exceeding thresholds under various sections of the Income Tax Act.
- **Who owes us money, and for how long?** Receivables/payables aging reports drive collections and cash flow management.
- **Are our books balanced?** The fundamental accounting equation (Assets = Liabilities + Equity) must hold at all times.

This application exists to **automatically transform raw business transactions (purchases, sales, returns) into proper double-entry accounting records** and generate all the compliance reports required by Indian tax law. It is not a general-purpose ERP - it is purpose-built for this specific business, reading data from the shared inventory database and generating accounting entries without any manual data re-entry.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      Shared SQLite Database                       │
│  (lives at healthcare-inventory-management/backend/db.sqlite3)   │
│                                                                   │
│  ┌─────────────────────┐     ┌──────────────────────────────┐   │
│  │  Inventory Tables    │     │  Accounting Tables            │   │
│  │  (managed by inv.)   │     │  (managed by accounting)      │   │
│  │                      │     │                               │   │
│  │  product_master_*    │────>│  journals_journalentry        │   │
│  │  purchase_entry_*    │     │  journals_journalentryline    │   │
│  │  pos_*               │     │  core_chartofaccount          │   │
│  │  b2b_sales_*         │     │  core_accountmapping          │   │
│  │  sales_return_*      │     │  core_accountingsettings      │   │
│  │  purchase_return_*   │     │  gst_returns_*                │   │
│  │  inventory_*         │     │  tds_*                        │   │
│  │  user_management_*   │     │  sync_*                       │   │
│  │  supplier_master_*   │     │  audit_auditlog               │   │
│  │  customer_master_*   │     │                               │   │
│  └─────────────────────┘     └──────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘

                        Data Flow:
  Inventory DB ──> inventory_reader (read-only proxy models)
                       │
                       ▼
                 sync service (InventorySyncService)
                       │
                       ▼
             JournalAutoGenerationService
                       │
                       ▼
              JournalEntry + JournalEntryLine
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
         Reports    GST Returns    TDS
```

**Why a shared database?** Both systems need atomic consistency. When a POS sale is recorded in inventory, the accounting entry must reference the exact same row. A shared SQLite file eliminates network latency and API version mismatches. The accounting app uses `managed = False` proxy models to read inventory tables without ever writing to them.

**Why JWT token sharing?** Both apps share the same `SECRET_KEY`, so a user who logs into the inventory system gets a JWT token that the accounting system also accepts. This enables single sign-on across both applications.

---

## 3. Django Apps and Their Purpose

### 3.1 `core` - Company Configuration & Chart of Accounts

**Why:** Every accounting system needs a chart of accounts (the list of all ledger accounts) and company-level settings (GSTIN, PAN, TAN, fiscal year). These are global and not tied to any specific transaction.

### 3.2 `journals` - Double-Entry Journal Entries

**Why:** Double-entry bookkeeping is the foundation of all accounting. Every transaction must have equal debits and credits. Journal entries are the single source of truth for all financial data - reports, GST returns, and TDS all derive from journal entries.

### 3.3 `gst_returns` - GST Compliance

**Why:** Indian businesses must file monthly/quarterly GST returns. GSTR-1 (outward supplies) must list every sale invoice. GSTR-3B (monthly summary) aggregates output tax and input tax credit. GSTR-2B (purchase register) reconciles purchase invoices for ITC claims. Manual preparation of these returns is error-prone and time-consuming.

### 3.4 `tds` - Tax Deducted at Source

**Why:** Indian businesses must deduct TDS on payments to contractors (194C), professionals (194J), rent (194I), etc. when amounts exceed thresholds. Non-compliance attracts penalties and disallowance of expenses. The app tracks deductions and generates challans for deposit.

### 3.5 `sync` - Inventory-to-Accounting Bridge

**Why:** Without sync, every purchase/sale/return in the inventory system would need to be manually re-entered in accounting. The sync service runs incrementally (tracking `last_synced_id` per transaction type) to automatically create journal entries for new inventory transactions.

### 3.6 `inventory_reader` - Read-Only Access to Inventory Data

**Why:** The accounting system needs to read purchase orders, sales, customers, suppliers, and locations from the inventory database. Using Django's `managed = False` models gives ORM access to these tables without any risk of accidentally modifying inventory data.

### 3.7 `audit` - Immutable Audit Trail

**Why:** Financial records must be auditable. Every create, update, delete, post, and reverse action is logged with the user, timestamp, IP address, and the changes made. This is both a regulatory requirement and a safeguard against errors.

### 3.8 `reports` - Financial Reporting

**Why:** All financial reporting (Trial Balance, P&L, Balance Sheet, Ledger, Aging Reports, GST Computation, HSN Summary, Party Outstanding) is derived by querying journal entry lines. These views aggregate data dynamically rather than storing denormalized report tables.

---

## 4. Data Models - Detailed Reference

### 4.1 `core.AccountingSettings` - Company Configuration (Singleton)

| Field | Type | Purpose |
|-------|------|---------|
| `company_name` | CharField(255) | Legal entity name for reports and filings |
| `gstin` | CharField(15) | 15-digit GST Identification Number; first 2 digits = state code, used to detect intra/inter-state supply |
| `tan` | CharField(10) | Tax Deduction Account Number for TDS filings |
| `state_code` | CharField(2) | 2-digit state code (e.g., "27" for Maharashtra) |
| `pan` | CharField(10) | Permanent Account Number, required for TDS returns |
| `registered_address` | TextField | Company address for invoices and returns |
| `financial_year_start` | IntegerField(default=4) | Month number when FY starts. India uses April (4), so FY 2025-26 runs Apr 2025 to Mar 2026 |
| `is_fy_closed` | BooleanField | Whether the current FY's books have been closed |
| `last_closed_fy` | CharField(7) | E.g., "2024-25" - prevents editing entries in closed years |

**Why singleton?** A single business entity has one GSTIN, one TAN, one PAN. The `save()` method enforces that only one row can exist. `get_settings()` uses `get_or_create` with `pk=1` for safe default creation.

**Why `financial_year_start = 4`?** India's financial year runs April to March (mandated by the Companies Act). The dashboard, trial balance, and P&L all compute FY boundaries from this setting. If the business ever needs a January-start FY (e.g., for a foreign subsidiary), this field allows it without code changes.

---

### 4.2 `core.ChartOfAccount` - Hierarchical Ledger Structure

| Field | Type | Purpose |
|-------|------|---------|
| `account_code` | CharField(10), unique | Standardized code (e.g., "1110" for Cash, "4100" for POS Sales). Codes follow a logical numbering: 1xxx=Assets, 2xxx=Liabilities, 3xxx=Equity, 4xxx=Revenue, 5xxx=Expenses, 6xxx=Indirect Expenses |
| `account_name` | CharField(255) | Human-readable name (e.g., "Cash in Hand", "Trade Payables") |
| `account_type` | CharField(20) | One of: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE. Determines which financial statement the account appears on and the natural balance direction |
| `account_subtype` | CharField(50) | Fine-grained classification: Cash, Bank, Receivable, Payable, Input_GST, Output_GST, TDS_Receivable, TDS_Payable, Capital, Retained_Earnings, Sales, Purchases, Other_Income, Other_Expense. Used for dashboard KPIs and aging reports |
| `parent` | FK(self), nullable | Enables tree structure (e.g., "Assets" > "Current Assets" > "Cash in Hand"). Reports can roll up subtotals |
| `is_leaf` | BooleanField | Only leaf accounts can have journal lines posted to them. Parent/group accounts are for display hierarchy only |
| `description` | TextField | Optional notes about the account's purpose |

**Why `account_subtype`?** The dashboard needs to compute total receivables, total payables, GST payable, etc. without hardcoding account codes. By querying `account_subtype='Receivable'`, the dashboard works correctly even if account codes change. Subtypes like `Input_GST` vs `Output_GST` enable the GST computation worksheet.

**Why `is_leaf`?** Prevents posting entries to group/parent accounts. If someone posts to "Current Assets" instead of "Cash in Hand", the trial balance would be meaningless. Only leaf nodes accept journal lines.

**Why hierarchical (self-referencing FK)?** The tree view in the frontend shows Assets > Current Assets > Cash/Bank/Receivables, which mirrors how accountants think about the chart. The `tree` endpoint returns nested JSON for this UI.

---

### 4.3 `core.AccountMapping` - Semantic Account References

| Field | Type | Purpose |
|-------|------|---------|
| `key` | CharField(30), unique | Semantic key like `PURCHASES`, `INPUT_CGST`, `TRADE_PAYABLES`, `SALES_POS`, etc. |
| `account` | FK(ChartOfAccount), PROTECT | The actual ledger account this key maps to |

**Why does this exist?** The `JournalAutoGenerationService` needs to know *which* account to debit for purchases, which to credit for GST output, etc. Hardcoding account codes (e.g., `account_code='5100'`) would break if the user renumbers their chart. `AccountMapping` decouples the business logic from the account structure.

**Default codes:**
| Key | Default Code | Account |
|-----|-------------|---------|
| `PURCHASES` | 5100 | Purchases |
| `INPUT_CGST` | 1140 | CGST Input Tax Credit |
| `INPUT_SGST` | 1150 | SGST Input Tax Credit |
| `INPUT_IGST` | 1160 | IGST Input Tax Credit |
| `TRADE_PAYABLES` | 2110 | Trade Payables (Creditors) |
| `SALES_POS` | 4100 | POS Sales Revenue |
| `SALES_B2B` | 4200 | B2B Sales Revenue |
| `OUTPUT_CGST` | 2120 | CGST Output Tax Liability |
| `OUTPUT_SGST` | 2130 | SGST Output Tax Liability |
| `OUTPUT_IGST` | 2140 | IGST Output Tax Liability |
| `CASH` | 1110 | Cash in Hand |
| `BANK` | 1120 | Bank Account |
| `TRADE_RECEIVABLES` | 1130 | Trade Receivables (Debtors) |
| `SALES_RETURNS` | 5200 | Sales Returns (Contra Revenue) |
| `PURCHASE_RETURNS` | 5300 | Purchase Returns (Contra Expense) |
| `TDS_RECEIVABLE` | 1170 | TDS Receivable |
| `TDS_PAYABLE` | 2150 | TDS Payable |
| `RETAINED_EARNINGS` | 3200 | Retained Earnings |
| `ROUND_OFF` | 6100 | Round-off Differences |
| `RCM_LIABILITY` | 2160 | RCM GST Liability |

**Why PROTECT on delete?** If an account that is mapped is deleted, the auto-generation service would break. `PROTECT` prevents accidental deletion of mapped accounts.

---

### 4.4 `journals.JournalEntry` - The Core Transaction Record

| Field | Type | Purpose |
|-------|------|---------|
| `entry_no` | CharField(20), unique, auto | Sequential number `JV-YYYY-NNNNNN` (e.g., JV-2026-000142). Generated automatically. Used as the primary human reference for any accounting entry |
| `date` | DateField | The accounting date of the transaction (may differ from `created_at` - e.g., a purchase bill dated March 28 entered on April 1) |
| `narration` | TextField | Description of the transaction (e.g., "Purchase Invoice: INV-001 from Supplier ID 5") |
| `voucher_type` | CharField(20) | Classifies the entry: PURCHASE, SALE, PAYMENT, RECEIPT, CONTRA, JOURNAL, CREDIT_NOTE, DEBIT_NOTE. Used for filtering and reporting |
| `reference_type` | CharField(30) | Links to the source: PurchaseOrder, POSOrder, B2BSalesOrder, SalesReturn, PurchaseReturn, RCM, Manual |
| `reference_id` | PositiveIntegerField, nullable | The ID of the source record in the inventory database. Together with `reference_type`, provides full traceability |
| `is_posted` | BooleanField | Draft entries can be edited; posted entries are immutable. Only posted entries appear in reports. This two-phase workflow prevents partial/incorrect entries from affecting financial statements |
| `location_id` | PositiveIntegerField, nullable | The store/location this transaction belongs to. Populated from the source inventory record during sync. Enables multi-store financial reporting |
| `created_by` | FK(User), nullable | The user who created the entry. Null for auto-generated (sync) entries |

**Why `reference_type` + `reference_id` instead of a ForeignKey?** The referenced records live in the inventory database's tables (`pos_posorder`, `purchase_entry_purchaseorder`, etc.) which are different models. A polymorphic reference (`reference_type` + `reference_id`) is simpler than creating multiple nullable FKs. The `_entry_exists()` check prevents duplicate generation.

**Why `is_posted` and not just create-and-done?** In accounting, entries should be reviewed before they affect financial statements. The post workflow validates that debits equal credits (`clean()` method), then marks the entry as immutable. Posted entries cannot be edited - they can only be reversed (creating a new entry with swapped debits/credits). This immutability is a core accounting principle.

**Why `location_id` is a PositiveIntegerField, not a FK?** The Location model lives in the inventory database (`product_master_location`). Since accounting models are `managed = True` and the inventory Location model is `managed = False`, a real FK would create migration issues. A plain integer field stores the location ID and is used for filtering.

**Indexes:**
- `date` - All reports filter by date range
- `(reference_type, reference_id)` - Duplicate detection during sync
- `voucher_type` - Filtering by transaction type

---

### 4.5 `journals.JournalEntryLine` - Individual Debit/Credit Lines

| Field | Type | Purpose |
|-------|------|---------|
| `entry` | FK(JournalEntry), CASCADE | Parent entry. An entry has 2+ lines. CASCADE ensures lines are deleted with the entry |
| `account` | FK(ChartOfAccount), PROTECT | The ledger account being debited or credited. PROTECT prevents deleting accounts that have transactions |
| `debit` | DecimalField(15,2) | Debit amount (0.00 if this line is a credit) |
| `credit` | DecimalField(15,2) | Credit amount (0.00 if this line is a debit) |
| `narration` | CharField(500) | Line-level description (optional, falls back to entry narration in ledger view) |
| `party_type` | CharField(10) | Customer, Supplier, or None. Enables sub-ledger tracking |
| `party_id` | PositiveIntegerField, nullable | ID of the customer/supplier from inventory. Together with `party_type`, enables aging reports and party outstanding calculations |

**Why separate `debit` and `credit` columns instead of a single `amount` with sign?** Traditional accounting uses separate debit/credit columns. This makes the trial balance trivially correct: `SUM(debit) = SUM(credit)`. A signed amount would require conventions about positive/negative that are error-prone.

**Why `party_type` + `party_id`?** Receivables and payables aging reports need to group amounts by customer/supplier. When a B2B sale is recorded, the receivables line stores `party_type='Customer'` and `party_id=<customer_id>`. This enables the Receivables Aging view to compute per-customer outstanding without scanning invoice details.

**Validation:** `clean()` ensures a line cannot have both debit and credit > 0, and neither can be negative.

---

### 4.6 `gst_returns.GSTR1Entry` - Outward Supply Records

| Field | Type | Purpose |
|-------|------|---------|
| `period` | CharField(7) | Filing period in `YYYY-MM` format (e.g., "2026-03") |
| `location_id` | PositiveIntegerField | Store this invoice was generated from |
| `invoice_no` | CharField(100) | Original invoice number from POS/B2B system |
| `invoice_date` | DateField | Date of the original invoice |
| `customer_gstin` | CharField(15) | Customer's GSTIN (blank for B2C) |
| `invoice_type` | CharField(20) | B2B, B2C_LARGE, B2C_SMALL, CREDIT_NOTE, DEBIT_NOTE, CDNR, CDNUR, NIL |
| `place_of_supply` | CharField(2) | 2-digit state code where supply is consumed |
| `taxable_value` | DecimalField(15,2) | Pre-tax invoice value |
| `cgst`, `sgst`, `igst`, `cess` | DecimalField(15,2) | Tax breakup |
| `hsn_code` | CharField(20) | HSN code of the product/service |
| `rate` | DecimalField(5,2) | GST rate percentage |
| `source_type` | CharField(10) | pos, b2b, or return |
| `source_id` | PositiveIntegerField | ID of the POS/B2B/Return record |
| `version` | PositiveIntegerField | Incremented on re-generation; old versions marked `is_active=False` |
| `is_active` | BooleanField | Only active records are included in filings |
| `original_invoice_no` | CharField(100) | For credit/debit notes: the original invoice being adjusted |
| `irn` | CharField(64) | Invoice Reference Number for e-invoicing |
| `e_invoice_status` | CharField(20) | E-invoice generation status |

**Why `version` + `is_active`?** GST entries are generated from sales data. If you regenerate for a period (e.g., after correcting a sale), the old entries are soft-deleted (`is_active=False`) and new ones created with `version+1`. This provides a non-destructive audit trail - you can always see what was previously generated.

**Why `invoice_type` matters?** GST law requires different treatment for:
- **B2B**: Invoices to registered dealers (reported with GSTIN)
- **B2C_LARGE**: Sales > 2.5 lakh to unregistered persons (reported with state code)
- **B2C_SMALL**: Sales <= 2.5 lakh to unregistered persons (aggregated by rate)
- **CDNR/CDNUR**: Credit/debit notes for returns/adjustments (must reference original invoice)

---

### 4.7 `gst_returns.GSTR1HSNSummary` - HSN-Level Aggregation

| Field | Type | Purpose |
|-------|------|---------|
| `period`, `location_id` | | Same as GSTR1Entry |
| `hsn_code` | CharField(20) | Harmonized System of Nomenclature code |
| `description` | CharField(255) | Product description for the HSN code |
| `uqc` | CharField(10) | Unit Quantity Code (e.g., "NOS" for numbers) |
| `quantity` | DecimalField(15,2) | Total quantity sold under this HSN |
| `taxable_value` | DecimalField(15,2) | Aggregate taxable value |
| `cgst`, `sgst`, `igst` | DecimalField(15,2) | Aggregate tax amounts |
| `rate` | DecimalField(5,2) | GST rate |

**Why?** GSTR-1 filing requires an HSN summary table (Table 12) aggregating sales by HSN code. This pre-computed table avoids re-scanning all sales at filing time.

---

### 4.8 `gst_returns.GSTR3BSummary` - Monthly Return Summary

| Field | Type | Purpose |
|-------|------|---------|
| `period`, `location_id` | | Filing period and location |
| `outward_taxable` | DecimalField | Total taxable outward supplies |
| `outward_igst/cgst/sgst` | DecimalField | Output tax breakdown |
| `outward_zero_rated` | DecimalField | Zero-rated/exempt supplies |
| `itc_igst/cgst/sgst` | DecimalField | Input Tax Credit available |
| `net_payable_igst/cgst/sgst` | DecimalField | Tax to be paid to government (output - input) |
| `status` | CharField | draft or filed |
| `filed_date` | DateField, nullable | When the return was actually filed |

**Why unique_together on (period, location_id)?** Each location files one GSTR-3B per month. The uniqueness constraint prevents accidental duplicate filings.

**Why track `status`?** Once filed with the government, the return should not be regenerated. The `status='filed'` check prevents overwriting a filed return.

---

### 4.9 `gst_returns.GSTR2BEntry` - Purchase Register for ITC

| Field | Type | Purpose |
|-------|------|---------|
| `period`, `location_id` | | Period and location |
| `supplier_gstin`, `supplier_name` | | Supplier identification |
| `invoice_no`, `invoice_date` | | Purchase invoice details |
| `taxable_value`, `cgst`, `sgst`, `igst` | DecimalField | Tax amounts from purchases |
| `itc_eligible` | BooleanField | Whether this invoice qualifies for ITC claim. Can be toggled by the user |
| `source_po_id` | PositiveIntegerField, nullable | Links to the PurchaseOrder in inventory |
| `match_status` | CharField | matched, unmatched, missing, mismatch |

**Why?** GSTR-2B is the government-generated statement of inward supplies. Businesses must reconcile their purchase records against GSTR-2B to claim Input Tax Credit. The `match_status` field tracks whether each purchase in our books matches the government data.

---

### 4.10 `gst_returns.ITCReconciliation` - Books vs GSTR-2B Matching

| Field | Type | Purpose |
|-------|------|---------|
| `period`, `location_id` | | Period and location |
| `supplier_gstin` | CharField | The supplier being reconciled |
| `books_taxable/cgst/sgst/igst` | DecimalField | Amounts per our books (from purchase journal entries) |
| `gstr2b_taxable/cgst/sgst/igst` | DecimalField | Amounts per government's GSTR-2B |
| `status` | CharField | matched, unmatched, partial |
| `action_taken` | TextField | Notes on resolution (e.g., "Supplier to file amendment") |

**Why?** ITC mismatch between books and GSTR-2B is the #1 audit trigger in Indian GST. This reconciliation table highlights discrepancies per supplier, enabling proactive resolution before filing.

---

### 4.11 `gst_returns.RCMEntry` - Reverse Charge Mechanism

| Field | Type | Purpose |
|-------|------|---------|
| `period`, `location_id` | | Period and location |
| `supplier_gstin`, `supplier_name` | | Unregistered/specified supplier |
| `service_type` | CharField(100) | Type of service under RCM (e.g., "Legal Services", "GTA") |
| `sac_code` | CharField(20) | Service Accounting Code |
| `taxable_value`, `cgst`, `sgst`, `igst` | DecimalField | Tax amounts |
| `journal_entry` | FK(JournalEntry), nullable | The journal entry created for this RCM |

**Why?** Under RCM, the buyer (not the seller) pays GST to the government. This arises for specified services (security, legal, transport) or purchases from unregistered dealers. The buyer gets ITC on the tax paid under RCM. This model tracks these entries separately because they require special handling in GSTR-3B (Table 3.1d).

---

### 4.12 `tds.TDSRateConfig` - Tax Rate Configuration

| Field | Type | Purpose |
|-------|------|---------|
| `section` | CharField(10) | Income Tax section (194C, 194H, 194J, etc.) |
| `deductee_type` | CharField(20) | Company or Individual/HUF (rates differ) |
| `rate` | DecimalField(5,2) | TDS rate percentage |
| `threshold` | DecimalField(15,2) | Minimum amount above which TDS applies |
| `fy_start`, `fy_end` | DateField | Validity period (rates change across financial years) |
| `is_active` | BooleanField | Whether this rate is currently applicable |

**Why?** TDS rates change every year in the Union Budget. Storing them in the database (not hardcoded) allows the accountant to update rates without developer involvement. The `unique_together` on `(section, deductee_type, fy_start)` ensures one active rate per combination per FY.

---

### 4.13 `tds.TDSDeduction` - Individual Deductions

| Field | Type | Purpose |
|-------|------|---------|
| `deductee_name` | CharField | Name of the person/company from whom tax is deducted |
| `deductee_pan` | CharField(10) | PAN of the deductee (required for TDS returns) |
| `section` | CharField(10) | Applicable section (194C, 194J, etc.) |
| `nature_of_payment` | CharField | Description (e.g., "Transport charges", "Professional fees") |
| `transaction_date` | DateField | Date of the payment/booking |
| `gross_amount` | DecimalField | Total payment amount before TDS |
| `tds_rate` | DecimalField(5,2) | Applied rate |
| `tds_amount` | DecimalField | Amount deducted |
| `deductee_type` | CharField | Company or Individual |
| `source_type` | CharField | PurchaseOrder or Manual |
| `source_id` | PositiveIntegerField, nullable | Links to purchase order if auto-generated |
| `status` | CharField | pending, challan_paid, returned |
| `challan_no`, `challan_date`, `bsr_code` | | Challan details after deposit |
| `location_id` | PositiveIntegerField, nullable | Store/location |

**Why track `status`?** TDS has a three-stage lifecycle: (1) Deducted from payment, (2) Deposited to government via challan, (3) Reported in quarterly return (26Q). The status field tracks progression through this lifecycle.

---

### 4.14 `tds.TDSChallan` - Government Deposit Records

| Field | Type | Purpose |
|-------|------|---------|
| `challan_no` | CharField, unique | Bank challan number (proof of deposit) |
| `bsr_code` | CharField | Bank branch code |
| `deposit_date` | DateField | When TDS was deposited |
| `period` | CharField(7) | Month for which TDS was deposited |
| `section` | CharField | Applicable IT section |
| `total_tds_amount` | DecimalField | Total amount deposited |
| `deductions` | M2M(TDSDeduction) | Which deductions are covered by this challan |

**Why M2M with deductions?** A single challan can cover multiple deductions for the same section/month. After challan creation, linked deductions are marked as `challan_paid`.

---

### 4.15 `sync.SyncLog` - Incremental Sync Tracking

| Field | Type | Purpose |
|-------|------|---------|
| `sync_type` | CharField | purchase, pos, b2b, return, purchase_return, all |
| `last_synced_id` | PositiveIntegerField | The highest ID successfully processed. Next sync starts from `id > last_synced_id` |
| `last_synced_at` | DateTimeField | When sync last ran |
| `records_processed` | IntegerField | Count of records processed in this run |
| `status` | CharField | success or error |
| `error_message` | TextField | Error details if sync failed |

**Why `last_synced_id`?** Incremental sync. Instead of re-processing all 10,000 purchase orders every time, the sync only looks at `id > last_synced_id`. This makes sync fast (O(new records) instead of O(all records)) and idempotent.

---

### 4.16 `sync.SyncError` - Granular Error Tracking

| Field | Type | Purpose |
|-------|------|---------|
| `sync_type` | CharField | Transaction type that failed |
| `source_id` | PositiveIntegerField | Which specific record failed |
| `error_message`, `traceback` | TextField | Diagnostic info |
| `retry_count`, `max_retries` | IntegerField | Prevents infinite retry loops (default max: 3) |
| `resolved` | BooleanField | Marked true after successful retry or manual resolution |

**Why?** A single bad record (e.g., a purchase order with missing supplier GSTIN) should not block sync of all other records. SyncError captures failures individually so they can be retried after the underlying data is fixed.

---

### 4.17 `audit.AuditLog` - Immutable Action Log

| Field | Type | Purpose |
|-------|------|---------|
| `timestamp` | DateTimeField, auto, indexed | When the action occurred |
| `user` | FK(User), nullable | Who performed the action (null for system actions) |
| `action` | CharField, indexed | CREATE, UPDATE, DELETE, POST, REVERSE, GENERATE, SYNC |
| `model_name` | CharField, indexed | Which model was affected |
| `object_id` | CharField | PK of the affected record |
| `object_repr` | CharField(500) | Human-readable description |
| `changes` | JSONField, nullable | Before/after values for updates |
| `ip_address` | GenericIPAddressField | Client IP for accountability |
| `extra` | JSONField, nullable | Additional context (e.g., reversal entry number) |

**Why?** Financial systems require audit trails for regulatory compliance and error investigation. The `log_action()` utility is called from every view that mutates data. The `changes` JSON field stores what specifically was modified, enabling "who changed what when" queries.

---

### 4.18 `inventory_reader` - Read-Only Proxy Models

These models all use `managed = False` and `db_constraint = False` on all ForeignKeys:

| Model | Maps to | Key Fields | Why Read |
|-------|---------|-----------|----------|
| `LocationRO` | `product_master_location` | name, complete_name, usage | Multi-store filtering, location selector |
| `SupplierRO` | `supplier_master_supplier` | company_name, gst_no, state, location | Purchase entries need supplier GSTIN for IGST detection |
| `CustomerRO` | `customer_master_customer` | customer_name, gst_no, location | Sales entries need customer GSTIN; aging reports need customer names |
| `ProductRO` | `product_master_product` | name, pharma_hsn_code, pharma_gst_percent | HSN codes for GSTR-1 HSN summary |
| `PurchaseOrderRO` | `purchase_entry_purchaseorder` | bill_no, supplier, state, supply_type, total_cgst/sgst/igst, location | Source for purchase journal entries |
| `PurchaseOrderLineRO` | `purchase_entry_purchaseorderline` | quantity, purchase_rate, tax amounts | Line-level tax computation |
| `POSOrderRO` | `pos_posorder` | invoice_no, total_amount, gst_percent, location | Source for POS sale journal entries |
| `POSOrderLineRO` | `pos_posorderline` | quantity, unit_price, tax_percent | Line-level details |
| `B2BSalesOrderRO` | `b2b_sales_b2bsalesorder` | invoice_no, supply_type, total amounts, location | Source for B2B sale journal entries |
| `B2BSalesOrderLineRO` | `b2b_sales_b2bsalesorderline` | quantity, unit_price, tax amounts | Line-level details |
| `SalesReturnRO` | `sales_return_salesreturn` | return_no, return_type, total_amount, location | Source for credit note journal entries |
| `SalesReturnLineRO` | `sales_return_salesreturnline` | quantity, unit_price | Line-level details |
| `PurchaseReturnRO` | `purchase_return_purchasereturn` | return_no, supply_type, total amounts, location | Source for debit note journal entries |
| `PurchaseReturnLineRO` | `purchase_return_purchasereturnline` | quantity, purchase_rate, tax amounts | Line-level details |
| `StockMovementRO` | `inventory_stockmovement` | product, location, movement_type, quantity | Future: inventory valuation |
| `RoleRO` | `user_management_role` | name, code | Check if user is admin for location access |
| `UserProfileRO` | `user_management_userprofile` | user, role | Link auth.User to role |
| `UserLocationAssignmentRO` | `user_management_userlocationassignment` | user_profile, location, is_default | Multi-store access control |

**Why `db_constraint = False` on all ForeignKeys?** These are cross-table references in a shared database. Django would try to create real FOREIGN KEY constraints during migrations, but since these tables are `managed = False`, the constraints would fail or be redundant. `db_constraint=False` tells Django "trust me, the relationship exists, but don't enforce it at the database level."

---

## 5. Key Business Logic

### 5.1 Journal Auto-Generation (How Transactions Become Entries)

The `JournalAutoGenerationService` transforms each inventory transaction type into proper double-entry journal entries:

**Purchase Invoice:**
```
Dr. Purchases (5100)            ← taxable amount + transport + other charges
Dr. Input CGST (1140)           ← CGST from invoice
Dr. Input SGST (1150)           ← SGST from invoice
Dr. Input IGST (1160)           ← IGST (for inter-state purchases)
    Cr. Trade Payables (2110)   ← total payable to supplier
```

**POS Sale (tax-inclusive pricing):**
```
Dr. Cash (1110)                 ← total amount collected
    Cr. Sales - POS (4100)      ← back-calculated taxable base
    Cr. Output CGST (2120)      ← CGST component
    Cr. Output SGST (2130)      ← SGST component
    Cr. Round Off (6100)        ← rounding difference (if any)
```

**B2B Sale (tax-exclusive pricing):**
```
Dr. Trade Receivables (1130)    ← total invoice amount
    Cr. Sales - B2B (4200)      ← taxable amount
    Cr. Output CGST (2120)      ← CGST
    Cr. Output SGST (2130)      ← SGST
    Cr. Output IGST (2140)      ← IGST (for inter-state sales)
```

**Sales Return:**
```
Dr. Sales Returns (5200)        ← taxable amount being returned
Dr. Output CGST/SGST/IGST      ← GST reversal
    Cr. Cash or Receivables     ← refund to customer
```

**Purchase Return:**
```
Dr. Trade Payables (2110)       ← reduce supplier liability
    Cr. Purchase Returns (5300) ← contra-expense
    Cr. Input CGST/SGST/IGST   ← reverse ITC
```

### 5.2 GST Supply Type Detection

The `detect_supply_type()` function compares the first 2 digits of the business GSTIN with the counterparty GSTIN:
- Same state code = **intra-state** = split into CGST + SGST (each = half of total GST)
- Different state code = **inter-state** = full amount as IGST

This is critical because CGST and SGST are paid to state and central governments respectively, while IGST is paid centrally. Incorrect classification is a compliance violation.

### 5.3 Multi-Store Isolation

The `X-Location-Id` header drives all data filtering:
1. Frontend sends the header with every API request
2. Backend middleware (`ActiveLocationMiddleware`) validates the location and user access
3. `LocationFilterMixin` auto-filters ViewSet querysets
4. Report APIViews call `get_active_location()` explicitly
5. Admins/superusers can view all locations or filter by specific one
6. Non-admin users only see data for their assigned locations

---

## 6. Frontend Architecture

| Concern | Solution |
|---------|----------|
| **UI Framework** | React 18 + TypeScript |
| **Styling** | Tailwind CSS v4 + Radix UI primitives |
| **State** | Local `useState`/`useEffect` per page; `LocationContext` for global location |
| **API Client** | Axios with JWT Bearer token + X-Location-Id header auto-injection |
| **Routing** | React Router v6, `ProtectedRoute` checks localStorage for token |
| **Charts** | Recharts for dashboard revenue/expense trends |
| **Notifications** | Sonner toast library |
| **Icons** | Lucide React |
| **Build** | Vite, proxies `/api` to Django backend on :8001 |

**Why no global state library (Redux/Zustand)?** Each page is self-contained - the journals page fetches journal data, the dashboard fetches dashboard data. There is no shared mutable state between pages. The only global state is the active location (managed via `LocationContext`).

---

## 7. API Structure

All endpoints are under `/api/`:

| Prefix | App | Key Endpoints |
|--------|-----|---------------|
| `/api/accounts/` | core | Chart of Accounts CRUD, Account Mappings, Settings, Dashboard KPIs, User Locations |
| `/api/journals/` | journals | Journal Entries CRUD, Post, Reverse |
| `/api/gst/` | gst_returns | GSTR-1, GSTR-2B, GSTR-3B, ITC Reconciliation, RCM - each with list + generate |
| `/api/tds/` | tds | TDS Deductions, Challans, Rate Configs, 26Q Export |
| `/api/reports/` | reports | Trial Balance, P&L, Balance Sheet, Ledger, Receivables/Payables Aging, GST Computation, HSN Summary, Party Outstanding |
| `/api/sync/` | sync | Run Sync, View Logs, Retry Errors |
| `/api/audit/` | audit | Audit Log listing with filters |
| `/api/auth/` | simplejwt | Token obtain/refresh (shared with inventory system) |

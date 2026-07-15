export const meta = {
  name: 'accounting-edge-case-audit',
  description: 'Accountant + engineer edge-case audit across all accounting domains, with adversarial verification',
  phases: [
    { title: 'Audit', detail: 'one deep FE→API→BE auditor per accounting domain' },
    { title: 'Verify', detail: 'adversarial skeptic re-reads code to kill false positives' },
    { title: 'Synthesize', detail: 'prioritized accountant report' },
  ],
}

// ── Shared architecture context every auditor gets (prevents re-discovering known-handled cases) ──
const ARCH = `
You are auditing "Seefmed Accounting" — a Django REST + React/TS double-entry accounting app for an
Indian healthcare/pharmacy business (GST/TDS compliance, multi-location). Repo root: the cwd.
Backend dirs: backend/<app>/ (models.py, serializers.py, views.py, services.py). Frontend: frontend/src/.

ALREADY-HANDLED (do NOT report these as gaps — defense-in-depth exists, verify before claiming a gap):
- Journal balance enforced in journals/serializers.py JournalEntryCreateSerializer.validate (exact Decimal, ≥2 lines, non-zero) AND JournalEntry._assert_balanced (0.005 tolerance).
- Posted entries immutable: serializer.update raises on is_posted; reversal-once via reversal_of OneToOneField.
- Period lock: JournalEntry.save() calls core.period_lock.assert_unlocked(date); serializer surfaces it as 400.
- Leaf-only posting enforced in JournalEntryLine.save() AND serializer.validate.
- Per-party ledger tag↔account agreement enforced in JournalEntryLine.save(); _route_party_line auto-routes Trade control → party ledger.
- Bill-wise over-allocation guard in BillReferenceSerializer.validate (cumulative AGAINST ≤ invoice original, scoped by party+subtype+location).
- Line non-negative + not-both-Dr-Cr enforced in model.clean() and serializers.
- Perpetual inventory: purchase Dr 1190 Closing Stock; sale Cr 1190 + Dr 5560 COGS at weighted-avg. 5100 Purchases is never touched by sync.

YOUR JOB: hunt for GENUINE edge-case gaps — accounting scenarios that produce a WRONG result, a crash/500,
silent data corruption, or a FE↔BE disagreement (FE allows what BE rejects ugly, or BE accepts what yields
wrong books). Think like a chartered accountant stress-testing data entry AND like a senior engineer tracing
the full path FE component → api.ts call → DRF serializer/view → service → journal posting.

For EACH candidate finding, you MUST first check whether it is already guarded in ANY layer (model.clean,
model.save, serializer.validate, view, service, DB constraint, frontend disable/validation). Only report
if genuinely unhandled end-to-end OR the layers disagree. Cite exact file:line. Be specific about the
concrete data-entry scenario that triggers the bug and the wrong outcome it produces. Prefer FEWER, REAL,
HIGH-CONFIDENCE findings over a long speculative list. Read the actual files — do not guess.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['domain', 'flows_reviewed', 'findings'],
  properties: {
    domain: { type: 'string' },
    flows_reviewed: { type: 'array', items: { type: 'string' }, description: 'Concrete flows/screens traced end-to-end' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'severity', 'category', 'location', 'scenario', 'expected', 'actual', 'suggested_fix'],
        properties: {
          id: { type: 'string', description: 'short stable id e.g. SALES-1' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string', enum: ['wrong-accounting', 'crash-500', 'data-integrity', 'fe-be-mismatch', 'missing-validation', 'gst-tds-compliance', 'rounding', 'ux-validation'] },
          location: { type: 'string', description: 'file:line (the exact code, or the place the missing guard should live)' },
          scenario: { type: 'string', description: 'concrete data-entry steps that trigger it' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['finding_id', 'verdict', 'reasoning', 'evidence', 'adjusted_severity'],
  properties: {
    finding_id: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'partial', 'uncertain'] },
    reasoning: { type: 'string' },
    evidence: { type: 'string', description: 'file:line of the guard that refutes it, OR proof no guard exists in any layer' },
    adjusted_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'none'] },
  },
}

// ── Domains: each = a slice of the app audited FE→BE together ──
const DOMAINS = [
  {
    key: 'sales-purchase-vouchers',
    title: 'Sales & Purchase vouchers (manual)',
    files: 'frontend/src/pages/vouchers/SalesVoucherPage.tsx, PurchaseVoucherPage.tsx, VoucherEditor.tsx, VoucherLineRow.tsx, voucherConfig.ts, CreateLedgerModal.tsx; backend/journals/views.py, services.py, serializers.py',
    checklist: `GST line splits: intra-state must split CGST+SGST, inter-state must use IGST — does the editor/backend pick the right one from place-of-supply / state codes? Mixed GST rates on one invoice. Rounding of tax vs taxable so total ties to the penny. Negative/zero qty or rate. Discount before/after tax. A sales voucher posted with no party. Output GST account vs Input GST account chosen on wrong side. Whether manual SALE/PURCHASE vouchers touch inventory (1190/COGS) or not, and whether that's consistent with the synced flow. Editing a posted voucher. Saving an unbalanced voucher when tax rounding leaves a 1-paisa gap. Same invoice number entered twice (duplicate detection).`,
  },
  {
    key: 'payment-receipt-allocation',
    title: 'Payment / Receipt vouchers + bill-wise allocation',
    files: 'frontend/src/pages/vouchers/PaymentVoucherPage.tsx, ReceiptVoucherPage.tsx, SimplePaymentVoucher.tsx, SimpleReceiptVoucher.tsx, PaymentRowEditor.tsx, BillAllocationSheet.tsx, InvoiceAllocationGrid.tsx, BillRefPickerSheet.tsx; backend/journals/views.py (payment/receipt/contra endpoints), serializers.py (Payment/Receipt/BillReference), bills/services.py, banking/services.py',
    checklist: `Allocation sum vs voucher amount: paying 100 but allocating 90 (unallocated remainder → advance/on-account?) or allocating 110 (over-allocation). Paying an already fully-paid bill. Allocating across bills of different parties in one voucher. Advance/on-account handling. Bank vs cash mode missing mapping. Payment with no party. Bill-wise AGAINST a bill from another location. Rounding when splitting one payment across many bills. Negative allocation. Settling a bill in a different currency/amount than outstanding. Concurrency: two payments racing to settle the same bill past its balance. FE allows allocation > outstanding but BE guard exists — is the FE messaging correct?`,
  },
  {
    key: 'contra-journal-creditnote-debitnote',
    title: 'Contra / Journal / Credit Note / Debit Note vouchers',
    files: 'frontend/src/pages/vouchers/ContraVoucherPage.tsx, JournalVoucherPage.tsx, CreditNoteVoucherPage.tsx, DebitNoteVoucherPage.tsx; backend/journals/views.py, serializers.py',
    checklist: `Credit note must reverse GST proportionally and reduce receivable/sales — does it? Linking credit/debit note to the original invoice for GSTR-1 amendments. Contra between two cash accounts or same account both sides. Journal voucher with a single line, or all-debit. GST on credit/debit notes (CGST/SGST/IGST reversal). Credit note exceeding original invoice value. Debit note to a supplier reducing payable + input GST reversal. Date of note before the original invoice. Place of supply consistency on the note.`,
  },
  {
    key: 'journals-lifecycle',
    title: 'Journal lifecycle: post / reverse / recurring / closing',
    files: 'frontend/src/pages/JournalsPage.tsx, journals/JournalEditorPage.tsx, JournalDetailPage.tsx, RecurringJournalEditorPage.tsx, RecurringJournalDetailPage.tsx, RecurringJournalsListPage.tsx, ClosingEntriesPage.tsx; backend/journals/services.py, views.py, models.py, core/year_end.py, core/period_lock.py',
    checklist: `Reverse an already-reversed entry (reverse-once). Reverse an unposted entry. Reversal date in a locked period. Recurring journal: end_date passed but still active; next_run_date drift; DST/month-end (Jan 31 monthly → Feb); generating into a locked period; auto_post of an unbalanced template; catch-up when run is missed for several cycles; pausing/stopping mid-cycle. Year-end closing: P&L accounts zeroed to retained earnings; running closing twice; closing with open unposted entries; opening-balance carry-forward sign. Deleting a posted entry. Editing recurring lines after generations exist.`,
  },
  {
    key: 'gst-returns',
    title: 'GST returns: GSTR-1, GSTR-2B, GSTR-3B, ITC reconciliation, HSN',
    files: 'frontend/src/pages/gst/GSTR1Page.tsx, GSTR2BPage.tsx, GSTR3BPage.tsx, ITCReconciliationPage.tsx; frontend reports/HSNSummaryPage.tsx, GSTComputationPage.tsx; backend/gst_returns/services.py, views.py, models.py, gstr9c.py, core/gst_utils.py',
    checklist: `B2B vs B2C split (invoice value threshold ₹2.5L for B2CL inter-state). Intra vs inter-state classification from GSTIN/state code. Reverse-charge (RCM) inward supplies. Nil-rated/exempt/non-GST supplies excluded from taxable. Credit/debit notes feeding GSTR-1 amendments. HSN summary aggregation by HSN+rate+UQC. ITC eligibility (blocked credits), provisional vs matched ITC vs GSTR-2B. GSTR-3B tax payable = output - ITC, with cash/credit ledger. Period boundary (invoice dated last day of month). Rounding per GST rules (round to rupee). Missing GSTIN on B2B customer. Place of supply override.`,
  },
  {
    key: 'tds',
    title: 'TDS deductions & challans',
    files: 'frontend/src/pages/TDSPage.tsx; backend/tds/services.py, views.py, models.py',
    checklist: `Section-wise threshold (e.g. 194C single ₹30k / annual ₹1L, 194J ₹30k, 194I rent). PAN-not-available → 20% higher rate. Lower-deduction certificate rate. TDS at bill vs at payment (whichever earlier). TDS on amount incl/excl GST. Challan grouping by section + month + deductee category. Rounding of TDS to nearest rupee. Surcharge/cess. Reversing TDS when the underlying bill is cancelled. Deducting twice on the same bill. Quarterly return period boundaries. Threshold crossing mid-year (retro-deduct on earlier payments).`,
  },
  {
    key: 'bills',
    title: 'Vendor bills + recurring bills',
    files: 'frontend/src/pages/bills/BillsListPage.tsx, BillDetailPage.tsx, BillEditorPage.tsx, RecurringBillsListPage.tsx, RecurringBillEditorPage.tsx, RecurringBillDetailPage.tsx; backend/bills/services.py, views.py, models.py, serializers.py',
    checklist: `Duplicate bill number per supplier. Bill total vs line items + GST + TDS reconciliation. Status transitions (draft→approved→paid→cancelled) and illegal jumps. Partial payment leaving correct outstanding. Cancelling a paid/partly-paid bill. Due date / payment terms calc. Recurring bill generating into locked period; end date; amount drift. Bill posted to journal twice. Negative bill amount. Editing a bill after partial payment. Bill in a different location than the party ledger.`,
  },
  {
    key: 'banking',
    title: 'Banking: accounts, reconciliation, cheques, petty cash',
    files: 'frontend/src/pages/banking/BankingPage.tsx, BankAccountPage.tsx, ChequesPage.tsx, PettyCashPage.tsx; backend/banking/services.py, views.py, models.py',
    checklist: `Bank reconciliation: matching statement lines to book entries, unmatched both sides, reconciled balance vs book balance vs statement balance. Opening balance double-count. Cheque lifecycle: issued→presented→cleared→bounced; bounced cheque reversing the original entry + charges; post-dated cheques. Petty cash float/imprest replenishment and going negative. Reconciling the same transaction twice. Editing a reconciled transaction. Bank charges/interest auto-entries. Transfer between two bank accounts (contra) double-entry.`,
  },
  {
    key: 'expenses',
    title: 'Direct expense vouchers',
    files: 'frontend/src/pages/expenses/ExpensesListPage.tsx, ExpenseDetailPage.tsx, ExpenseEditorPage.tsx; backend/expenses/services.py, views.py, models.py',
    checklist: `Input GST on expenses (eligible vs blocked credit u/s 17(5) — e.g. staff welfare, motor vehicle). TDS on expense (rent, professional, contractor). Payment mode bank/cash and its mapping. Expense split across cost centres. Reverse-charge expenses (legal, GTA). Negative/zero amount. Expense dated in locked period. Prepaid expense vs period expense. Posting to a non-expense account. GST claimed without supplier GSTIN.`,
  },
  {
    key: 'reports',
    title: 'Reports: TB, P&L, BS, ledger, aging, daybook, cash/bank book, stock, party outstanding, GST computation',
    files: 'frontend/src/pages/reports/*; backend/reports/views.py, urls.py',
    checklist: `Trial balance must balance (Dr=Cr) and EXCLUDE optional/memorandum vouchers and unposted entries. P&L + Balance Sheet net income must tie. Balance sheet must balance (Assets = Liab + Equity incl current-year P&L). Opening balances applied to ledger/aging. Date-range boundaries (inclusive of end date). Location scoping (single vs all-locations consolidation). Aging buckets (0-30/31-60/...) computed from bill/invoice date vs due date, and partial payments reducing the right bucket. Sign conventions per account type. Ledger running balance. Cash/bank book opening + closing. Stock summary value vs 1190 balance. Drill-down filters. Division-by-zero / empty period. Negative balances shown on correct side.`,
  },
  {
    key: 'parties-ledgers',
    title: 'Parties & per-party ledgers',
    files: 'frontend/src/pages/parties/PartyListPage.tsx, PartyDetailPage.tsx, CustomersListPage.tsx, SuppliersListPage.tsx, PartySearchPicker.tsx; backend/parties/services.py, views.py, models.py, core/party_ledgers.py',
    checklist: `Opening balance posting (Dr/Cr side by customer vs supplier), and re-posting OB twice. GSTIN format validation + state-code consistency. Duplicate party (same name/GSTIN). Per-party ledger creation/routing under 2105/1125. Deleting a party with transactions. Merging parties. A party that is both customer and supplier. Cutover/migration flag behavior. Opening balance in a locked period. Inactive party still selectable in vouchers.`,
  },
  {
    key: 'payroll',
    title: 'Payroll: employees, salary structures, runs',
    files: 'frontend/src/pages/PayrollPage.tsx; backend/payroll/services.py, views.py, models.py',
    checklist: `PF (12% capped ₹15k wage), ESI (eligibility ₹21k threshold, employer+employee %), Professional Tax (state slab), TDS on salary (annual projection / 12). Salary structure: earnings - deductions = net pay; rounding. Proration for mid-month join/leave (days worked). LOP (loss of pay). Running payroll twice for the same month. Payroll run posting to journal (salary expense, PF/ESI/PT/TDS payable, net pay payable/bank). Arrears/bonus. Zero or negative net pay. Employee with no salary structure. Posting into locked period.`,
  },
  {
    key: 'fixed-assets',
    title: 'Fixed assets & depreciation',
    files: 'frontend/src/pages/fixed-assets/FixedAssetsPage.tsx; backend/fixed_assets/services.py, views.py, models.py',
    checklist: `Depreciation method (SLM vs WDV), rate, useful life. Pro-rata depreciation for mid-year acquisition (days held; Companies Act vs Income Tax >180 days rule). Depreciation below residual/scrap value (don't depreciate past it). Asset disposal: gain/loss on sale, removing accumulated depreciation. Running depreciation twice in a period. Addition to an existing asset (capex). Negative cost. Posting depreciation JE into locked period. Block-of-assets (Income Tax) vs per-asset (Companies Act).`,
  },
  {
    key: 'loans-budgets',
    title: 'Loans (amortization) & budgets',
    files: 'frontend/src/pages/loans/LoansPage.tsx; backend/loans/services.py, views.py, models.py; backend/budgets/services.py, views.py, models.py',
    checklist: `EMI split into principal + interest each period (reducing balance); rounding so final EMI clears the balance exactly. Interest accrual vs payment. Prepayment / foreclosure recalculation. Moratorium period. Loan disbursement entry. Floating rate change. Closing balance never negative. Posting into locked period. Budget vs actual variance; budget period boundaries; over-budget alerts; budget for a non-existent account.`,
  },
  {
    key: 'sync-multilocation',
    title: 'Inventory sync integration + multi-location scoping',
    files: 'frontend/src/pages/SyncPage.tsx; backend/sync/services.py, views.py, urls.py; backend/inventory_reader/models.py; backend/core/middleware.py, mixins.py',
    checklist: `Incremental sync idempotency (SyncLog.last_synced_id) — re-running doesn't double-post. A sales/purchase order edited or cancelled in inventory after it synced. Returns (SalesReturn/PurchaseReturn) reversing the right accounts. COGS at weighted-avg when cost is zero/unknown. Negative stock. A sync row with no location_id. Partial failure mid-batch (transaction atomicity). X-Location-Id missing/invalid → empty queryset vs all-locations for admin. Writing to inventory_reader (must be read-only). Location-scoped create auto-filling wrong location. Cross-location journal lines. GST split on synced B2B vs POS sales (intra/inter-state from inventory data).`,
  },
  {
    key: 'core-coa-audit-settings',
    title: 'Core: Chart of Accounts, period lock, settings, audit log, cost centres, dashboard',
    files: 'frontend/src/pages/AccountsPage.tsx, SettingsPage.tsx, AuditLogPage.tsx, CostCentresPage.tsx, DashboardPage.tsx, SetupChecklistPage.tsx, VoucherTypesPage.tsx; backend/core/views.py, models.py, period_lock.py, coa_data.py, party_ledgers.py; backend/audit/ (models, utils, views)',
    checklist: `COA hierarchy: deleting/deactivating an account with transactions or children; changing an account's type after postings; creating a leaf under a leaf. Account code uniqueness. Period lock: locking a period then editing/reversing within it; unlocking; lock boundary inclusive/exclusive; lock vs fiscal year. Audit log immutability (append-only, no edit/delete) and that every mutation actually logs. Cost centre allocation summing to 100%. Settings: fiscal year start override, GSTIN, rounding method changes mid-year. Dashboard KPI date scoping. Voucher-type profile numbering (yearly restart, manual numbering collision).`,
  },
]

phase('Audit')
log(`Auditing ${DOMAINS.length} accounting domains FE→BE, then adversarially verifying every finding…`)

const auditPrompt = (d) => `${ARCH}

DOMAIN TO AUDIT: ${d.title}
KEY FILES (read them fully — both frontend and backend; follow imports/api.ts calls to trace the full path):
${d.files}

EDGE-CASE CHECKLIST (an accountant's stress test — work through each, but also use your own judgment to find others):
${d.checklist}

Trace each real flow end-to-end. Open the frontend page, find the api.ts function it calls, open the DRF
view/serializer/service it hits, and the journal posting it produces. Decide, for each edge case, whether the
WRONG/missing behavior is actually possible given guards in ALL layers. Report only genuine, reproducible gaps.
Return findings per the schema. flows_reviewed = the concrete screens/endpoints you actually traced.`

const verifyPrompt = (f, domainTitle) => `You are a SKEPTICAL senior engineer + chartered accountant doing adversarial verification of ONE audit finding
in the Seefmed Accounting app (Django REST + React). Your DEFAULT is to REFUTE: assume the original auditor missed
a guard. Only CONFIRM if, after reading the actual code in EVERY layer, the edge case truly produces a wrong/crashing/
corrupting result with no guard anywhere.

Domain: ${domainTitle}
Finding ${f.id}: ${f.title}
Severity claimed: ${f.severity} | Category: ${f.category}
Location: ${f.location}
Scenario: ${f.scenario}
Expected: ${f.expected}
Actual (claimed): ${f.actual}

Do this:
1. Open the cited file:line AND the full path it sits in (model.clean/save, serializer.validate, view, service, DB
   constraint, and the frontend validation/disable). Use grep to find guards elsewhere (e.g. assert_unlocked,
   is_leaf, balance checks, over-allocation, party routing).
2. Construct the exact scenario and decide what actually happens.
3. verdict: 'confirmed' (real gap, no guard), 'refuted' (a guard handles it — cite it), 'partial' (real but narrower/
   lower severity than claimed), or 'uncertain' (can't tell without running). Set adjusted_severity honestly
   ('none' if refuted). evidence MUST cite the specific file:line of the guard (if refuting) or prove its absence.
Return per the schema.`

const audited = await pipeline(
  DOMAINS,
  (d) => agent(auditPrompt(d), { label: `audit:${d.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (result, d) => {
    if (!result || !result.findings || result.findings.length === 0) {
      return { domain: d, audit: result, verified: [] }
    }
    return parallel(
      result.findings.map((f) => () =>
        agent(verifyPrompt(f, d.title), { label: `verify:${d.key}:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA })
          .then((v) => ({ finding: f, verdict: v }))
          .catch(() => ({ finding: f, verdict: null }))
      )
    ).then((verified) => ({ domain: d, audit: result, verified }))
  }
)

// Keep findings that survived verification (confirmed or partial). Refuted/none are dropped but counted.
phase('Synthesize')
const surviving = []
let totalRaw = 0
let totalRefuted = 0
for (const row of audited.filter(Boolean)) {
  for (const v of row.verified) {
    totalRaw++
    const verdict = v.verdict
    if (!verdict) { continue }
    if (verdict.verdict === 'confirmed' || verdict.verdict === 'partial') {
      surviving.push({
        domain: row.domain.title,
        domainKey: row.domain.key,
        ...v.finding,
        verdict: verdict.verdict,
        adjusted_severity: verdict.adjusted_severity,
        verify_reasoning: verdict.reasoning,
        verify_evidence: verdict.evidence,
      })
    } else {
      totalRefuted++
    }
  }
}

log(`Raw findings: ${totalRaw}. Refuted/dropped: ${totalRefuted}. Surviving (confirmed/partial): ${surviving.length}.`)

// Final synthesis agent: dedupe, prioritize, write the accountant's report.
const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['executive_summary', 'critical', 'high', 'medium', 'low', 'themes'],
  properties: {
    executive_summary: { type: 'string' },
    themes: { type: 'array', items: { type: 'string' }, description: 'Cross-cutting patterns of missing edge cases' },
    critical: { type: 'array', items: { $ref: '#/$defs/item' } },
    high: { type: 'array', items: { $ref: '#/$defs/item' } },
    medium: { type: 'array', items: { $ref: '#/$defs/item' } },
    low: { type: 'array', items: { $ref: '#/$defs/item' } },
  },
  $defs: {
    item: {
      type: 'object',
      additionalProperties: false,
      required: ['domain', 'title', 'location', 'scenario', 'impact', 'fix'],
      properties: {
        domain: { type: 'string' },
        title: { type: 'string' },
        location: { type: 'string' },
        scenario: { type: 'string' },
        impact: { type: 'string' },
        fix: { type: 'string' },
      },
    },
  },
}

const synth = await agent(
  `You are the lead chartered accountant + engineering reviewer compiling the final edge-case audit report for the
Seefmed Accounting app. Below are the VERIFIED-SURVIVING findings (each already adversarially confirmed against the
code, with evidence). Deduplicate overlapping findings, merge near-duplicates across domains, re-rank by true
business/accounting impact (wrong books > crash > data integrity > validation/UX), and group by severity. Use the
adjusted_severity from verification, not the original. Write a crisp executive summary an accountant and a tech lead
would both trust, and list cross-cutting themes (e.g. "GST inter/intra-state classification is inconsistent across
modules"). Keep each item's location (file:line) intact.

VERIFIED FINDINGS (JSON):
${JSON.stringify(surviving, null, 2)}`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA }
)

return { stats: { totalRaw, totalRefuted, surviving: surviving.length }, report: synth, surviving }

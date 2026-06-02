# Seefmed Accounting — Edge-Case & Integration Audit

_Multi-agent audit: 16 domains, 96 agents, 79 raw findings, 2 refuted on adversarial verification, 77 verified. Existing 45 test files all green — these are gaps beyond current coverage._

## Executive summary

This audit examined 13 functional domains of the Seefmed Accounting application and surfaced 64 verified, adversarially-confirmed defects. The headline risk is not in the manual-voucher UI but in the automated inventory-sync engine and the year-end/GST machinery, where five issues silently produce wrong books that feed statutory returns: COGS is computed as an unweighted, location-blind, all-time arithmetic mean of purchase rate (up to ~46x error per sale); POS bill-level discounts make the sale journal unbalanced so the entire sale — revenue, output GST and COGS — silently fails to post; the year-end opening-balance JV double-counts every asset/liability/equity on the cumulative Balance Sheet; opening-stock-only products sell without relieving inventory; and the GSTR-2B "generate" button blanket-deletes uploaded government 2B data, destroying the only source for genuine ITC reconciliation. These five (plus the loan-create crash, which bricks the entire loans feature on every attempt) are the CRITICAL set and should be fixed before the books are trusted for filing.

A second, large band of HIGH issues clusters around two systemic root causes. First, JournalEntryLine.save() never calls full_clean(), so the model's own non-negative / not-both-sided invariant is dead code for every service-layer .objects.create() — this lets negative payroll net pay, negative petty-cash replenishments, negative-cost fixed assets, and other malformed-but-balanced entries post cleanly across banking, payroll, expenses, fixed-assets and loans. Second, a pervasive serializer-validation gap lets API/import clients post accounting-wrong data the frontend would never send: expense lines debiting non-expense accounts, account mappings pointing at non-leaf accounts, loan GLs of the wrong type, bill/expense totals that don't tie to lines (silently dumped to Round-Off without a cap), and cheques bound to arbitrary unrelated JEs that can then be reversed. Several Django ValidationError subclasses (PeriodLockedError) and bare ValueErrors (unconfigured GST input mapping, invalid FY-start month) escape DRF's exception handler as raw HTTP 500s on legitimate operator actions.

The MEDIUM and LOW bands are dominated by missing cross-checks (header party vs line party, invoice-number dedup, bill-wise allocation survival across edits), GST classification gaps (intra/inter-state head not validated on manual vouchers; POS-to-registered-buyer mis-tagged as B2C; B2CL threshold stale at the superseded ₹2.5L), aging reports that bucket gross while totaling net, and statutory payroll omissions (no PF ₹15k ceiling, no salary TDS u/s 192, no mid-month proration). Many of these are reachable only via direct API today because the shipped UI constrains inputs, but the backend is the system of record and offers no defense, so they are latent until any alternate client, CSV import, or future UI screen exercises the path.

## Cross-cutting themes

- Model invariant defeated by .objects.create(): JournalEntryLine.clean() forbids negative and both-sided lines, but JournalEntryLine.save() never calls full_clean(), so the guard is dead code on every service-layer create. One missing line lets negative/malformed-but-balanced entries post across payroll (negative net), banking (negative petty-cash replenish), fixed assets (negative cost), and loans — all silent because _assert_balanced still passes. Single highest-leverage fix.
- Frontend constrains, backend trusts: the React UI filters account pickers by type/leaf/active and derives totals, but the corresponding serializers validate almost nothing (account_type, leaf, is_active, total==lines+tax, non-negative tax, supplier GSTIN). Every such gap is exploitable by direct API, CSV import, or any alternate client — and since the backend is the system of record, these are latent corruption paths, not theoretical. Affects expenses, bills, loans, account-mappings, TDS, fixed assets, journal lines.
- Header/line and bill/JE identity is never cross-checked: the header party isn't carried onto AR/AP lines (Sales/Purchase and Credit/Debit Note -> unfixable 400 on the generic Trade control, or silent posting to the wrong party); cheques can bind to arbitrary unrelated JEs; voucher bill-allocations don't reconcile to the bills-app Bill; the same JE can match two bank lines. The app routinely posts a relationship it never validates.
- Django ValidationError / ValueError escaping as HTTP 500: PeriodLockedError (subclass of django ValidationError) and bare ValueErrors (unconfigured GST input mapping, invalid FY-start month, emi_day=0, missing log_action import, NULL emi_amount) are not converted by DRF's default handler, so legitimate operator actions return raw 500s instead of clean 400s. A single custom DRF EXCEPTION_HANDLER mapping django ValidationError -> 400 would neutralize most of these.
- GST inter/intra-state classification is inconsistent across modules: the synced journal posting derives supply type from GSTIN only, while GSTR-1 uses a customer state-name fallback — so the filed return's tax head can diverge from the GL. Manual SALE/PURCHASE vouchers do no supply-type validation at all (wrong-head ITC corrupts GSTR-3B), POS sales to registered buyers are mis-tagged B2C, the B2CL threshold is stale at the superseded Rs2.5L, and time-barred credit notes desync the books from the filed 3B. There is no single authoritative supply-type resolver shared by the posting and return-generation paths.
- Reporting/aggregation queries diverge from the canonical balance source: financial reports and the Dashboard filter only is_posted=True and ignore is_optional/is_memorandum that ChartOfAccount.get_balance() (and year-end close) honor; the Balance Sheet has no FY-start floor so the opening JV double-counts; the ledger drill-down forces opening balance to 0; aging buckets are gross while totals are net; cash-flow opening isn't location-scoped. A shared, exclusion-aware reporting queryset would prevent this whole class of drift.
- Inventory sync is fire-and-forget with no lifecycle or concurrency guard: orders are posted once and never reversed when cancelled/edited upstream; COGS cost is an unweighted, location-blind, all-time mean that ignores opening stock; bill-level discounts silently break the sale JE; and there is no unique constraint or advisory lock on (reference_type, reference_id), so overlapping UI+cron syncs double-post. The most financially material defects in the system live in this autonomous, unattended pipeline.
- Statutory Indian payroll/TDS rules are partially or not implemented: no PF Rs15,000 wage ceiling (journal vs EPFO ECR mismatch), no section-192 salary TDS at all, no mid-month proration/LOP, and the manual TDS deduction path has no rate/PAN/206AA validation. Salary and statutory filings can be materially wrong while the double-entry still balances.
- Multi-location scoping is enforced inconsistently: payroll processing and runs, TDS challans, and NULL-location synced purchases all bypass the location_id-end-to-end invariant that bills/expenses respect via LocationFilterMixin — producing cross-location processing, viewer-dependent books, and challans/JEs with no location. The invariant is documented but not centrally enforced on every write path.
- Period-lock and year-end close are fragile: closing a second FY silently unlocks the prior one (single CharField, no closed-year history); the close itself 500s if the closing month is locked; and the opening-balance JV is both required by windowed reports and double-counted by the cumulative Balance Sheet. The close/lock model needs a set-of-closed-years plus a single coherent opening-balance strategy.

## Findings by severity: 5 critical · 33 high · 26 medium · 10 low


---

## CRITICAL (5)

### C1. Weighted-average COGS is actually an unweighted, location-blind, all-time average of purchase_rate

- **Domain:** Inventory sync integration + multi-location scoping
- **Location:** `backend/journals/services.py:86-95 (_product_avg_cost) used by _post_cogs at services.py:115 and sales-return reversal at services.py:577`
- **Scenario:** Buy a product twice (PO#1 = 1000 units @ Rs10, PO#2 = 1 unit @ Rs1000) then sell it via POS/B2B and Run Sync. _product_avg_cost does PurchaseOrderLineRO.objects.filter(product_id=...).aggregate(avg=Avg('purchase_rate')) — a plain arithmetic mean ignoring quantity, location and time.
- **Impact:** Cost per unit = (10+1000)/2 = Rs505 instead of the true weighted Rs10.99 — ~46x overstatement of COGS and understatement of Closing Stock (1190). The docstring claims 'weighted-average' but it is not. Error compounds on every sale and every sales-return reversal; gross profit and the inventory asset are materially wrong. reports/views.py:1272 already uses the correct Sum(F('quantity')*F('purchase_rate')) formula elsewhere, proving the right approach exists but was not used on the posting path.
- **Fix:** Compute a quantity-weighted average Sum(purchase_rate*(quantity+free_qty))/Sum(quantity+free_qty) over PurchaseOrderLineRO plus OpeningStockLineRO, scoped to the entry's location_id, and cache per (product_id, location_id) for the run.

### C2. POS order-level discount makes the sale JE unbalanced beyond the Rs1 round-off tolerance — the sale silently fails to post and revenue/GST go missing

- **Domain:** Inventory sync integration + multi-location scoping
- **Location:** `backend/journals/services.py:337-370 (generate_pos_sale); credits from per-line line_total at services.py:317-321, debit is pos.total_amount; round-off guard at services.py:364 fires only when abs(diff) < 1.00`
- **Scenario:** Create a POS order with a bill-level POSOrderRO.discount_amount (e.g. Rs50) that is not pushed into per-line line_total, then Run Sync. Credits are built from the full pre-discount line totals while the debit is total_amount (net of discount), so diff = -(discount - round_off).
- **Impact:** When discount_amount > ~Rs1 the round-off branch is skipped, entry.post()->_assert_balanced raises (delta > 0.005), and the sync loop's `except Exception` swallows it into a SyncError. The sale never reaches the ledger: inventory shows the order completed but the accounts show no sale, no output GST, no COGS. Silent, recurring revenue and output-GST omission (GSTR filing exposure) that grows with discount size and also triggers on loyalty redemptions. Verified against the authoritative pharmacy POS code (healthcare-pharmacy/backend/pos/views.py:344-407) which confirms total_amount = subtotal - discount_amount - loyalty + round_off while line_total keeps the pre-discount value.
- **Fix:** Account for pos.discount_amount explicitly — reduce the Sales credit by the order-level discount (or post it to a Discount-Allowed account) so the JE balances to total_amount regardless of discount magnitude. Apply the same check to B2BSalesOrderRO. Do not rely on the <Rs1 round-off band to absorb real discounts.

### C3. Opening-balance carry-forward JV double-counts every Asset/Liability/Equity on the cumulative Balance Sheet

- **Domain:** Journal lifecycle: post / reverse / recurring / closing
- **Location:** `backend/core/year_end.py:102-149 (opening JV) vs backend/reports/views.py:231-234 (BalanceSheetView cumulative filter)`
- **Scenario:** Close an FY with generate_opening=True (the default). The service posts an OPENING BALANCES JV dated fy_start that re-states each ASSET/LIABILITY/EQUITY leaf at its cumulative balance as of fy_end. Open the Balance Sheet for any date >= fy_start.
- **Impact:** BalanceSheetView sums all posted lines with entry__date__lte=as_of_date and no FY-start floor, so it counts BOTH the original cumulative ledger AND the opening-JV restatement — every asset/liability/equity balance doubles from the new FY onward (e.g. true Cash Rs60,000 reports Rs120,000). The double-count is symmetric so is_balanced stays True, masking the error. TrialBalanceView/ProfitLossView use a windowed date range and genuinely need the opening JV, so the two report families have contradictory date semantics — no single config satisfies both. Untested: tests only assert the opening JV exists.
- **Fix:** Pick one model: either post a year-end 'carry-down' that nets BS accounts to zero at fy_end, or keep the ledger continuous (no opening JV) and have the windowed TB/P&L compute brought-forward from pre-fy_start entries. Immediate guard: stop defaulting generate_opening=True, or exclude reference_type='OpeningCarryForward' from BalanceSheetView.

### C4. GSTR-2B generate blanket-deletes uploaded government 2B data; GSTR-3B generate silently re-triggers it

- **Domain:** GST returns: GSTR-1, GSTR-2B, GSTR-3B, ITC reconciliation, HSN
- **Location:** `backend/gst_returns/services.py:397 (GSTR2BGenerator.generate delete, no source filter) and services.py:488 (GSTR3BGenerator.generate calls GSTR2BGenerator().generate())`
- **Scenario:** Upload the official GSTR-2B JSON for a period (creates GSTR2BEntry rows with source_po_id=NULL). Later open the GSTR-3B page and click Generate — a routine monthly step. GSTR3BGenerator.generate() unconditionally calls GSTR2BGenerator().generate(), whose first statement is GSTR2BEntry.objects.filter(period, location_id).delete() with no source filter.
- **Impact:** Every 2B row for the period — including the uploaded official government 2B — is deleted and replaced with a PO-derived 'books' view. ITCReconciliationService.reconcile then compares books-JEs against this PO-derived 2B (itself just the books), defeating the entire purpose of ITC reconciliation; the genuine government-vs-books mismatch is lost. The uploaded regulatory source data is unrecoverable (single table, no backup, only source_po_id discriminates). The only existing guard blocks regeneration of a FILED 3B, which does not protect the routine un-filed case.
- **Fix:** Scope the delete to source_po_id__isnull=False (only auto-derived rows), or skip regeneration entirely when uploaded government rows exist for the period, and reconcile against the uploaded rows. Add a frontend confirmation.

### C5. Loan creation always 500s: serializer.save() inserts NULL into NOT NULL emi_amount/end_date

- **Domain:** Loans (amortization) & budgets
- **Location:** `backend/loans/views.py:30 (serializer.save before fields computed); NOT NULL no-default columns at backend/loans/models.py:42,45 and read_only at serializers.py:47`
- **Scenario:** Open Loans, click New Loan, fill the happy-path fields and Save. createLoan POSTs to /api/loans/loans/. LoanViewSet.perform_create calls serializer.save() BEFORE computing emi_amount/end_date (computed only at views.py:34-47).
- **Impact:** emi_amount and end_date are NOT NULL with no DB default and are in read_only_fields, so they are excluded from validated_data; the INSERT violates the NOT NULL constraint -> IntegrityError -> unhandled HTTP 500. Reproduced live: 'NOT NULL constraint failed: loans_loan.end_date' for every loan create. The loans feature is non-functional end-to-end; the failure is input-independent so no frontend validation can prevent it.
- **Fix:** Compute emi_amount and end_date from validated_data BEFORE persisting, then serializer.save(emi_amount=emi, end_date=end_date, created_by=...). Defense-in-depth: give the model fields null=True or a default.


---

## HIGH (33)

### H1. Service-layer journal lines bypass the non-negative / not-both-sided guard because JournalEntryLine.save() never calls full_clean() — enabling negative payroll, petty-cash and asset entries

- **Domain:** Banking / Payroll / Fixed Assets (cross-cutting model gap)
- **Location:** `backend/journals/models.py:252-283 (clean() defines the guard; save() calls super().save() without full_clean()); exercised by banking/services.py (replenish_petty_cash), payroll/services.py:94-98, fixed_assets/services.py:47-56, loans/services.py`
- **Scenario:** Any service path that builds lines with .objects.create() and a negative Decimal: petty-cash replenish with -2000 (BANK-3); payroll net pay where deductions exceed gross, e.g. basic 5000 with PT 5000 -> net -600 (payroll); fixed-asset acquisition_cost = -50000 (FA-3). JournalEntryLine.clean() forbids negatives but is never invoked on the create path.
- **Impact:** Negative-valued debit/credit lines persist and post because the entry still satisfies _assert_balanced (e.g. -2000 == -2000). Petty cash and bank GLs move the wrong direction; payroll posts a phantom negative bank payment on Mark Paid and prints a negative payslip; a negative-cost asset books a reversed Dr Asset/Cr Bank. This is the shared root cause behind BANK-3, BANK-4, PAY-1 (payroll) and FA-3 — one missing full_clean() defeats the model-level safety net the whole codebase relies on, across multiple modules, all silent and posting immutable entries.
- **Fix:** Call self.full_clean() (or inline the non-negative + not-both checks) inside JournalEntryLine.save() before super().save(); add a DB CheckConstraint (debit>=0, credit>=0). Also validate amount > 0 in each service (replenish_petty_cash, calculate_salary/process_payroll, post_acquisition) and surface as 400.

### H2. Cheque.journal_entry is writable on create — a user can attach an arbitrary unrelated posted JE and then bounce it to reverse books they shouldn't touch

- **Domain:** Banking: accounts, reconciliation, cheques, petty cash
- **Location:** `backend/banking/serializers.py:96,98,101-103 (journal_entry/bill_payment in fields, omitted from read_only_fields) + views.py:195-199 (perform_create) + services.py:342-375 (mark_cheque_bounced)`
- **Scenario:** createCheque is called with journal_entry set to the id of any existing posted JournalEntry (e.g. a large sales-receipt JV from another module/period). The cheque saves with that JE linked. The user clicks Bounce; mark_cheque_bounced sees the JE is posted and, with reverse_je default True, creates a full reversal (swapping debit/credit of every line) and posts it, and rolls back bill_payment.amount_paid if a BillPayment was also attached.
- **Impact:** An authenticated user can post arbitrary reversing JEs against ANY posted entry in the ledger and roll back unrelated bill payments — corrupting books for transactions with no relationship to the cheque. mark_cheque_bounced has no ownership check, never compares cheque.amount to the JE total, and never verifies the JE's lines touch the cheque's bank account. JournalEntry.post() only asserts balance, which a swapped-line reversal always satisfies. There is no internal Cheque.objects.create() site — the link is set solely by the API client.
- **Fix:** Add 'journal_entry' and 'bill_payment' to ChequeSerializer.read_only_fields; set journal_entry only from the trusted service that posts the cheque's original entry. Assert the JE's lines actually touch the cheque's bank_account before reversing in mark_cheque_bounced.

### H3. Same journal entry can be reconciled against two different bank transactions on the same account/side — double-counts the reconciliation and can flag a non-tying account as 'clean'

- **Domain:** Banking: accounts, reconciliation, cheques, petty cash
- **Location:** `backend/banking/services.py:209-231 (match_transaction); no unique constraint on matched_journal_entry at models.py:90-94`
- **Scenario:** Bank account A has two same-side Rs5,000 outflow lines whose descriptions differ (so the dedupe constraint passes). Match the first to JE JV-...123. Open the second line's 'match by Journal Entry ID' box and paste 123 again. match_transaction only checks the JE has a credit of 5,000 on A's GL; it never checks the JE is already matched to another transaction on the same account/side.
- **Impact:** Both lines get status='matched' pointing at the same Rs5,000 JE, claiming Rs10,000 of statement activity is explained by one Rs5,000 entry. The 'For Review' count drops by two while only one book entry exists, hiding a genuine unreconciled item. The bank reconciliation report's is_clean = (delta<0.01 AND unmatched_txns==0) can wrongly report True (reports/views.py:1584-1609) — a data-integrity failure for the core purpose of the banking module. The advisory suggestion list excludes matched JEs but the manual-ID box bypasses it.
- **Fix:** In match_transaction, before saving, exclude self and reject if BankTransaction.objects.filter(bank_account=txn.bank_account, matched_journal_entry=journal_entry).exclude(id=txn.id) already has a transaction with the same side, unless the JE has a separate unmatched bank line for the opposite side (legitimate contra).

### H4. Expense line account is not validated to be an EXPENSE account server-side — any leaf account (asset/liability/equity/revenue) posts as an expense debit

- **Domain:** Direct expense vouchers
- **Location:** `backend/expenses/serializers.py:14-17,99-108 (no type validation); posting at services.py:50-53; paid_through unchecked at services.py:64-67`
- **Scenario:** POST /api/expenses/ with an item whose `account` is a leaf that is NOT EXPENSE — a bank ledger (1120), a payable (2110), capital (3xxx) or revenue (4xxx). The frontend AccountPicker is fed only EXPENSE accounts but the serializer accepts any ChartOfAccount PK and the service blindly debits it. Same hole for paid_through_account (no Bank/Cash check).
- **Impact:** The only model guard hit is JournalEntryLine.save()'s leaf-only check, which passes for any leaf regardless of type. The JE posts a debit to a liability/asset/revenue account, balancing against the bank credit — structurally valid but accounting-wrong books (overstated assets / understated liabilities / contra-debited revenue, all mislabeled under a 'Payment' voucher). Posted JEs are immutable, so the misclassification must be reversed, not edited.
- **Fix:** In ExpenseItemWriteSerializer.validate assert item.account.account_type == 'EXPENSE' (allow a small whitelist if prepaid-asset routing is intended), and validate paid_through_account.account_subtype in {'Bank','Cash'} and is_active/is_leaf.

### H5. Entering GST on an expense when the INPUT_CGST/SGST/IGST mapping is unconfigured throws an uncaught ValueError -> HTTP 500

- **Domain:** Direct expense vouchers
- **Location:** `backend/expenses/services.py:56-61 (the three _acct('INPUT_*') calls) vs views.py:95 (except DjangoValidationError only)`
- **Scenario:** On a location with no per-location and no NULL-default AccountMapping for INPUT_CGST/SGST/IGST, create a draft expense, type a positive CGST amount, and Save & Record. AccountMapping.get_account('INPUT_CGST', loc) raises a bare Python ValueError.
- **Impact:** The record view only catches django.core.exceptions.ValidationError and there is no custom DRF exception handler, so the ValueError escapes as an unhandled HTTP 500 with no useful reason shown to the user. Inconsistent with the sibling ROUND_OFF branch (services.py:73-79) which deliberately catches the same ValueError and returns an actionable 400.
- **Fix:** Wrap the three INPUT_* _acct() lookups in try/except ValueError and re-raise as django.core.exceptions.ValidationError('Configure the INPUT_CGST/SGST/IGST account mapping before recording GST on expenses.'), mirroring the existing ROUND_OFF handling.

### H6. Acquisition cost / salvage / class editable after acquisition JE is posted — books desync silently

- **Domain:** Fixed assets & depreciation
- **Location:** `backend/fixed_assets/serializers.py:39 (read_only_fields) and views.py:47 (perform_update); no FixedAsset.clean()`
- **Scenario:** Create an asset (cost 60,000), Post Acq. (Dr Asset 60,000 / Cr Bank 60,000). Then PATCH the asset and change acquisition_cost to 90,000, or change asset_class to one with a different asset GL, or change salvage/date. read_only_fields only freezes status/disposal/JE-link fields.
- **Impact:** The PATCH succeeds while the posted acquisition JE still reflects 60,000. NBV/depreciable_base now compute from 90,000 and every future SLM/WDV charge is wrong, while the asset-at-cost GL no longer ties to the register. Changing asset_class re-routes future depreciation to a different accum-dep/expense GL than the acquisition used. No reconciliation check; the acquisition JE is immutable so there is no recovery path.
- **Fix:** Add FixedAssetSerializer.validate(): if acquisition_journal_entry_id is set or any DepreciationEntry exists, reject changes to acquisition_cost, acquisition_date, salvage_value, asset_class, useful_life_months. Cost corrections should be a new addition record or a reversing JE.

### H7. Disposal allowed with no posted acquisition JE — credits an asset GL that was never debited

- **Domain:** Fixed assets & depreciation
- **Location:** `backend/fixed_assets/services.py:170-197 (dispose_asset status check) and views.py:65-81 (dispose action)`
- **Scenario:** Create an asset (status defaults to 'active') but do NOT Post Acq. POST /fixed-assets/assets/<id>/dispose/ directly. dispose_asset only checks status=='active'; the FE merely hides the Dispose button via acquisition_entry_no, the backend does not enforce it.
- **Impact:** dispose_asset unconditionally credits asset_class.asset_account for the full acquisition_cost even though no acquisition JE ever debited it, pushing the asset GL negative. gain_loss = proceeds - (cost - accum) is still computed off cost, so the P&L line is also wrong. The JE balances so JournalEntry.post() does not catch it. FE/BE disagreement plus corrupt books.
- **Fix:** In dispose_asset, require asset.acquisition_journal_entry_id (raise ValidationError otherwise), mirroring the FE gate, so the credit to the asset GL always offsets a real prior debit.

### H8. No validation on acquisition_cost / salvage_value — negative cost or salvage > cost produces a backwards JE or zero depreciation

- **Domain:** Fixed assets & depreciation
- **Location:** `backend/fixed_assets/models.py:63-146 (no clean()) and serializers.py:20-47 (no validate())`
- **Scenario:** Create an asset with acquisition_cost = -50000 (typo/paste) and Post Acq., or create with cost 60000 and salvage_value 80000.
- **Impact:** Negative cost: post_acquisition books Dr Asset -50000 / Cr Bank -50000 (balanced but reversed, effectively crediting the asset and debiting bank) — the non-negative line guard is dead code because objects.create() never calls full_clean(); the immutable JE corrupts both ledgers. Salvage > cost: depreciable_base is negative and the asset never depreciates (stays at full cost forever). Neither is caught at any layer. (Shares the full_clean() root cause with the cross-cutting model-guard finding.)
- **Fix:** Add serializer validate(): acquisition_cost > 0; 0 <= salvage_value <= acquisition_cost; also validate AssetClass.wdv_rate_pct in 0-100 and useful_life_years > 0.

### H9. Setting/editing/clearing a party opening balance for a locked period returns HTTP 500 instead of a clean 400

- **Domain:** Parties & per-party ledgers
- **Location:** `backend/parties/views.py:270-292 (put) and 294-305 (delete); root cause opening_balance.py:108/:61 -> JournalEntry.post() -> assert_unlocked raising PeriodLockedError`
- **Scenario:** Lock a cutover month (LockedPeriod '2025-04') or close an FY, then Set/Edit/Clear a party opening balance with As-of date inside that locked period (the common cutover case). The PUT/DELETE posts a JE at the locked date and assert_unlocked raises PeriodLockedError.
- **Impact:** PeriodLockedError subclasses django.core.exceptions.ValidationError, not a DRF APIException, and the view never catches it, so it propagates as HTTP 500. The frontend shows only a generic 'Failed to save'. Reproduced live for both PUT and DELETE. Cutover opening balances commonly fall in a closed/locked prior period, so this is a routine, easily-hit path with no actionable error and no way to recover short of unlocking. (The atomic wrapper rolls back cleanly, so no data corruption — pure crash/UX.)
- **Fix:** Wrap the post_opening_balance_je / void_opening_balance_je calls in try/except PeriodLockedError and re-raise as rest_framework.serializers.ValidationError, mirroring journals/serializers.py:270-274.

### H10. Form 26AS reconcile crashes with NameError after mutating rows (log_action not imported)

- **Domain:** TDS deductions & challans
- **Location:** `backend/tds/views.py:338 (Form26ASViewSet.reconcile) — log_action used but never imported`
- **Scenario:** POST /api/tds/form-26as/reconcile/ {fy_label:'2025-26'}. The handler loops over unmatched rows, sets match_status/matched_journal_entry, calls row.save() per row, then at line 338 calls log_action — which is not imported anywhere in the module.
- **Impact:** After the per-row .save() side effects are already committed (ATOMIC_REQUESTS is unset), the final log_action call raises NameError -> HTTP 500. The reconciliation status changes persist but the caller gets an error and no audit row is written, so the operation looks failed while having partially altered state. Fires on every reconcile call, even with zero matched rows.
- **Fix:** Add `from audit.utils import log_action` to backend/tds/views.py imports. Optionally wrap the row updates + log in transaction.atomic() so a failure doesn't leave half-reconciled state.

### H11. Auto-generated challan ignores location_id and merges TDS across all locations

- **Domain:** TDS deductions & challans
- **Location:** `backend/tds/services.py:169-201 (auto_generate_challan); TDSChallanViewSet lacks LocationFilterMixin (views.py:225-237)`
- **Scenario:** Store A active, click Auto-Generate Challan for 194Q/2025-06. The pending queryset filters only section + transaction_date + status='pending' — no location_id, and the X-Location-Id header is never consulted in the service.
- **Impact:** All pending deductions across ALL locations for that section/month are swept into one challan and marked 'challan_paid'. The resulting TDSChallan has no location_id field at all. Store B's pending workflow is silently consumed by a Store A action; per-location 26Q returns (which ARE strictly location-scoped) diverge from what was deposited. Violates the app's stated location-scoping invariant and the per-location pattern used everywhere else in the module.
- **Fix:** Thread request.active_location_id into the service and filter pending by location_id; add a location_id field to TDSChallan so challans are location-scoped and reportable per TAN.

### H12. Manually linking deductions to a challan does not mark them challan_paid -> duplicate challan / double-counted liability

- **Domain:** TDS deductions & challans
- **Location:** `backend/tds/serializers.py:43-57 (create/update call deductions.set without status update) vs services.py:172 auto_generate filter status='pending'`
- **Scenario:** POST /api/tds/challans/ with deduction_ids:[12,13]. The serializer creates the challan and calls challan.deductions.set([...]) but never updates those deductions' status — they stay 'pending'. Later run Auto-Generate Challan for the same section/period; auto_generate_challan re-picks them, creating a SECOND challan over the same deductions.
- **Impact:** The same TDS amount lands on two challans, inflating reported/deposited TDS and producing a 26Q where deductions map to the wrong/duplicate challan. total_tds_amount is also trusted verbatim from the client and never reconciled against sum(linked deductions). NOTE: createTDSChallan is not wired to any UI today (only Auto-Generate is), so this is currently API-only, which is why adjusted severity is medium — but the write field and enabled POST clearly anticipate a manual-link UI.
- **Fix:** In TDSChallanSerializer.create/update, after deductions.set(...), update linked rows to status='challan_paid', stamp challan_no/challan_date, and recompute total_tds_amount from the linked deductions instead of trusting the client.

### H13. Negative net salary is posted as a negative credit/debit — silent books corruption

- **Domain:** Payroll: employees, salary structures, runs
- **Location:** `backend/payroll/services.py:36 (net = gross - deductions, no clamp) and :94-98 (JournalEntryLine credit=net_salary)`
- **Scenario:** Salary structure where deductions exceed gross (basic 5000, PF 12%, professional_tax 5000) -> calculate_salary returns net_salary = -600. Run payroll.
- **Impact:** process_payroll creates a line with credit=-600 on NET_SALARY_PAYABLE; the entry still passes _assert_balanced (both sides reduced by the same delta) and posts. PayrollRun stores -600, the payslip prints a negative Net Salary, and Mark Paid later posts Net Salary Payable Dr -600 / Bank Cr -600 — a phantom negative bank payment. All silent. (Shares the full_clean() root cause.)
- **Fix:** In calculate_salary/process_payroll, validate net_salary > 0 (and each line amount >= 0) before creating lines; raise surfaced as 400. Defense-in-depth: DB CheckConstraint and full_clean() in JournalEntryLine.save().

### H14. PF deducted/posted with no Rs15,000 wage ceiling — over-deduction and journal vs EPFO ECR mismatch

- **Domain:** Payroll: employees, salary structures, runs
- **Location:** `backend/payroll/services.py:25-26 (pf = basic * pct/100, no cap) vs :285 (ECR caps epf_wages at 15000)`
- **Scenario:** Employee with basic_salary 50,000 and the default pf_employee_pct 12. Process payroll.
- **Impact:** calculate_salary computes pf_employee = 6,000 with NO Rs15,000 ceiling (statutory is 12% of 15,000 = 1,800), over-deducting Rs4,200 and overstating PF Payable. generate_epfo_ecr_file caps EPF wages at 15,000 but emits the uncapped 6,000 as the employee EPF — the ECR file is internally inconsistent (6,000 is 40% of the 15,000 wage shown) and PF Payable (12,000) will never reconcile to the EPFO challan (3,600).
- **Fix:** Apply the EPF wage ceiling in calculate_salary: pf_wage = min(basic_salary, 15000) (with a voluntary-uncapped opt-in if needed), and derive both the deduction and the ECR employee EPF from the same capped wage.

### H15. Payroll views ignore active location — cross-location processing and data leakage

- **Domain:** Payroll: employees, salary structures, runs
- **Location:** `backend/payroll/views.py:54-74 (no LocationFilterMixin; process reads location_id only from request.data); frontend processPayroll(period) sends no location`
- **Scenario:** Multi-location setup. From Store A click Process Payroll for 2026-06, then view the runs list. The FE sends location_id undefined and the process view reads location_id only from request.data, never request.active_location_id.
- **Impact:** With location_id falsy, process_payroll filters Employee.objects.filter(is_active=True) across ALL locations and posts each run to emp.location_id — so one click in Store A creates payroll plus posted journal entries for every store (wrong/duplicate financial entries). PayrollRunViewSet.get_queryset filters only by period, so every store sees all stores' runs and FE totals sum across locations. Contradicts CLAUDE.md and diverges from bills/expenses which correctly use LocationFilterMixin.
- **Fix:** Make PayrollRunViewSet use LocationFilterMixin (or filter get_queryset by request.active_location_id); default process_payroll's location_id to request.active_location_id; have the FE pass the active location. Gate all-location processing behind admin.

### H16. Closing a second fiscal year silently unlocks the previously-closed year

- **Domain:** Journal lifecycle: post / reverse / recurring / closing
- **Location:** `backend/core/year_end.py:151-152 and core/period_lock.py:89-96 (last_closed_fy is a single CharField)`
- **Scenario:** Close FY 2024-25 (last_closed_fy='2024-25'), then later close FY 2025-26. close_fiscal_year overwrites last_closed_fy to '2025-26'. assert_unlocked only checks that single field.
- **Impact:** _date_in_fy(d, '2025-26') now returns False for any 2024-25 date, so the lock on 2024-25 is silently erased — you can post/edit/reverse journal entries into the already-closed FY 2024-25, and even re-run close_fiscal_year(2024) (the duplicate guard no longer matches). No LockedPeriod rows are auto-created at close, so the month-lock layer does not compensate. Real data-corruption exposure across all guarded mutation paths.
- **Fix:** Track closed years as a set (ClosedFiscalYear table or JSON list) and have assert_unlocked reject a date in ANY closed FY; or create LockedPeriod rows for every month of the FY at close time.

### H17. Recurring profile with a non-unique bill_no_pattern crashes generation with IntegrityError (500) and aborts the run-due batch

- **Domain:** Vendor bills + recurring bills
- **Location:** `backend/bills/services.py:223,229 (Bill.objects.create); generate_due :283-294 catches only ValidationError; run-due view views.py:438-447 has no try/except`
- **Scenario:** Create a recurring bill profile with vendor set and a constant/non-cycling bill_no_pattern (e.g. 'RENT', or monthly profile with '{YYYY}'). Let it generate twice. The second rendered bill_no collides on the partial unique constraint (vendor_id, bill_no).
- **Impact:** Bill.objects.create bypasses full_clean(), so the constraint surfaces as django.db.IntegrityError, NOT ValidationError. generate_due catches only ValidationError and the run-due/generate_now views don't catch IntegrityError, so it propagates as HTTP 500. In run-due this aborts the batch mid-loop after some profiles already committed (reproduced live: 6 unrelated bills committed before the crash), leaving an inconsistent partial run; the failing profile's last_error/next_run_date are never updated so the daily cron re-crashes every run.
- **Fix:** Catch IntegrityError in generate_one/generate_due and convert to a recorded last_error + pause (like the ValidationError path), and/or auto-append {SEQ} or enforce uniqueness when the rendered bill_no would collide for that vendor.

### H18. emi_day=0 (and any value outside 1-28) crashes generate_schedule with 'day is out of range'

- **Domain:** Loans (amortization) & budgets
- **Location:** `backend/loans/services.py:58-59 (date_cls(...,min(emi_day, last_day))); FE input LoansPage.tsx:125-126 (no min/max)`
- **Scenario:** In New Loan, type 0 into the 'EMI day (1-28)' field (or 29/30/31 with a short-month start). PositiveSmallIntegerField allows 0..32767, the serializer has no validate_emi_day, and the FE input has no min/max.
- **Impact:** min(0, last_day)=0 so date_cls(year, month, 0) raises ValueError 'day is out of range for month' inside generate_schedule (no try/except) -> unhandled 500. emi_day 29-31 with a Feb/30-day start silently shifts the due day via min(), corrupting booked schedule dates (verified: emi_day=31 Feb-start -> first due 2026-02-28). Currently masked by the loan-create 500 but surfaces independently once that is fixed.
- **Fix:** Add MinValueValidator(1)/MaxValueValidator(28) to Loan.emi_day, a serializer validate_emi_day, and min=1 max=28 on the FE input; guard generate_schedule against day<1.

### H19. No account-type validation on loan liability / interest-expense GL mapping

- **Domain:** Loans (amortization) & budgets
- **Location:** `backend/loans/serializers.py:22-49 (no validate); consumed at services.py:102 (Cr liability_account) and 137-138 (Dr interest_expense_account)`
- **Scenario:** The New Loan dialog asks the user to type raw numeric GL account IDs into free-text inputs. A user transposes the two IDs, or points liability at a revenue/expense leaf and interest at an asset/liability leaf. Any leaf ChartOfAccount id is accepted.
- **Impact:** Only the leaf-only check applies; account_type is never validated. Disbursement then credits a non-liability account and every EMI debits a non-expense account, producing structurally wrong but balanced books (loan principal in a revenue account, interest hitting an asset) for the life of the loan — every disbursement JV and every EMI JV is corrupted.
- **Fix:** In LoanSerializer.validate assert liability_account.account_type == 'LIABILITY' and interest_expense_account.account_type == 'EXPENSE' (and both is_leaf). Replace the free-text ID inputs with type-filtered account pickers.

### H20. financial_year_start has no 1-12 range validation -> invalid month crashes Dashboard (500) and FY logic

- **Domain:** Core: Chart of Accounts, period lock, settings, audit log, dashboard
- **Location:** `backend/core/serializers.py:36-46 (no validate_financial_year_start); crash at core/views.py:306 date(fy_start_year, fy_start_month, 1)`
- **Scenario:** Settings -> Company Info. The 'Financial Year Start' field is a free-text Input labelled 'MM-DD' but the backend is an IntegerField (month). Type '13' (or '0') and Save (DRF coerces to int with no range check). Open the Dashboard.
- **Impact:** PATCH stores month=13/0. _get_fy_dates() calls date(year, 13, 1) -> ValueError 'month must be in 1..12' -> unhandled 500 on GET /api/accounts/dashboard/, and breaks fy_window/period-lock FY math (core/period_lock.py:61, core/year_end.py:19). The Dashboard becomes inaccessible until the value is fixed directly in the DB.
- **Fix:** Add validate_financial_year_start enforcing 1<=value<=12 (or MinValueValidator/MaxValueValidator on the model field). Fix the SettingsPage field to a month select and drop the misleading 'MM-DD' placeholder.

### H21. Account type can be changed on a non-system account that already has postings, silently re-classing historical entries

- **Domain:** Core: Chart of Accounts, period lock, settings, audit log, dashboard
- **Location:** `backend/core/views.py:108-133 (perform_update only blocks type/code change for AccountMapping-bound accounts); no ChartOfAccount.clean()`
- **Scenario:** Edit a leaf account NOT bound to an AccountMapping (e.g. custom '5470 Sundry Expense' with dozens of posted lines) and change Account Type from Expense to Asset, then Save. The edit Sheet exposes the type select with no restriction.
- **Impact:** perform_update guards type/code only for is_system (mapping-bound) accounts. A non-system account with movements can be re-typed freely. All its existing posted lines instantly move between P&L and Balance Sheet (EXPENSE->ASSET), corrupting prior-period P&L, Trial Balance comparatives, and retained earnings already computed at year-end close (reports and year_end classify live by current account_type). Only a generic UPDATE audit log is kept. The codebase already detects movements for delete (perform_destroy) but not for type change.
- **Fix:** In perform_update, if account_type changes and instance.journal_lines.exists(), raise ValidationError('Cannot change account type on an account with journal entries.'), regardless of system-mapping status.

### H22. Account mappings accept a non-leaf account, breaking every auto-generated posting for that key

- **Domain:** Core: Chart of Accounts, period lock, settings, audit log, dashboard
- **Location:** `backend/core/serializers.py:90-98 (no is_leaf/type validation); SettingsPage.tsx:439-442 (dropdown not filtered by is_leaf); fails later at journals/models.py:263`
- **Scenario:** Settings -> Account Mappings. For a key not in KEY_TO_SUBTYPE (SALARY_EXPENSE, COGS, BANK_CHARGES, etc.) the dropdown shows the full account list including non-leaf group accounts (e.g. '5700 Indirect Expenses'). Save the mapping, then post a payroll/bill/COGS-sync voucher routing through that key.
- **Impact:** The mapping is stored with no leaf/active validation. When the service later posts to it, JournalEntryLine.save() raises ValidationError('Cannot post to non-leaf account ...'), aborting the whole auto-generation inside @transaction.atomic — bricking an entire posting category (payroll, COGS-sync, bills, year-end) until corrected; sync paths can surface as 500. The same gap also allows mapping to an inactive account.
- **Fix:** Add validate_account to AccountMappingSerializer rejecting accounts where not is_leaf or not is_active. In SettingsPage, filter the dropdown to leaves and optionally by expected account_type/subtype.

### H23. Products with only opening stock (or zero purchase history) sell without relieving inventory — Closing Stock permanently overstated, COGS understated

- **Domain:** Inventory sync integration + multi-location scoping
- **Location:** `backend/journals/services.py:111-129 (_post_cogs); cost source services.py:92 queries only PurchaseOrderLineRO, never OpeningStockLineRO`
- **Scenario:** Seed a product via inventory Opening Stock (debits 1190 Closing Stock). The product is never purchased again through a PurchaseOrder. Sell it via POS/B2B and Run Sync.
- **Impact:** _product_avg_cost returns cost=0 for an opening-stock-only product, so value = qty*0 = 0, the `if value <= 0: continue` skips it, and NO COGS / NO stock-relief line is written. The full opening-stock value sits in 1190 forever even after the goods are sold; COGS and gross margin are understated; year-end carries the overstated asset forward. Common path (pharmacies seed inventory then sell before the next PO). The same-author fix exists in the reporting layer (StockValuationView) but was never ported to the posting path.
- **Fix:** Fold OpeningStockLineRO into the weighted-average cost source (same fix as the COGS-averaging issue), and treat a 0 cost as 'unknown' worth logging rather than silently skipping the stock relief.

### H24. Cancelled or edited inventory orders are never reversed/voided after they have synced — books permanently diverge from inventory

- **Domain:** Inventory sync integration + multi-location scoping
- **Location:** `backend/sync/services.py:35-45 (_synced_ids) and each sync_* method; no reverse/void path anywhere`
- **Scenario:** Run Sync for a confirmed PO/POS/B2B order (a JE posts). In inventory the order is then cancelled (state->cancelled) or edited (qty/rate/discount changed). Run Sync again.
- **Impact:** _synced_ids() adds the order's reference_id to already_synced as long as ANY JournalEntry exists for it, so the order is excluded from re-processing forever. The state filter only gates first-time posting; a later cancel/edit is invisible and there is no detection or reversal. The posted sale/purchase (plus GST + COGS) stays on the books although the source document no longer exists or has changed. Only a full destructive 'Reset all data' resync repairs it. GST and P&L/BS figures are overstated/wrong with no automatic correction.
- **Fix:** On each run, also scan already-synced reference_ids whose source state is now cancelled and auto-reverse the matching JE (reference_type/reference_id + reversal_of), and detect edited orders (amount/updated_at change) to reverse-and-repost. At minimum surface a 'drifted/cancelled after sync' report.

### H25. No DB uniqueness / advisory lock on (reference_type, reference_id) — UI sync overlapping a cron sync double-posts every order in the window

- **Domain:** Inventory sync integration + multi-location scoping
- **Location:** `backend/journals/services.py:72-76 (_entry_exists read-then-create, no select_for_update) and models.py:90-94 ((reference_type,reference_id) is a plain Index); SyncRunView takes no lock`
- **Scenario:** The */5 cron scheduled_sync is mid-run when a user clicks 'Run Sync' (POST /api/sync/run/). Both call sync_all() against the same shared DB. Idempotency relies solely on _entry_exists() (a SELECT) followed by an unguarded create.
- **Impact:** Under READ COMMITTED, two overlapping runs both see _entry_exists()==False for the same PO/POS/B2B order and each creates a full JE. The scheduled_sync flock only blocks a second CLI invocation, not the view. There is no unique constraint on (reference_type, reference_id) (entry_no uniqueness doesn't de-dup because numbers are computed per-transaction). Result: doubled sales, doubled output GST liability, doubled purchases/ITC and doubled COGS for every order in the overlap window.
- **Fix:** Add a UniqueConstraint on JournalEntry(reference_type, reference_id) for auto-gen reference types (partial/conditional to allow Manual), so the second insert fails cleanly; and/or wrap sync_all() in a Postgres advisory lock shared by both the view and the management command.

### H26. POS sale to a GST-registered customer is misreported as B2C instead of B2B in GSTR-1

- **Domain:** GST returns: GSTR-1, GSTR-2B, GSTR-3B, ITC reconciliation, HSN
- **Location:** `backend/gst_returns/services.py:127-131 (POS inv_type only B2C_LARGE/B2C_SMALL, never B2B)`
- **Scenario:** A POS sale where the customer is GST-registered and their GSTIN is captured on the POS order (a hospital/clinic buying over the counter). GSTR1Generator resolves customer_gstin but the POS inv_type branch only ever yields B2C_LARGE/B2C_SMALL.
- **Impact:** The entry is stored as B2C_SMALL/B2C_LARGE with a non-empty customer_gstin. In export_json a B2C entry never lands in the 'b2b' section, so the recipient's GSTR-2B is never auto-populated and they cannot claim ITC; GSTR-9 Table 4 also classifies it as B2C. A filing error on every POS sale to a registered buyer. (The company's own 3.1(a) output liability is not understated; harm is recipient-side ITC loss + GSTR-1/9 misclassification.)
- **Fix:** Mirror the B2B-order logic in the POS branch: 'if customer_gstin: inv_type = "B2B"' first, then fall back to B2C_LARGE / B2C_SMALL, setting place_of_supply and B2B grouping accordingly.

### H27. GSTR-1 supply-type uses customer state-name fallback while the journal posting uses GSTIN only — GSTR-3B output tax head diverges from the GL

- **Domain:** GST returns: GSTR-1, GSTR-2B, GSTR-3B, ITC reconciliation, HSN
- **Location:** `backend/gst_returns/services.py:82-85 (uses state_name_to_code(customer.state)) vs journals/services.py:78-84 & 302-309 (generate_pos_sale/_get_supply_type use GSTIN only)`
- **Scenario:** A POS/B2B sale to a customer with a blank GSTIN but a state different from the company's home state (e.g. company Kerala 32, customer 'Karnataka' no GSTIN).
- **Impact:** GSTR1Generator classifies it inter-state (IGST) from customer.state, but the journal derives supply_type from gst_no only -> defaults intra-state and posts CGST+SGST to the GL. GSTR-3B 3.1(a) sources outward tax from GSTR1Entry, so the return shows output IGST while the GL Output-GST accounts hold CGST+SGST — the filed return and the books disagree on the tax head (mix-only; total tax unchanged). Affects the no-GSTIN-but-state-set subset of sales, with no reconciliation check on the outward side.
- **Fix:** Make journals/services._get_supply_type accept and use a counterparty_state_code (state_name_to_code(customer.state)) exactly like GSTR1Generator, applied to generate_pos_sale, generate_b2b_sale, and generate_sales_return.

### H28. Ledger drill-down always shows Opening Balance = 0; running/closing balances ignore brought-forward balances

- **Domain:** Reports: TB, P&L, BS, ledger, aging, party outstanding
- **Location:** `backend/reports/views.py:329-340 (LedgerView opening_balance only when page is set); frontend LedgerPage.tsx:35-39 calls getLedger without page`
- **Scenario:** Open any account ledger via Chart of Accounts -> Ledger drill-down. The page calls getLedger with NO page param and the default range starts at FY start (April 1). For any account with postings before April 1 (prior-year balance, opening JV, earlier activity), LedgerView runs the non-paginated branch.
- **Impact:** opening_balance is computed from pre-start_date lines only when `if page and start_date`; with no page the else branch forces opening_balance = 0 while lines_qs is still filtered to date >= start_date. So Opening = Rs0.00 always, every running balance is understated by the true brought-forward net, and the closing balance is wrong. The on-screen ledger disagrees with the CSV/XLSX/PDF export (LedgerExportView), which applies the opening balance correctly. In any going-concern deployment with prior-year balances this is the common case.
- **Fix:** Change the guard at views.py:329 from `if page and start_date:` to `if start_date:`, so both branches share the same opening-balance logic, matching LedgerExportView.

### H29. Aging buckets use gross invoice amount and are not reduced by partial payments, so they overstate overdue and don't sum to Outstanding

- **Domain:** Reports: TB, P&L, BS, ledger, aging, party outstanding
- **Location:** `backend/reports/views.py:1108-1127 (PartyOutstandingView); same pattern in ReceivablesAgingView 571-598 and PayablesAgingView 759-786`
- **Scenario:** Customer C: one SALE invoice Rs10,000 dated 100 days before the as-of date, then a RECEIPT of Rs6,000. Open Party Outstanding. The Rs10,000 debit adds the FULL 10,000 into the 90+ bucket; the Rs6,000 credit only increments 'payments'/'closing' and never reduces any bucket.
- **Impact:** The row shows Outstanding = Rs4,000 but aging_90_plus = Rs10,000; the four buckets sum to 10,000 — Rs6,000 more than the actual outstanding, the amount already settled. The frontend renders Outstanding and the four buckets side by side, so overdue visibly overstates the receivable. Same flaw in ReceivablesAgingView/PayablesAgingView (total_outstanding net, buckets gross). The correctly-netted BillReference path exists but only in _open_party_invoices, not these views.
- **Fix:** Net payments against invoices before bucketing (FIFO oldest-first across the party's debit invoices) and bucket only the remaining open amount per invoice; reuse the bill-wise allocation logic from _open_party_invoices.

### H30. Party selected on Credit/Debit Note is never attached to the line; posting to the generic Trade control yields an unfixable 400

- **Domain:** Contra / Journal / Credit Note / Debit Note vouchers
- **Location:** `frontend/src/pages/vouchers/VoucherEditor.tsx:180-201 (payload omits party_type/party_id) vs backend/journals/serializers.py:258-265 (Trade-control lines require a party)`
- **Scenario:** Open Credit Note for a walk-in/retail customer (no per-party ledger provisioned — common in pharmacy). Pick the customer in the header, set Dr Sales / Cr Trade Receivables (1130), Save. payload() emits lines with only {account, debit, credit, narration}; partyId is used only for narration. 1130 is a leaf in control_ids with no party tag, so the serializer raises a per-line 400.
- **Impact:** The note cannot be saved when the generic Trade Receivables/Payables control is selected, and the editor offers no per-line party field to satisfy the requirement. For walk-in/retail customers 1130/2110 is the only matching leaf (no per-party ledger exists), so the save is permanently rejected. Reproduced live: serializer returns is_valid=False with the per-line message. Same on Debit Note -> 2110.
- **Fix:** In payload(), when config.partyType is set and a line's account is Receivable/Payable, attach party_type=config.partyType and party_id=partyId (so _route_party_line redirects to the party ledger); require partyId in validate() for CREDIT_NOTE/DEBIT_NOTE; or hide the bare Trade control in the picker for these voucher types.

### H31. Failed AGAINST allocation is swallowed but the over-amount payment is still posted

- **Domain:** Payment / Receipt vouchers + bill-wise allocation
- **Location:** `frontend/src/pages/vouchers/SimplePaymentVoucher.tsx:447-465 (empty catch on createBillReference, then postEntry runs regardless)`
- **Scenario:** Open 'Settle invoices', allocate 600 against PI-1 (its outstanding). In the row table edit that line's Amount to 5000 (the grid cap no longer applies once the value is in the row). Save & Post.
- **Impact:** buildPayload posts a 5000 debit to the supplier ledger. createBillReference(5000) hits the over-allocation guard and returns 400, but the empty catch swallows it with no toast and execution falls through to postEntry — the entry posts and shows success. Result: a 5000 payment posted with NO bill-wise link; PI-1 still reads fully outstanding and the supplier ledger is overpaid by 4400, with zero warning. The over-allocation guard exists but gates only the BillReference row, not the JournalEntry, and there is no @transaction.atomic tying the three HTTP calls together.
- **Fix:** Collect ref failures; if any fail, surface a clear error and do NOT auto-post (keep as draft), or reverse the just-created entry. At minimum show a toast naming the invoice whose allocation was rejected.

### H32. Voucher AGAINST a bills-app Bill has no over-allocation cap and never marks the bill paid

- **Domain:** Payment / Receipt vouchers + bill-wise allocation
- **Location:** `backend/journals/serializers.py:82-90 (guard matches entry__entry_no=ref_no, no-op for a Bill.bill_no) + bills/services.py:165-167 (only record_payment updates amount_paid)`
- **Scenario:** Create and approve a Bill (BILL-009, total 1000). In a Payment voucher pick the supplier ledger, 'Against Bill' -> BILL-009 (sets bill_id + ref_no=BILL-009). Enter 1000 or 9000, Save & Post. Repeat.
- **Impact:** The BillReference carries ref_no=BILL-009 (a bill_no, not a JE entry_no), so the guard's filter(entry__entry_no=ref_no) finds nothing -> invoice is None -> guard returns early (no cap at all); bill_id is never consulted. Nothing reconciles the BillReference back to Bill.amount_paid/recalc_status, so the Bill stays status='open' forever, reappears in every future picker, and can be 'paid' an unlimited number of times — overpaying the supplier with no guard.
- **Fix:** When a BillReference has a non-null bill_id, validate against Bill.balance_due and update Bill.amount_paid/recalc_status on create and on reverse; or route bill-linked settlements through bills.services.record_payment.

### H33. Bill references silently destroyed when a draft voucher is edited and re-saved

- **Domain:** Payment / Receipt vouchers + bill-wise allocation
- **Location:** `frontend/src/pages/vouchers/SimplePaymentVoucher.tsx:272-275 (hydrateFromEntry sets ref:null) + backend/journals/serializers.py:297-301 (update deletes all lines, CASCADE-deletes BillReferences)`
- **Scenario:** Create a Payment voucher, 'Settle invoices' across 3 purchase invoices (3 AGAINST BillReferences), Save as Draft. Re-open the draft, change nothing or just the narration, Save again.
- **Impact:** hydrateFromEntry loads every row with ref:null (refs are never re-fetched — listBillReferences is never called). On re-save, serializer.update deletes ALL old lines, CASCADE-deleting their BillReferences; the FE re-attaches refs only where r.ref is set, but all are null. Every bill-wise allocation on the draft is silently wiped. NOTE: the per-party NET-outstanding gate hides fully-settled invoices, so the over-reporting/re-settlement only materializes for PARTIAL-settlement drafts that are subsequently edited (which is why adjusted severity is medium); the party's net balance is never corrupted.
- **Fix:** In hydrateFromEntry, when editing, fetch the lines' existing BillReferences and rehydrate each row's ref so the save loop re-creates them; or have the backend preserve/recreate BillReferences across an update instead of CASCADE-dropping them.


---

## MEDIUM (26)

### M1. SALE/PURCHASE voucher offers the generic Trade Receivables/Payables control but cannot attach the header party to the line, producing a 400 on save

- **Domain:** Sales & Purchase vouchers (manual)
- **Location:** `frontend/src/pages/vouchers/VoucherEditor.tsx:180-201 (payload omits party_type/party_id) vs backend/journals/serializers.py:258-265`
- **Scenario:** Open a Sales voucher, select a Customer in the header, on the Dr line pick the generic 'Trade Receivables' (1130) — which the SALE Dr filter offers alongside the per-party ledgers — enter amounts and Save. Same for Purchase picking 'Trade Payables' (2110).
- **Impact:** payload() builds each line as {account,debit,credit,narration}; the header partyId is used only for narration and never sent. The backend sees a bare Trade control line with no party and raises a per-line 400 surfaced as a confusing toast. The UI actively offers an unsaveable account; clean validation error with a workaround (pick the per-party ledger), so medium not high. (Same root cause as the Credit/Debit Note 400 — CDN-2.)
- **Fix:** Pass party_ledgers=exclude to hide the bare Trade control in the SALE/PURCHASE picker, OR carry the header partyId onto the AR/AP line in payload() so _route_party_line redirects it to the party ledger.

### M2. Header party and the per-party ledger picked on the line are independent — a voucher can post to the wrong party's ledger with no cross-check

- **Domain:** Sales & Purchase vouchers (manual)
- **Location:** `frontend/src/pages/vouchers/VoucherEditor.tsx:480-496 (header party only sets narration) and 181-200 (line account is the sole source of truth for AR/AP)`
- **Scenario:** Open a Sales voucher, select Customer 'Alice' in the header, on the Dr line pick a DIFFERENT customer's per-party ledger (e.g. 1125-C99 'Bob' — every customer ledger is listed because they share subtype Receivable). Balance, Save & Post.
- **Impact:** _route_party_line auto-tags the line from the account's own party_id; nothing compares the line party to the header party. The receivable posts to Bob's ledger while the narration/header say Alice — books silently reflect the wrong (but real) party with no warning. Requires operator error; books are not mathematically corrupt, only mis-attributed.
- **Fix:** When config.partyType is set and a Receivable/Payable line is present, default that line's account to the header party's ledger and/or block save when the chosen ledger's party_id differs from the header partyId.

### M3. No invoice-number capture or duplicate detection for manual SALE/PURCHASE vouchers — the same invoice can be booked twice

- **Domain:** Sales & Purchase vouchers (manual)
- **Location:** `frontend/src/pages/vouchers/VoucherEditor.tsx:479-501 (party picker replaces Reference # for partyType vouchers) and backend/journals/serializers.py:223-276 (no duplicate check)`
- **Scenario:** Book a Purchase voucher for supplier bill PI-001 (Dr stock/expense + Input GST, Cr supplier). For SALE/PURCHASE the editor renders the party picker instead of the Reference # input, so there is no field to record 'PI-001'. Repeat the exact voucher and it saves again.
- **Impact:** referenceId stays '' -> reference_id=null; no invoice number is stored and no BillReference(kind=NEW) is created. There is no unique constraint or dedup on (party, invoice_no), so duplicate purchase/sale bookings post silently, double-counting the payable/receivable and the expense/revenue. The parallel guard exists in the bills app (UniqueConstraint vendor_id+bill_no) but manual vouchers bypass it. Requires operator error; entries are draft-then-post and reversible.
- **Fix:** Add an invoice/bill-number field for SALE/PURCHASE vouchers, persist it (BillReference kind=NEW or a JE reference field), and check for an existing voucher with the same party + invoice number before saving.

### M4. Manual SALE/PURCHASE vouchers do no GST intra-/inter-state validation: Output/Input IGST can be used on an intra-state invoice (and CGST+SGST on inter-state)

- **Domain:** Sales & Purchase vouchers (manual)
- **Location:** `frontend/src/pages/vouchers/voucherConfig.ts:132-153 (filters allow any Output/Input GST) with no backend supply-type check in serializers.py:223-276`
- **Scenario:** Create a Sales voucher for a local customer; on the Cr side the picker lists Output CGST, SGST AND IGST. Add a single 'Output IGST' line instead of splitting CGST+SGST, balance, post. Mirror with Input IGST on an intra-state purchase.
- **Impact:** The manual voucher path is a generic balanced JE with no supply-type awareness; all three GST ledgers are offered on every invoice. The PURCHASE/ITC side does corrupt the filed GSTR-3B 4(A)(5) ITC (read straight from JE lines on codes 1140/1150/1160). The SALES side does NOT corrupt GSTR-1/3B (those source from inventory RO models, not manual JEs) — only the GL Output-GST ledger balances. So the impact is narrower than a full 'incorrect return' and requires a manual voucher rather than the synced flow (adjusted to low).
- **Fix:** Resolve the party's state vs company state in the editor and restrict the GST account list (CGST+SGST intra, IGST inter) or surface a blocking validation; alternatively validate GST heads against supply type server-side for SALE/PURCHASE voucher_types.

### M5. Credit/Debit Note cannot reverse GST — Output/Input GST accounts are hidden from the picker

- **Domain:** Contra / Journal / Credit Note / Debit Note vouchers
- **Location:** `frontend/src/pages/vouchers/voucherConfig.ts:166 (CREDIT_NOTE Dr filter) and 182-183 (DEBIT_NOTE Cr filter)`
- **Scenario:** Customer returns taxable goods 1000 + 18% GST. Open a manual Credit Note. The Dr filter admits only Sales/REVENUE/EXPENSE, so Output CGST/SGST/IGST (LIABILITY/Output_GST) are never listed and cannot be selected to reverse the tax. Identical problem on DEBIT_NOTE for Input GST.
- **Impact:** On manually-keyed credit/debit notes the accountant cannot reverse GST: they must omit GST reversal (Output GST liability overstated, GSTR-3B wrong / tax over-remitted) or mis-post into a wrong ledger. SALE/PURCHASE deliberately allow these subtypes, so the omission on their reversing counterparts is an oversight. Narrower than high because the dominant return path is the inventory-sync auto-generator, which reverses GST correctly and bypasses the picker — the gap bites only off-system notes (service credits, price/discount adjustments, non-inventory returns).
- **Fix:** Add Output_GST to the CREDIT_NOTE Dr filter and Input_GST to the DEBIT_NOTE Cr filter so the note can reverse GST liability/ITC proportionally.

### M6. DRF per-line 400 errors render as 'lines: [object Object]' in the toast

- **Domain:** Contra / Journal / Credit Note / Debit Note vouchers
- **Location:** `frontend/src/pages/vouchers/VoucherEditor.tsx:262-268 (handleSave catch)`
- **Scenario:** Trigger any nested line error from the serializer — party-required, non-leaf, or a line amount with >2 decimal places. The 400 body is {'lines': {0: ['msg']}} or {'lines': [{'debit': ['...']}]}. The catch does String(v) / v.join(', '), both of which yield '[object Object]' for nested line errors.
- **Impact:** The user sees 'lines: [object Object]' with no indication of which line or what is wrong, making the Credit/Debit Note 400 and the decimal-places rejection effectively undiagnosable from the UI. Broader than originally framed — both the object-shaped and array-of-objects-shaped line errors are swallowed.
- **Fix:** Recurse into nested error objects/arrays when flattening the DRF error body (handle dict/array values for 'lines' by joining their inner messages, including the line index).

### M7. Line amount with >2 decimal places passes FE balance check but is rejected 400 by the backend

- **Domain:** Contra / Journal / Credit Note / Debit Note vouchers
- **Location:** `frontend/src/pages/vouchers/VoucherLineRow.tsx:74-82 (amount input) + VoucherEditor.tsx:161 (isBalanced float tolerance 0.005) vs DRF DecimalField(decimal_places=2)`
- **Scenario:** On a Journal/Credit Note, split 100.00 across 3 lines typing 33.333 each. The number input does not block a 3rd decimal; FE totals 99.999 vs 100.00, |diff|=0.001 < 0.005 so isBalanced is true and Save & Post is enabled. On POST, DRF DecimalField rejects each 3-decimal amount.
- **Impact:** Save fails with a per-line 400 that (per the toast-rendering bug) shows as 'lines: [object Object]' — an opaque rejection on an entry the UI showed as balanced and postable. Clean 400, nothing persisted; the sibling SimplePaymentVoucher applies .toFixed(2) but this path does not.
- **Fix:** Round/clamp line amounts to 2 decimals on input/blur and base isBalanced on quantized 2dp values; reject >2dp in the editor before POST.

### M8. Over-allocation guard and grid cap both ignore unallocated (plain-debit) payments, allowing over-settlement

- **Domain:** Payment / Receipt vouchers + bill-wise allocation
- **Location:** `backend/journals/serializers.py:92-103 (original=full invoice line, prior_sum counts only AGAINST refs) + frontend InvoiceAllocationGrid.tsx:66-72 + backend/reports/views.py:693-694`
- **Scenario:** Purchase invoice PI-1 Cr Payable 1000. Make a 400 plain on-account debit (no 'Settle invoices'). Later open 'Settle invoices': the grid shows PI-1 outstanding = 1000 (it ignores the 400 plain debit). Allocate 1000 against PI-1 and post.
- **Impact:** outstanding_amount = original(1000) - AGAINST refs(0) = 1000, so the grid allows 1000; the serializer guard checks prior_sum(0)+1000 <= original(1000) and passes. Total debits to S = 400+1000 = 1400 against a 1000 invoice — overpaid by 400 with no warning. Both the grid cap and the serializer guard exclude plain unallocated payments. A party over-payment guard exists but only on the legacy generate_receipt path, not this flow.
- **Fix:** Compute remaining balance from the party-net (credits - all debits incl. unallocated payments) rather than original - AGAINST-only; have both the grid cap and the serializer guard subtract plain settlements, or block mixing unallocated debits with AGAINST allocations for the same party.

### M9. Over-allocation guard is a check-then-act race with no row lock

- **Domain:** Payment / Receipt vouchers + bill-wise allocation
- **Location:** `backend/journals/serializers.py:82-103 (plain SELECT + Sum aggregate, no select_for_update/unique constraint; Meta has only non-unique indexes)`
- **Scenario:** Two users (or two rapid requests) each POST /journals/bill-references/ to settle the same invoice PI-1 (outstanding 1000), each for 1000, at the same moment.
- **Impact:** Each request reads prior_sum=0 independently before the other commits (READ COMMITTED), both pass prior_sum+1000 <= 1000, both insert — the invoice ends allocated 2000 against a 1000 balance. No select_for_update, no DB uniqueness/total constraint, no ATOMIC_REQUESTS. Uncommon timing window; recoverable by reversing one allocation.
- **Fix:** Wrap validate+create in a transaction that select_for_update()-locks the invoice JE line (or a per-(party,ref_no) lock row), or enforce the cap with a DB constraint/trigger.

### M10. Year-end close returns HTTP 500 when the closing month is period-locked

- **Domain:** Journal lifecycle: post / reverse / recurring / closing
- **Location:** `backend/core/views.py:519-526 (except ValueError only) with journals/models.py:100-102 / core/period_lock.py:73-105`
- **Scenario:** Lock the closing month first (GSTR-3B filed -> LockedPeriod '2026-03'), then POST /api/core/fy-close/ {fy_start_year:2025}. close_fiscal_year creates the close JV dated 2026-03-31; assert_unlocked raises PeriodLockedError.
- **Impact:** PeriodLockedError subclasses django ValidationError, not ValueError. CloseFiscalYearView.post catches only ValueError, so it propagates as an unhandled 500 (live-reproduced). Same uncaught path in the close_fy management command. Gated on the closing month being explicitly locked; the atomic wrapper rolls back the partial close JV so no corruption — crash/UX only.
- **Fix:** Catch PeriodLockedError/ValidationError in CloseFiscalYearView and return 400; decide whether the close/opening JVs should set _skip_period_lock for the fy_end date they legitimately must write to.

### M11. B2C-Large threshold hardcoded at Rs2.5L; legal threshold is Rs1L for invoices on/after 01-Aug-2024

- **Domain:** GST returns: GSTR-1, GSTR-2B, GSTR-3B, ITC reconciliation, HSN
- **Location:** `backend/gst_returns/services.py:129 (POS) and 212 (B2B) — pos/order.total_amount > Decimal('250000')`
- **Scenario:** An inter-state B2C sale with invoice value between Rs1L and Rs2.5L dated in/after Aug 2024 (system date 2026), e.g. an inter-state OTC sale of Rs1.5L to an unregistered customer.
- **Impact:** Per Notification 12/2024-CT (w.e.f. 01-Aug-2024) the inter-state B2CL invoice-wise reporting threshold dropped to Rs1L. The hardcoded Rs2.5L (with stale comments citing the superseded rule) classifies a Rs1.5L inter-state B2C invoice as B2C_SMALL, rolling it into the rate-wise aggregate instead of the invoice-wise B2CL table — under-reporting B2CL detail. Reporting-granularity error only; tax totals/net liability are unaffected. Narrow slice (inter-state + unregistered + Rs1L-2.5L band).
- **Fix:** Make the B2CL threshold date-aware (Rs1,00,000 for invoice_date >= 2024-08-01, else Rs2,50,000) or pull it from AccountingSettings, and apply the same threshold in both the POS and B2B branches.

### M12. Time-barred credit note is dropped from GSTR-3B output but its journal reversal already reduced GL Output GST

- **Domain:** GST returns: GSTR-1, GSTR-2B, GSTR-3B, ITC reconciliation, HSN
- **Location:** `backend/gst_returns/services.py:503 (3B excludes is_time_barred=True) vs journals/services.py:516-523 (sales-return JE always reverses Output GST regardless of the s.34 deadline)`
- **Scenario:** A sales return / credit note whose s.34(2) deadline (30-Nov of the following FY) has passed — e.g. an FY2024-25 invoice returned Jan 2026. The credit-note JE is still posted and reverses Output GST; GSTR1Generator flags is_time_barred=True.
- **Impact:** GSTR-3B correctly excludes the time-barred CN, but the JE already debited Output CGST/SGST/IGST, lowering the GL liability. So the filed 3B output tax is higher than the GL Output-GST control balance (e.g. Rs1,800 on a Rs10,000+18% CN) with no documented reconciling item — the books no longer tie to the filed 3B, breaking the documented TB-equals-return invariant. Narrow edge (CN posted after the 30-Nov deadline) and per-paisa bounded by the CN's tax.
- **Fix:** Either suppress the Output-GST reversal in the credit-note JE when the CN is time-barred (reverse only sales/receivable, not the tax), or emit a compensating JE / clearly flag the variance so the GL Output-GST liability matches the GSTR-3B figure.

### M13. total_amount is trusted from the client and any mismatch vs items+tax is silently dumped into Round Off (6100) with no cap

- **Domain:** Direct expense vouchers
- **Location:** `backend/expenses/services.py:64-83 (credit uses expense.total_amount; round-off absorbs diff with no bound); serializer has no cross-field check at serializers.py:99-108`
- **Scenario:** POST /api/expenses/ with items summing to 1000, tax 0, but total_amount=5000. The serializer only checks total_amount>0 and each item>0, so it passes. Record.
- **Impact:** The service credits the bank with the full 5000 and posts the entire 4000 difference as a debit to ROUND_OFF (6100). The JE balances and posts, so 4000 of real spend is misclassified as 'Round Off' and the bank is credited an amount unrelated to the line items — silent books corruption with no upper bound. The codebase's own journals generators bound round-off to <Rs1.00 but the expenses service omits the bound. FE always sends total=subtotal+tax, so reachable via deviant/alternate client or direct API.
- **Fix:** In ExpenseWriteSerializer.validate compute expected_total = sum(items) + tax and reject if abs(total_amount - expected_total) > Decimal('0.05'); keep the round-off branch only for the residual <= tolerance.

### M14. GST input credit is debited with no supplier GSTIN and no blocked-credit (17(5)) check — silently overstates ITC

- **Domain:** Direct expense vouchers
- **Location:** `backend/expenses/services.py:56-61 (unconditional INPUT_CGST/SGST/IGST debits); no GSTIN/eligibility field in models.py/serializers.py`
- **Scenario:** Record an expense against a blocked-credit category (Staff Welfare 5404, motor-vehicle, club) or a free-text vendor with no GSTIN, while typing CGST/SGST/IGST amounts.
- **Impact:** The service unconditionally debits Input CGST/SGST/IGST whenever tax > 0, regardless of vendor registration (vendor can be pure free text) or expense category. Since GSTR-3B 4(A)(5) ITC is sourced directly from JE debits on 1140/1150/1160, this silently books recoverable ITC for ineligible/blocked expenses, overstating the claimed credit (interest u/s 50 / penalty exposure). Input-dependent (user must enter tax), so not auto-corruption.
- **Fix:** Add an 'ITC eligible' boolean (default off for known blocked categories) and require a supplier with a GSTIN before debiting Input GST; when ineligible, add the tax to the expense cost or a dedicated ineligible-ITC ledger instead of 1140/1150/1160.

### M15. Petty-cash replenishment accepts zero or negative amount and posts a malformed/negative-line CONTRA journal entry

- **Domain:** Banking: accounts, reconciliation, cheques, petty cash
- **Location:** `backend/banking/services.py:450-475 (replenish_petty_cash — no amount guard) vs services.py:427-429 (post_petty_cash_spend has the guard)`
- **Scenario:** On PettyCashPage the Replenish dialog has no client-side amount validation and the view defaults amount to '0'. Submit Replenish with amount 0, or type a negative value like -2000.
- **Impact:** amount=0 posts a zero-value CONTRA JE (Dr 0 / Cr 0) consuming a JV number; amount=-2000 posts a balanced-but-negative entry (the non-negative line guard is dead because save() never calls full_clean()) that drives petty cash to -2000 and the bank +2000 — the inverse of a replenishment, silently corrupting both GLs. (Listed at high in the source; grouped with the cross-cutting full_clean() root cause. The blank-amount sub-claim is actually a 500, not a zero JE.)
- **Fix:** At the top of replenish_petty_cash add: amount = Decimal(str(amount)); if amount <= 0: raise ValidationError('Amount must be positive.') — identical to post_petty_cash_spend.

### M16. A matched (reconciled) bank transaction's amount/date/account can be edited via the API, silently breaking the reconciliation invariant

- **Domain:** Banking: accounts, reconciliation, cheques, petty cash
- **Location:** `backend/banking/serializers.py:60-64 (read_only_fields keeps amount/date/bank_account writable) + views.py:79-84 (perform_destroy guards matched, but no perform_update guard)`
- **Scenario:** A statement line is matched to JE X (its amount equals a bank line on X). PATCH /api/banking/transactions/<id>/ with amount changed (-5000 -> -7000) or date changed. status and matched_journal_entry are read-only so the row stays 'matched', but its amount no longer equals any line on X.
- **Impact:** The transaction remains status='matched' linked to X while its amount/date contradict the JE. statement_balance shifts so the Books-vs-Statement difference moves, yet the row still presents as reconciled — the BE accepts a state the matching logic explicitly forbids at creation. perform_destroy and set_excluded guard matched rows, proving the team knows they need protection, but the update path does not. FE doesn't expose this edit today, so API-reachable only.
- **Fix:** Add a perform_update/validate guard: if instance.status == 'matched' raise ValidationError('Unmatch before editing this transaction.'); or make amount/date/bank_account read-only once matched.

### M17. Books-vs-Statement difference is permanently overstated by the opening balance — statement_balance adds opening_balance but book_balance does not

- **Domain:** Banking: accounts, reconciliation, cheques, petty cash
- **Location:** `backend/banking/services.py:488-501 (book_balance ignores opening_balance; statement_balance adds it); surfaced in BankingPage.tsx:112-121 and BankAccountPage.tsx:125-133`
- **Scenario:** Create a bank account with a non-zero opening_balance (the field is offered; users routinely enter the real bank balance) without posting an opening-balance JV to the backing GL (no flow does so). Import a statement and reconcile every line perfectly.
- **Impact:** book_balance is derived purely from posted JE lines and never adds opening_balance, while statement_balance = opening_balance + sum(imported amounts). On a fully reconciled account the Difference equals opening_balance and is painted amber/red as an unexplained discrepancy — misleading the user into thinking reconciliation is broken (or masking a real small difference inside a large constant offset). Wrong KPI/display; underlying GL/GST/TDS data unaffected.
- **Fix:** Make the two balances symmetric: either auto-post an opening-balance JV to the backing GL on account creation (and drop opening_balance from statement_balance), or have book_balance add opening_balance too. Pick one source of truth.

### M18. Server-side statement-of-account CSV export emits a blank Running Balance for every row (key name mismatch)

- **Domain:** Parties & per-party ledgers
- **Location:** `backend/parties/views.py:196 (row.get('running_balance', '')) vs services.py:141 (the service emits the key 'balance')`
- **Scenario:** Hit GET /api/parties/suppliers/<pk>/statement.csv. The CSV header declares 'Running Balance' and reads row.get('running_balance', ''), but statement_of_account builds each row with the key 'balance'.
- **Impact:** Every data row's Running Balance cell is empty (only the trailing Closing line shows a figure) — a statement of account with no per-line running balance. Read-only export, no crash, no data corruption; Opening/Closing and all other columns are correct. Not reached by the current SPA (which builds CSV client-side with r.balance), so latent in a live, reachable endpoint — adjusted to low.
- **Fix:** Change views.py:196 to row.get('balance', '') (matching services.py:141), or rename the service key to 'running_balance' consistently; add a test that the CSV's balance column equals the row balance.

### M19. No proration/LOP for mid-month join or leaving — full month's salary paid for partial month

- **Domain:** Payroll: employees, salary structures, runs
- **Location:** `backend/payroll/services.py:21-52 (calculate_salary uses full gross; join/leave dates never consulted) and :57 (filter only is_active=True)`
- **Scenario:** Add an employee with date_of_joining 2026-06-28 and a structure effective the same day; process 2026-06. Or set date_of_leaving 2026-06-03 but leave is_active=True; process 2026-06.
- **Impact:** calculate_salary always uses the full monthly gross with no days-worked/LOP factor, and process_payroll filters only is_active=True (never checks join/leave dates; the effective_from<=period-28 filter even admits a 28th-of-month structure). A 28th joiner is paid the full month; a leaver still on is_active is paid the full month. Salary expense, PF/ESI and net pay are all overstated and posted to the GL. Only bites the mid-month edge; reversible.
- **Fix:** Add a days-worked/LOP input (or derive from join/leave dates within the period), prorate gross and statutory deductions, and exclude employees whose leave date precedes the period or whose join date is after the period end.

### M20. TDS on salary never computed — net pay and TDS Payable always understate by the withholding

- **Domain:** Payroll: employees, salary structures, runs
- **Location:** `backend/payroll/services.py:50 (tds: Decimal('0') hardcoded) and 73-135 (no TDS line in the journal)`
- **Scenario:** Process payroll for any employee whose projected annual salary exceeds the basic-exemption threshold (e.g. Rs80,000/month).
- **Impact:** tds is hardcoded to 0 in every run; net_salary excludes any TDS and no TDS Payable line is posted (despite the app's own design doc listing TDS_PAYABLE 'TDS on Salary' as an expected Cr line in this voucher). For above-threshold employees the company under-withholds salary TDS entirely — a section 192 compliance gap — and payslip/Form-16 data is wrong. There is no field anywhere to capture even a manual TDS amount. Books still balance (consistent 0), so no crash.
- **Fix:** Add a tds input (manual per-run override at minimum, ideally annual-projection) and post a TDS Payable credit line reducing net_salary; wire it into mark_paid/challan like the vendor-TDS app.

### M21. EMI can be paid before disbursement and without ordering, leaving the loan liability with no credit / partial state

- **Domain:** Loans (amortization) & budgets
- **Location:** `backend/loans/services.py:110-148 (pay_emi has no disbursement/ordering guard); views.py:82-98 (EMIPayView.create)`
- **Scenario:** Create a loan but do NOT Disburse. Open the schedule and Pay installment #1 (or pay #12 before #1 — the API accepts any pending EMI id in any order). pay_emi only checks emi.status != 'paid'.
- **Impact:** With no disbursement JE, the liability account is debited by the principal portion with no offsetting credit ever posted, so the loan liability goes to a debit (negative) balance on the balance sheet. The JE is internally balanced so post() doesn't catch it. Out-of-order payment also books each EMI's interest in the wrong period (interest is fixed per the original schedule). Requires skipping an obvious Disburse step; recoverable by reversing the EMI JE.
- **Fix:** In pay_emi, require loan.disbursement_journal_entry_id is set (or loan disbursed). Optionally enforce paying the lowest pending installment_no first, or recompute interest on actual outstanding for prepayments.

### M22. Over/under-budget status flag only computed for EXPENSE accounts; REVENUE and asset/liability budgets always show 'on_track'

- **Domain:** Loans (amortization) & budgets
- **Location:** `backend/budgets/services.py:73-75 (status flagged only when account_type in ('EXPENSE',))`
- **Scenario:** Create a REVENUE budget (account 4xxx) of 500000 for 2026-04; actuals come in at 450000. GET /api/budgets/variance/?period=2026-04.
- **Impact:** The variance/variance_pct numbers are correct (-50000, -10%) but the status ternary hard-gates both 'over' and 'under' on account_type=='EXPENSE', so a 50k revenue shortfall is reported 'on_track'. Same for ASSET/LIABILITY budgets. The alerting flag the UI keys off is wrong for every non-expense budget. No frontend consumer today, so latent.
- **Fix:** Compute status by account_type semantics: for REVENUE actual<budget => 'under' (unfavourable), actual>budget => 'over' (favourable); keep current for EXPENSE. Expose a 'favourable' boolean rather than overloading over/under.

### M23. Schedule II 5% residual (salvage_value_pct) is never applied — SLM/WDV over-depreciate to zero

- **Domain:** Fixed assets & depreciation
- **Location:** `backend/fixed_assets/services.py:64-99 (compute uses asset.salvage_value only) and FixedAssetsPage.tsx:184 (salvage_value defaults to '0')`
- **Scenario:** Create an AssetClass with the default salvage_value_pct = 5.00 ('typically 5% per Sch II'). Create an asset under it leaving the Salvage field at its default '0'. Run depreciation to end of life.
- **Impact:** AssetClass.salvage_value_pct is stored but read by nothing in the depreciation path (zero functional uses); depreciation uses only the per-asset salvage_value, which defaults to 0. So a 60,000 asset depreciates the full 60,000 to zero NBV — over-depreciating by the 5% residual (Rs3,000) and overstating depreciation expense / understating NBV every period. The per-asset rupee field works if manually entered, but the advertised class-level 5% default never auto-applies, making over-depreciation the silent default outcome.
- **Fix:** On asset create, if salvage_value is not supplied, derive it from asset_class.salvage_value_pct (cost x pct/100) in serializer.create or model.save; or surface and pre-fill the salvage field in the FE from the selected class's pct.

### M24. SLM depreciation has no mid-month pro-rata and no catch-up — first-month/late-start charges are wrong

- **Domain:** Fixed assets & depreciation
- **Location:** `backend/fixed_assets/services.py:64-67 (_slm_monthly) and 81-99 (compute_monthly_depreciation)`
- **Scenario:** Acquire on 2025-04-28 (cost 60,000, life 5y) and run depreciation for 2025-04. Separately: acquire 2025-04-01 but only first run depreciation in 2025-07 (forgot May/June).
- **Impact:** _slm_monthly returns a flat base/months for any month where acquisition_date <= period_end, with zero day-weighting — a last-day-of-month buy gets a full month's depreciation (violates Sch II day-based pro-rata). There is also no catch-up: compute returns only the requested month and the run skips assets without a prior-month entry, so missed months are silently lost. First-period and gap-period depreciation are materially misstated. Pro-rata nets out over life; catch-up gap triggers only on operator error.
- **Fix:** Pro-rate the acquisition month by days held (days_from_acq_to_month_end / days_in_month) and either auto-catch-up missing prior months in the run or surface them in the preview.

### M25. Gain/loss on disposal is posted into the depreciation EXPENSE account, polluting depreciation totals

- **Domain:** Fixed assets & depreciation
- **Location:** `backend/fixed_assets/services.py:198-211 (dispose_asset gain/loss leg)`
- **Scenario:** Acquire (60,000), depreciate to NBV 58,000, dispose for 60,000 (gain 2,000). The gain leg credits asset_class.dep_expense_account; a loss debits the same account.
- **Impact:** The gain/loss is posted into the same GL account that monthly depreciation debits, so a gain reduces the period's reported depreciation charge (can net negative) and a loss inflates it. Depreciation schedules, P&L line items, and any depreciation add-back in tax computation are corrupted by disposal activity. JE remains balanced; this is a P&L line misclassification, not a balance error. The code comment admits it's a pragmatic shortcut.
- **Fix:** Add AccountMapping keys for GAIN_ON_DISPOSAL (income) and LOSS_ON_DISPOSAL (expense) and route the gain_loss leg there instead of dep_expense_account.

### M26. Optional / memorandum vouchers are included in every financial statement (TB, P&L, BS, ledger, daybook, books) and the Dashboard

- **Domain:** Reports: TB, P&L, BS, ledger, aging, daybook
- **Location:** `backend/reports/views.py:55-61/132-137/231-236/320-326/905-911/827-846 and core/views.py:373-419 (filter only is_posted=True) vs core/models.py:144-150 (get_balance excludes is_optional/is_memorandum)`
- **Scenario:** Create a posted JV with is_optional=true or is_memorandum=true (both writable in the serializer, accepted by the post action) via the API. Open Trial Balance, P&L, Balance Sheet, Ledger, Daybook, or the Dashboard.
- **Impact:** Every reports query and the Dashboard aggregates filter only entry__is_posted=True and omit the optional/memorandum exclusion, so these vouchers inflate TB, P&L, BS, ledger running balances, daybook totals and all KPIs — contradicting the model contract (is_optional 'do not affect ledger balances'; is_memorandum 'tracked outside the books') and the canonical get_balance() used by year-end close. NOTE: the frontend journal editor exposes no optional/memo toggle, so this is API-only today (latent), and reports==dashboard (both share the gap), which is why adjusted severity is medium not high.
- **Fix:** Add entry__is_optional=False, entry__is_memorandum=False to every JournalEntryLine/JournalEntry aggregate in DashboardView and all reports views, ideally via a shared helper/queryset mirroring ChartOfAccount.get_balance().


---

## LOW (10)

### L1. Manual TDS deduction serializer has no validation: arbitrary/negative amounts, tds_amount unrelated to rate x gross, no PAN->20% enforcement

- **Domain:** TDS deductions & challans
- **Location:** `backend/tds/serializers.py:14-24 (plain ModelSerializer, no validate) and models.py:28-75 (no clean()/validators/constraints)`
- **Scenario:** POST /api/tds/deductions/ with gross_amount:'-50000', tds_rate:'10', tds_amount:'999999', blank PAN, deductee_type:'Company'. The viewset is a full ModelViewSet so POST/PATCH are enabled; no cross-field validation exists.
- **Impact:** A caller can persist a negative gross_amount, a tds_amount decoupled from gross x rate, or a blank PAN at the normal rate (no s.206AA 20% floor) — all of which flow into 26Q/27Q FVU files, Form 16A, and challan totals as wrong tax figures. The rate/206AA logic in TDSService._get_rate_config runs only on the auto-sync path, not the manual create. Reachable only via direct API today (the TDS page is read-only) and confined to TDS exports (manual deductions post no journal), so low.
- **Fix:** Add a serializer validate() that recomputes/cross-checks tds_amount = round(gross x resolved_rate) within tolerance, rejects negative monetary fields (or MinValueValidator on the model), validates PAN format, and applies the s.206AA 20% floor when PAN is blank via _get_rate_config.

### L2. auto_generate_challan challan_no built from non-atomic count() -> unique-constraint 500 / wrong sequence

- **Domain:** TDS deductions & challans
- **Location:** `backend/tds/services.py:185-189 (count()+1 -> challan_no) with models.py:79 challan_no unique=True`
- **Scenario:** Double-click or two concurrent POSTs to auto-generate a challan for the same period, or generate after any challan was deleted. Both read count = TDSChallan.objects.count()+1 -> same N -> same challan_no='CHL-<period>-000N'.
- **Impact:** Concurrent same-period generation (or a post-deletion count collision) produces duplicate challan_no; the second insert hits the unique constraint and returns a transient HTTP 500 (UI shows generic 'generation failed'). No data corruption — the constraint prevents the duplicate from persisting; the user must retry. (Different periods don't collide because {period} is embedded.)
- **Fix:** Compute the suffix from a period-scoped count or max-suffix parse inside transaction.atomic() with select_for_update, or use a DB sequence; handle IntegrityError with a retry.

### L3. Bill total is never reconciled against lines + tax; the difference is silently posted to ROUND_OFF, inflating/deflating Trade Payables

- **Domain:** Vendor bills + recurring bills
- **Location:** `backend/bills/services.py:47-52 (expected computed but never asserted) and 87/93-108 (Payables credited full total_amount; diff to ROUND_OFF); no check in serializers.py:121-130`
- **Scenario:** POST/PUT to the bills API with total_amount != sum(lines)+tax (e.g. lines=10000, tax=0, total_amount=11000). The serializer only checks total_amount>0 and each line>0, so on Approve post_bill credits Trade Payables the full 11000 and debits ROUND_OFF 1000.
- **Impact:** The 'expected = line_total + tax_total' value is computed with a comment 'expected is for sanity' but never compared. Any arbitrary mismatch is absorbed into ROUND_OFF with no bound, overstating/understating the vendor's payable and polluting round-off. ROUND_OFF is seeded by default so the unmapped-escape never fires; the JE balances and posts. FE keeps total = subtotal+tax, so reachable via API/import only.
- **Fix:** After computing diff, only allow |diff| within a small tolerance (e.g. 0.01) to flow to ROUND_OFF; otherwise raise ValidationError('Bill total must equal lines + tax').

### L4. Maker-checker approval workflow is unreachable from the UI — a bill above the approval threshold cannot be posted at all

- **Domain:** Vendor bills + recurring bills
- **Location:** `backend/bills/views.py:206-261 (submit-for-approval / approver-approve / approver-reject have no FE caller) and services.py:36-42 (post_bill threshold gate)`
- **Scenario:** Admin sets bill_approval_threshold to 50000. A user creates a draft bill of 60000 and clicks Approve.
- **Impact:** approveBill -> post_bill raises ValidationError 'needs approval first' (400), but the FE has zero wiring for submit-for-approval / approver-approve / approver-reject and never reads approval_status, so an over-threshold bill can never be posted via the UI. NOTE: the trigger (a nonzero bill_approval_threshold) is itself NOT settable from the frontend — the field is absent from the settings UI/interface and the model default is 0 (gate bypassed) — so the dead-end only manifests after an out-of-band config change. Config-gated incomplete feature, hence low.
- **Fix:** Add FE api.ts functions + BillDetailPage buttons for submit-for-approval and approver approve/reject, gated on bill.approval_status and the configured threshold; show the pending/approved/rejected state.

### L5. Negative GST tax on a draft is accepted, then Approve fails with a confusing 'unbalanced journal entry' error

- **Domain:** Vendor bills + recurring bills
- **Location:** `frontend min='0' is a non-binding hint (BillEditorPage.tsx:377-389); no non-negative tax check in serializers.py:121-130; services.py:76/93 leaves the JE unbalanced -> post() raises (journals/models.py:148)`
- **Scenario:** In BillEditorPage type a negative CGST (e.g. -50; min='0' doesn't block typing/paste since save is a button onClick). total = subtotal-50 saves as a draft. Click Approve.
- **Impact:** post_bill skips the negative tax from the JE debits ('if tax > 0') but diff=0, so Trade Payables is credited subtotal-50 while expense debits = subtotal, leaving the entry unbalanced by 50 -> post() raises 'Journal entry is unbalanced' (400). The user gets an opaque balance error instead of 'tax cannot be negative', and a bad-data draft lingers. Atomic rollback, no corruption, requires deliberately typing a negative — hence low.
- **Fix:** Validate tax_cgst/tax_sgst/tax_igst >= 0 in BillWriteSerializer.validate (and RecurringBillWriteSerializer) and surface it; optionally enforce on the model.

### L6. Credit/Debit Note has no field to record the original invoice number for GSTR-1 amendment linkage

- **Domain:** Contra / Journal / Credit Note / Debit Note vouchers
- **Location:** `frontend/src/pages/vouchers/VoucherEditor.tsx:479-501 (party-picker XOR reference-# field) + reference_id at :195`
- **Scenario:** Issue a Credit Note against original invoice INV-2024-0042. Because partyType is set for CREDIT_NOTE/DEBIT_NOTE, the editor renders only the party picker and never the Reference # input, so reference_id=null and there is nowhere to capture the original invoice number/date the note amends.
- **Impact:** The manual note posts as a standalone JE with no original-document metadata (and reference_id is a PositiveIntegerField, so even a textual invoice no. would become NaN -> null). Real data-completeness/UX gap, BUT the claimed GSTR-1 impact is refuted: manual credit/debit-note JEs never feed GSTR-1 — CDNR rows are sourced from inventory SalesReturnRO with original_invoice_no/date correctly captured there. So the compliance framing is wrong; adjusted to low.
- **Fix:** Add an 'Against Invoice #/date' field for CREDIT_NOTE/DEBIT_NOTE (alongside the party picker), persisted via a text reference (the BillReference 'AGAINST' mechanism already stores ref_no/ref_date).

### L7. Cash Flow opening cash is not location-scoped while closing cash is, corrupting the per-location opening/closing balances

- **Domain:** Reports: TB, P&L, BS, ledger, aging, party outstanding
- **Location:** `backend/reports/views.py:1923-1931 (opening_cash query missing location filter) vs 1863-1867 (all_lines location-filtered)`
- **Scenario:** Run /api/reports/cash-flow/ with an active X-Location-Id for a multi-location tenant where cash/bank accounts have balances in more than one location before the period start. all_lines is location-filtered but the opening_cash subquery has no entry__location_id clause.
- **Impact:** opening_cash sums Cash+Bank across ALL locations before start_date while closing_cash = that all-location opening + active-location-only period movement, so the reported opening_cash and closing_cash absolute figures are wrong for a single-location view. NOTE: reconciliation_diff is NOT corrupted (the all-location opening cancels in closing-opening, leaving the location-scoped period movement which still equals net_change), and no frontend page calls this endpoint — so adjusted to low.
- **Fix:** Apply the same location filter to the opening_cash queryset (.filter(entry__location_id=location.id) when location is set), exactly as all_lines does.

### L8. No validation that Budget.period matches period_kind format; mismatched/malformed periods silently mis-scope the variance report

- **Domain:** Loans (amortization) & budgets
- **Location:** `backend/budgets/serializers.py:10-15 (no validate); consumed in services.py:12-34 (_period_dates) and views.py:44-51`
- **Scenario:** POST /api/budgets/ with period_kind='annual' and period='2026-04' (or monthly with '2026'). The serializer accepts any string up to 10 chars; period field has no regex/choices. Then run the variance report.
- **Impact:** _period_dates('2026-04','annual') takes the '-' branch and treats it as a full FY, so a budget intended for one month is silently compared against a year of actuals with no error. Malformed strings (period='2026-13' monthly) raise ValueError that the variance view catches as a 400 for that query. NOTE: the 'one bad row poisons the whole period report' framing is refuted — _period_dates runs once on the query period and rows are matched by exact string, so a bad stored row only affects a query for that exact period. No budgets UI exists at all. Hence low.
- **Fix:** Add BudgetSerializer.validate cross-checking period against period_kind with a regex per kind (monthly YYYY-MM, quarterly YYYY-Qx, annual YYYY/YYYY-YY; validate month 1-12 / quarter 1-4).

### L9. financial_year_start FE<->BE format mismatch: FE labels it 'MM-DD' (string) but BE is an integer month

- **Domain:** Core: Chart of Accounts, period lock, settings, audit log, dashboard
- **Location:** `frontend/src/lib/api.ts:1934 (financial_year_start: string) + SettingsPage.tsx:28 (placeholder 'MM-DD') vs backend/core/models.py:10 (IntegerField default=4)`
- **Scenario:** Settings -> Company Info -> Financial Year Start. The field round-trips the backend integer but the placeholder and api.ts type describe a 'MM-DD' string. A user follows the hint and types '04-01' and Saves.
- **Impact:** DRF IntegerField.to_internal_value('04-01') raises 'A valid integer is required' -> 400 -> generic 'Failed to save settings' toast with no field-level explanation. The user cannot configure the fiscal year via the documented format; only a bare integer works, which the UI never tells them. Admin-only config screen, no data corruption — pairs with the CORE-1 range-validation fix.
- **Fix:** Change the api.ts type to number, render a 1-12 month <select> in CompanyInfoTab, remove the 'MM-DD' placeholder, and add the server-side range validation.

### L10. Deactivated accounts still accept new postings (BE never enforces is_active)

- **Domain:** Core: Chart of Accounts, period lock, settings, audit log, dashboard
- **Location:** `backend/journals/serializers.py:244-250 (leaf check only) and models.py:258-283 (JournalEntryLine.save — no is_active check)`
- **Scenario:** Deactivate an account (the UI promises 'inactive accounts are hidden from new transactions'). Then create a manual Journal voucher (or any voucher/API call) selecting that now-inactive leaf account on a line and post it.
- **Impact:** Neither JournalEntryCreateSerializer.validate nor JournalEntryLine.save checks account.is_active — only is_leaf and party-tag. The FE merely hides inactive accounts from dropdowns, so any cached/stale dropdown, the journal-line API, or an auto-mapping pointing at a deactivated account posts to it. Deactivation gives a false sense of a closed account, contradicting the UI promise. Standard UI path is protected by the picker, so low; but the model save already enforces other posting invariants for all paths and omits this one.
- **Fix:** In JournalEntryLine.save() (and JournalEntryCreateSerializer.validate), reject posting to an account where not account.is_active, raising a clean ValidationError; allow an explicit override only for system/reversal flows if needed.


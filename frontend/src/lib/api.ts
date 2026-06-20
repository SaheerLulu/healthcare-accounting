import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: attach Bearer token + active location
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const locationId = localStorage.getItem('accounting_active_location')
  if (locationId && locationId !== 'all') {
    config.headers['X-Location-Id'] = locationId
  }
  return config
})

// Response interceptor: on 401 redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('refresh_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string) {
  const res = await api.post('/auth/token/', { username, password })
  return res.data as { access: string; refresh: string }
}

export async function refreshToken() {
  const refresh = localStorage.getItem('refresh_token')
  const res = await api.post('/auth/token/refresh/', { refresh })
  return res.data as { access: string }
}

// ─── Locations ───────────────────────────────────────────────────────────────

export interface UserLocation {
  id: number
  name: string
  complete_name: string
  is_default: boolean
}

export async function getUserLocations() {
  const res = await api.get('/accounts/user-locations/')
  return res.data as { locations: UserLocation[]; can_see_all: boolean }
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export interface Account {
  id: number
  account_code: string
  account_name: string
  account_type: string
  account_subtype: string
  parent: number | null
  parent_code?: string | null
  parent_name?: string | null
  /** null = shared or internal template; non-null = per-store account */
  location_id: number | null
  /** Admin-created shared account (location_id null), shown in every store. */
  is_shared?: boolean
  is_leaf: boolean
  is_active: boolean
  description: string
  documents_count?: number
  children?: Account[]
  /** Set on per-party (Sundry Creditor/Debtor) ledger leaves; '' / null otherwise. */
  party_type?: string
  party_id?: number | null
}

export interface AccountCounts {
  total: number
  active: number
  inactive: number
  by_type: Record<string, number>
}

export async function getChartOfAccounts(params?: Record<string, string>) {
  const res = await api.get('/accounts/chart-of-accounts/', { params })
  return res.data as Account[]
}

export async function getAccount(id: number) {
  const res = await api.get(`/accounts/chart-of-accounts/${id}/`)
  return res.data as Account
}

export async function createAccount(data: Partial<Account>) {
  const res = await api.post('/accounts/chart-of-accounts/', data)
  return res.data as Account
}

export async function updateAccount(id: number, data: Partial<Account>) {
  const res = await api.patch(`/accounts/chart-of-accounts/${id}/`, data)
  return res.data as Account
}

export async function deleteAccount(id: number) {
  await api.delete(`/accounts/chart-of-accounts/${id}/`)
}

export async function getAccountCounts(params?: Record<string, string>) {
  const res = await api.get('/accounts/chart-of-accounts/counts/', { params })
  return res.data as AccountCounts
}

export async function toggleAccountActive(id: number) {
  const res = await api.post(`/accounts/chart-of-accounts/${id}/toggle-active/`)
  return res.data as Account
}

// ─── Account Mappings ────────────────────────────────────────────────────────

export interface AccountMapping {
  id: number
  key: string
  account: number
  account_code: string
  account_name: string
  /** null = shared/default; non-null = per-store override */
  location_id: number | null
}

export async function getAccountMappings(params?: { location_id?: number | 'null' }) {
  const res = await api.get('/accounts/account-mappings/', { params })
  return res.data as AccountMapping[]
}

export interface AccountMappingKeyRow {
  key: string
  label: string
  default_code: string | null
  /** True for keys that must stay shared (GST, TDS, equity, suspense, etc.). */
  is_shared_key: boolean
  mapping_id: number | null
  account: number | null
  account_code: string | null
  account_name: string | null
  /** True when a per-location override exists for the queried location. */
  has_override: boolean
  override_id: number | null
}

export async function getAllAccountMappingKeys(params?: { location_id?: number | 'null' }) {
  const res = await api.get('/accounts/account-mappings/all-keys/', { params })
  return res.data as AccountMappingKeyRow[]
}

export async function updateAccountMapping(
  id: number, data: { account: number; location_id?: number | null },
) {
  const res = await api.patch(`/accounts/account-mappings/${id}/`, data)
  return res.data as AccountMapping
}

export async function createAccountMapping(
  data: { key: string; account: number; location_id?: number | null },
) {
  const res = await api.post('/accounts/account-mappings/', data)
  return res.data as AccountMapping
}

export async function deleteAccountMapping(id: number) {
  await api.delete(`/accounts/account-mappings/${id}/`)
}

export async function resetAccountMappings(keys?: string[]) {
  const res = await api.post('/accounts/account-mappings/reset/', keys ? { keys } : {})
  return res.data
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardData {
  total_revenue: number | string
  total_expenses: number | string
  net_profit: number | string
  total_receivables: number | string
  total_payables: number | string
  gst_payable: number | string
  range_start?: string
  range_end?: string
  monthly_data?: {
    month: string
    revenue: number
    expenses: number
  }[]
}

export async function getDashboard(params?: { start_date?: string; end_date?: string }) {
  const res = await api.get('/accounts/dashboard/', { params })
  return res.data as DashboardData
}

// ─── Journal Entries ─────────────────────────────────────────────────────────

export interface JournalLine {
  id?: number
  account: number
  account_name?: string
  account_code?: string
  debit: string
  credit: string
  narration?: string
  party_type?: 'Supplier' | 'Customer' | 'None' | null
  party_id?: number | null
  /** Tally bill-wise allocations attached to this line (read-only from the API). */
  bill_references?: BillReference[]
}

export interface JournalEntry {
  id: number
  entry_no: string
  date: string
  narration: string
  voucher_type: string
  reference_type: string
  reference_id: number | null
  cost_center?: string
  cost_centre?: number | null
  voucher_type_profile?: number | null
  is_optional?: boolean
  is_memorandum?: boolean
  reversal_date?: string | null
  auto_reversed?: boolean
  is_posted: boolean
  lines: JournalLine[]
  created_at: string
}

export async function getJournalEntries(params?: Record<string, string>) {
  const res = await api.get('/journals/entries/', { params })
  return res.data as {
    results: JournalEntry[]
    count: number
    posted_count: number
    draft_count: number
  }
}

export async function getJournalEntry(id: number) {
  const res = await api.get(`/journals/entries/${id}/`)
  return res.data as JournalEntry
}

export async function createJournalEntry(data: {
  date: string
  narration: string
  voucher_type: string
  voucher_type_profile?: number | null
  reference_type?: string
  reference_id?: number | null
  cost_center?: string
  cost_centre?: number | null
  is_optional?: boolean
  is_memorandum?: boolean
  reversal_date?: string | null
  location_id: number
  lines: JournalLine[]
}) {
  const res = await api.post('/journals/entries/', data)
  return res.data as JournalEntry
}

export async function postEntry(id: number) {
  const res = await api.post(`/journals/entries/${id}/post/`)
  return res.data as JournalEntry
}

export async function reverseEntry(id: number) {
  const res = await api.post(`/journals/entries/${id}/reverse/`)
  return res.data as JournalEntry
}

export async function updateJournalEntry(id: number, data: {
  date?: string
  narration?: string
  voucher_type?: string
  voucher_type_profile?: number | null
  reference_type?: string
  reference_id?: number | null
  cost_center?: string
  cost_centre?: number | null
  is_optional?: boolean
  is_memorandum?: boolean
  reversal_date?: string | null
  location_id: number
  lines?: JournalLine[]
}) {
  const res = await api.put(`/journals/entries/${id}/`, data)
  return res.data as JournalEntry
}

export async function deleteJournalEntry(id: number) {
  await api.delete(`/journals/entries/${id}/`)
}

// ─── Voucher Shortcuts ──────────────────────────────────────────────────────

export interface Party {
  id: number
  name: string
}

export async function getSuppliers() {
  const res = await api.get('/accounts/suppliers/')
  return res.data as Party[]
}

export async function getCustomers() {
  const res = await api.get('/accounts/customers/')
  return res.data as Party[]
}

export async function createPaymentVoucher(data: {
  date: string; amount: string; party_id?: number | null;
  payment_mode: 'bank' | 'cash'; bank_account_id?: number | null;
  narration?: string; location_id: number
}) {
  const res = await api.post('/journals/entries/payment/', data)
  return res.data as JournalEntry
}

export async function createReceiptVoucher(data: {
  date: string; amount: string; party_id?: number | null; receipt_mode: string; narration?: string; location_id: number
}) {
  const res = await api.post('/journals/entries/receipt/', data)
  return res.data as JournalEntry
}

export async function createContraVoucher(data: {
  date: string; amount: string; direction: string; narration?: string; location_id: number
}) {
  const res = await api.post('/journals/entries/contra/', data)
  return res.data as JournalEntry
}

// ─── Parties (Suppliers / Customers) ───────────────────────────────────────

export type PartyType = 'Supplier' | 'Customer'

export interface PartyListRow {
  id: number
  name: string
  gst_no: string
  phone: string
  email: string
  city: string
  state: string
  status: string
  customer_type?: string
  outstanding: string
  invoice_count: number
  last_transaction_date: string | null
  opening_balance: string
  opening_balance_as_of: string | null
}

export interface PartySummary {
  total_invoices: string
  total_settled: string
  outstanding: string
  invoice_count: number
  last_transaction_date: string | null
  opening_balance: string
  opening_balance_as_of: string | null
}

export interface SupplierDetail {
  id: number
  name: string
  gst_no: string
  contact_person: string
  phone: string
  email: string
  address: string
  city: string
  state: string
  pincode: string
  payment_terms: string
  credit_days: number
  status: string
  location_id: number | null
  created_at: string | null
  summary: PartySummary
}

export interface CustomerDetail {
  id: number
  name: string
  customer_code: string
  gst_no: string
  phone: string
  email: string
  address: string
  city: string
  state: string
  pincode: string
  payment_terms: string
  credit_days: number
  credit_limit: string
  customer_type: string
  status: string
  location_id: number | null
  created_at: string | null
  summary: PartySummary
}

export interface PartyTransaction {
  entry_id: number
  date: string
  entry_no: string
  voucher_type: string
  reference_type: string
  reference_id: number | null
  narration: string
  debit: string
  credit: string
  amount: string
}

export interface PartyStatementRow {
  date: string
  entry_no: string
  voucher_type: string
  reference_type: string
  reference_id: number | null
  narration: string
  debit: string
  credit: string
  balance: string
}

export interface PartyStatement {
  party_type: PartyType
  party_id: number
  start_date: string | null
  end_date: string | null
  opening_balance: string
  stored_opening_balance: string
  opening_balance_as_of: string | null
  closing_balance: string
  rows: PartyStatementRow[]
}

export interface PartyOpeningBalance {
  id: number
  party_type: PartyType
  party_id: number
  amount: string
  as_of_date: string
  narration: string
  created_at: string
  updated_at: string
  created_by: number | null
  created_by_username: string | null
}

export interface PartyCommunication {
  id: number
  party_type: PartyType
  party_id: number
  channel: 'email' | 'phone' | 'whatsapp' | 'note'
  direction: 'out' | 'in'
  subject: string
  body: string
  contact: string
  communicated_at: string
  created_at: string
  created_by: number | null
  created_by_username: string | null
}

const partyBase = (t: PartyType) => (t === 'Supplier' ? 'suppliers' : 'customers')

export async function getPartiesList(party_type: PartyType, params?: { search?: string }) {
  const res = await api.get(`/parties/${partyBase(party_type)}/`, { params })
  return res.data as { rows: PartyListRow[]; count: number }
}

export async function getSupplierDetail(id: number) {
  const res = await api.get(`/parties/suppliers/${id}/`)
  return res.data as SupplierDetail
}

export async function getCustomerDetail(id: number) {
  const res = await api.get(`/parties/customers/${id}/`)
  return res.data as CustomerDetail
}

export async function getPartyTransactions(party_type: PartyType, id: number, params?: Record<string, string>) {
  const res = await api.get(`/parties/${partyBase(party_type)}/${id}/transactions/`, { params })
  return res.data as { rows: PartyTransaction[]; count: number }
}

export async function getPartyStatement(party_type: PartyType, id: number, params?: Record<string, string>) {
  const res = await api.get(`/parties/${partyBase(party_type)}/${id}/statement/`, { params })
  return res.data as PartyStatement
}

export async function getPartyCommunications(party_type: PartyType, id: number, params?: Record<string, string>) {
  const res = await api.get(`/parties/${partyBase(party_type)}/${id}/communications/`, { params })
  return res.data as { rows: PartyCommunication[]; count: number }
}

export async function createPartyCommunication(party_type: PartyType, id: number, data: {
  channel: PartyCommunication['channel']
  direction: PartyCommunication['direction']
  subject: string
  body?: string
  contact?: string
  communicated_at: string
}) {
  const res = await api.post(`/parties/${partyBase(party_type)}/${id}/communications/`, data)
  return res.data as PartyCommunication
}

export async function deletePartyCommunication(commId: number) {
  await api.delete(`/parties/communications/${commId}/`)
}

export async function getPartyOpeningBalance(party_type: PartyType, id: number) {
  const res = await api.get(`/parties/${partyBase(party_type)}/${id}/opening-balance/`)
  return res.data as PartyOpeningBalance | null
}

export async function upsertPartyOpeningBalance(party_type: PartyType, id: number, data: {
  amount: string
  as_of_date: string
  narration?: string
}) {
  const res = await api.put(`/parties/${partyBase(party_type)}/${id}/opening-balance/`, data)
  return res.data as PartyOpeningBalance
}

export async function deletePartyOpeningBalance(party_type: PartyType, id: number) {
  await api.delete(`/parties/${partyBase(party_type)}/${id}/opening-balance/`)
}

// ─── Bills ──────────────────────────────────────────────────────────────────

export type BillStatus = 'draft' | 'open' | 'partially_paid' | 'paid' | 'cancelled'

export interface BillLine {
  id?: number
  account: number
  account_code?: string
  account_name?: string
  description: string
  amount: string
}

export interface BillPayment {
  id: number
  bill: number
  date: string
  amount: string
  mode: 'bank' | 'cash'
  reference: string
  notes: string
  journal_entry: number | null
  journal_entry_no: string | null
  created_at: string
  created_by: number | null
  created_by_name: string | null
}

export interface BillAttachment {
  id: number
  bill: number
  file_url: string
  original_name: string
  content_type: string
  size: number
  uploaded_at: string
  uploaded_by: number | null
  uploaded_by_name: string | null
}

export interface Bill {
  id: number
  bill_no: string
  bill_date: string
  due_date: string | null
  vendor_id: number | null
  vendor_name: string
  subtotal: string
  tax_cgst: string
  tax_sgst: string
  tax_igst: string
  total_amount: string
  amount_paid: string
  balance_due: string
  status: BillStatus
  notes: string
  location_id: number | null
  journal_entry: number | null
  journal_entry_no: string | null
  lines: BillLine[]
  payments: BillPayment[]
  attachments: BillAttachment[]
  created_at: string
  updated_at: string
  created_by: number | null
  created_by_name: string | null
}

export interface BillCounts {
  total: number
  by_status: Partial<Record<BillStatus, number>>
  overdue: number
  outstanding: string
}

export interface BillWritePayload {
  bill_no: string
  bill_date: string
  due_date?: string | null
  vendor_id?: number | null
  vendor_name: string
  subtotal: string
  tax_cgst?: string
  tax_sgst?: string
  tax_igst?: string
  total_amount: string
  notes?: string
  location_id?: number | null
  lines: { account: number; description: string; amount: string }[]
}

export async function getBills(params?: Record<string, string>) {
  const res = await api.get('/bills/bills/', { params })
  // Pagination wraps the list when DEFAULT pagination is on; otherwise it's an array.
  if (Array.isArray(res.data)) return { results: res.data as Bill[], count: res.data.length }
  return res.data as { results: Bill[]; count: number }
}

export async function getBill(id: number) {
  const res = await api.get(`/bills/bills/${id}/`)
  return res.data as Bill
}

export async function createBill(payload: BillWritePayload) {
  const res = await api.post('/bills/bills/', payload)
  return res.data as Bill
}

export async function updateBill(id: number, payload: Partial<BillWritePayload>) {
  const res = await api.put(`/bills/bills/${id}/`, payload)
  return res.data as Bill
}

export async function deleteBill(id: number) {
  await api.delete(`/bills/bills/${id}/`)
}

export async function approveBill(id: number) {
  const res = await api.post(`/bills/bills/${id}/approve/`)
  return res.data as Bill
}

export async function cancelBill(id: number) {
  const res = await api.post(`/bills/bills/${id}/cancel/`)
  return res.data as Bill
}

export async function recordBillPayment(id: number, payload: {
  date: string
  amount: string
  mode: 'bank' | 'cash'
  reference?: string
  notes?: string
}) {
  const res = await api.post(`/bills/bills/${id}/payments/`, payload)
  return res.data as Bill
}

export async function deleteBillPayment(paymentId: number) {
  await api.delete(`/bills/payments/${paymentId}/`)
}

export async function uploadBillAttachment(billId: number, file: File) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await api.post(`/bills/bills/${billId}/attachments/`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data as BillAttachment
}

export async function deleteBillAttachment(attachmentId: number) {
  await api.delete(`/bills/attachments/${attachmentId}/`)
}

export async function getBillCounts() {
  const res = await api.get('/bills/bills/counts/')
  return res.data as BillCounts
}

// ─── Expenses ───────────────────────────────────────────────────────────────

export type ExpenseStatus = 'draft' | 'recorded'

export interface ExpenseItem {
  id?: number
  account: number
  account_code?: string
  account_name?: string
  description: string
  amount: string
}

export interface ExpenseAttachmentRow {
  id: number
  expense: number
  file_url: string
  original_name: string
  content_type: string
  size: number
  uploaded_at: string
  uploaded_by: number | null
  uploaded_by_name: string | null
}

export interface Expense {
  id: number
  expense_date: string
  paid_through_account: number
  paid_through_code: string
  paid_through_name: string
  vendor_name: string
  vendor_id: number | null
  reference: string
  subtotal: string
  tax_cgst: string
  tax_sgst: string
  tax_igst: string
  total_amount: string
  notes: string
  status: ExpenseStatus
  journal_entry: number | null
  journal_entry_no: string | null
  location_id: number | null
  items: ExpenseItem[]
  attachments: ExpenseAttachmentRow[]
  is_itemized: boolean
  created_at: string
  updated_at: string
  created_by: number | null
  created_by_name: string | null
}

export interface ExpenseWritePayload {
  expense_date: string
  paid_through_account: number
  vendor_name?: string
  vendor_id?: number | null
  reference?: string
  subtotal: string
  tax_cgst?: string
  tax_sgst?: string
  tax_igst?: string
  total_amount: string
  notes?: string
  location_id?: number | null
  items: { account: number; description: string; amount: string }[]
}

export interface ExpenseCounts {
  total: number
  by_status: Partial<Record<ExpenseStatus, number>>
  total_amount: string
}

export async function getExpenses(params?: Record<string, string>) {
  const res = await api.get('/expenses/expenses/', { params })
  if (Array.isArray(res.data)) return { results: res.data as Expense[], count: res.data.length }
  return res.data as { results: Expense[]; count: number }
}

export async function getExpense(id: number) {
  const res = await api.get(`/expenses/expenses/${id}/`)
  return res.data as Expense
}

export async function createExpense(payload: ExpenseWritePayload) {
  const res = await api.post('/expenses/expenses/', payload)
  return res.data as Expense
}

export async function updateExpense(id: number, payload: Partial<ExpenseWritePayload>) {
  const res = await api.put(`/expenses/expenses/${id}/`, payload)
  return res.data as Expense
}

export async function deleteExpense(id: number) {
  await api.delete(`/expenses/expenses/${id}/`)
}

export async function recordExpense(id: number) {
  const res = await api.post(`/expenses/expenses/${id}/record/`)
  return res.data as Expense
}

export async function reverseExpense(id: number) {
  const res = await api.post(`/expenses/expenses/${id}/reverse/`)
  return res.data as Expense
}

export async function getExpenseCounts() {
  const res = await api.get('/expenses/expenses/counts/')
  return res.data as ExpenseCounts
}

export async function uploadExpenseAttachment(expenseId: number, file: File) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await api.post(`/expenses/expenses/${expenseId}/attachments/`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data as ExpenseAttachmentRow
}

export async function deleteExpenseAttachment(attachmentId: number) {
  await api.delete(`/expenses/attachments/${attachmentId}/`)
}

// ─── Recurring Journals ─────────────────────────────────────────────────────

export interface RecurringJournalLine {
  id?: number
  account: number
  account_code?: string
  account_name?: string
  debit: string
  credit: string
  narration: string
  party_type: 'Customer' | 'Supplier' | 'None'
  party_id: number | null
}

export interface GeneratedJournalStub {
  id: number
  entry_no: string
  date: string
  is_posted: boolean
}

export interface RecurringJournal {
  id: number
  profile_name: string
  voucher_type: string
  voucher_type_display: string
  narration_template: string
  location_id: number | null
  frequency: RecurringFrequency
  start_date: string
  end_date: string | null
  next_run_date: string
  last_run_date: string | null
  auto_post: boolean
  status: RecurringStatus
  last_error: string
  lines: RecurringJournalLine[]
  total_debit: string
  total_credit: string
  is_balanced: boolean
  /** Present on retrieve/detail responses only — the list endpoint omits
   *  both (each one is a journal-table scan per profile). */
  generated_count?: number
  generated_recent?: GeneratedJournalStub[]
  created_at: string
  updated_at: string
  created_by: number | null
  created_by_name: string | null
}

export interface RecurringJournalWritePayload {
  profile_name: string
  voucher_type: string
  narration_template?: string
  location_id?: number | null
  frequency: RecurringFrequency
  start_date: string
  end_date?: string | null
  next_run_date?: string
  auto_post?: boolean
  lines: {
    account: number
    debit: string
    credit: string
    narration?: string
    party_type?: 'Customer' | 'Supplier' | 'None'
    party_id?: number | null
  }[]
}

export async function getRecurringJournals(params?: Record<string, string>) {
  const res = await api.get('/journals/recurring/', { params })
  if (Array.isArray(res.data)) return { results: res.data as RecurringJournal[], count: res.data.length }
  return res.data as { results: RecurringJournal[]; count: number }
}

export async function getRecurringJournal(id: number) {
  const res = await api.get(`/journals/recurring/${id}/`)
  return res.data as RecurringJournal
}

export async function createRecurringJournal(payload: RecurringJournalWritePayload) {
  const res = await api.post('/journals/recurring/', payload)
  return res.data as RecurringJournal
}

export async function updateRecurringJournal(id: number, payload: Partial<RecurringJournalWritePayload>) {
  const res = await api.put(`/journals/recurring/${id}/`, payload)
  return res.data as RecurringJournal
}

export async function deleteRecurringJournal(id: number) {
  await api.delete(`/journals/recurring/${id}/`)
}

export async function pauseRecurringJournal(id: number) {
  const res = await api.post(`/journals/recurring/${id}/pause/`)
  return res.data as RecurringJournal
}

export async function resumeRecurringJournal(id: number) {
  const res = await api.post(`/journals/recurring/${id}/resume/`)
  return res.data as RecurringJournal
}

export async function stopRecurringJournal(id: number) {
  const res = await api.post(`/journals/recurring/${id}/stop/`)
  return res.data as RecurringJournal
}

export async function generateRecurringJournalNow(id: number) {
  const res = await api.post(`/journals/recurring/${id}/generate-now/`)
  return res.data as { entry_id: number; entry_no: string; recurring: RecurringJournal }
}

export async function runDueRecurringJournals() {
  const res = await api.post('/journals/recurring/run-due/')
  return res.data as {
    created: number
    today: string
    created_details: { recurring_id: number; entry_id: number; entry_no: string }[]
    errors: { recurring_id: number; error: string }[]
  }
}

// ─── Recurring Bills ────────────────────────────────────────────────────────

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
export type RecurringStatus = 'active' | 'paused' | 'stopped'

export interface RecurringBillItem {
  id?: number
  account: number
  account_code?: string
  account_name?: string
  description: string
  amount: string
}

export interface GeneratedBillStub {
  id: number
  bill_no: string
  bill_date: string
  total_amount: string
  status: string
}

export interface RecurringBill {
  id: number
  profile_name: string
  vendor_id: number | null
  vendor_name: string
  subtotal: string
  tax_cgst: string
  tax_sgst: string
  tax_igst: string
  total_amount: string
  notes: string
  location_id: number | null
  frequency: RecurringFrequency
  start_date: string
  end_date: string | null
  next_run_date: string
  last_run_date: string | null
  due_days: number
  auto_approve: boolean
  bill_no_pattern: string
  status: RecurringStatus
  last_error: string
  items: RecurringBillItem[]
  generated_count: number
  generated_recent: GeneratedBillStub[]
  created_at: string
  updated_at: string
  created_by: number | null
  created_by_name: string | null
}

export interface RecurringBillWritePayload {
  profile_name: string
  vendor_id?: number | null
  vendor_name: string
  subtotal: string
  tax_cgst?: string
  tax_sgst?: string
  tax_igst?: string
  total_amount: string
  notes?: string
  location_id?: number | null
  frequency: RecurringFrequency
  start_date: string
  end_date?: string | null
  next_run_date?: string
  due_days?: number
  auto_approve?: boolean
  bill_no_pattern?: string
  items: { account: number; description: string; amount: string }[]
}

export async function getRecurringBills(params?: Record<string, string>) {
  const res = await api.get('/bills/recurring/', { params })
  if (Array.isArray(res.data)) return { results: res.data as RecurringBill[], count: res.data.length }
  return res.data as { results: RecurringBill[]; count: number }
}

export async function getRecurringBill(id: number) {
  const res = await api.get(`/bills/recurring/${id}/`)
  return res.data as RecurringBill
}

export async function createRecurringBill(payload: RecurringBillWritePayload) {
  const res = await api.post('/bills/recurring/', payload)
  return res.data as RecurringBill
}

export async function updateRecurringBill(id: number, payload: Partial<RecurringBillWritePayload>) {
  const res = await api.put(`/bills/recurring/${id}/`, payload)
  return res.data as RecurringBill
}

export async function deleteRecurringBill(id: number) {
  await api.delete(`/bills/recurring/${id}/`)
}

export async function pauseRecurringBill(id: number) {
  const res = await api.post(`/bills/recurring/${id}/pause/`)
  return res.data as RecurringBill
}

export async function resumeRecurringBill(id: number) {
  const res = await api.post(`/bills/recurring/${id}/resume/`)
  return res.data as RecurringBill
}

export async function stopRecurringBill(id: number) {
  const res = await api.post(`/bills/recurring/${id}/stop/`)
  return res.data as RecurringBill
}

export async function generateRecurringBillNow(id: number) {
  const res = await api.post(`/bills/recurring/${id}/generate-now/`)
  return res.data as { bill_id: number; bill_no: string; recurring: RecurringBill }
}

export async function runDueRecurringBills() {
  const res = await api.post('/bills/recurring/run-due/')
  return res.data as {
    created: number
    today: string
    created_details: { recurring_id: number; bill_id: number }[]
    errors: { recurring_id: number; error: string }[]
  }
}

// ─── Banking ────────────────────────────────────────────────────────────────

export interface BankAccount {
  id: number
  name: string
  account_type: 'bank' | 'credit_card' | 'cash'
  bank_name: string
  account_number: string
  ifsc: string
  currency: string
  chart_account: number
  chart_account_code: string
  chart_account_name: string
  opening_balance: string
  opening_date: string | null
  is_active: boolean
  notes: string
  location_id: number | null
  book_balance: string
  statement_balance: string
  unmatched_count: number
  created_at: string
  updated_at: string
}

export type BankTxnStatus = 'unmatched' | 'matched' | 'excluded'

export interface BankTransaction {
  id: number
  bank_account: number
  bank_account_name: string
  date: string
  value_date: string | null
  description: string
  reference: string
  amount: string
  abs_amount: string
  direction: 'in' | 'out'
  running_balance: string | null
  status: BankTxnStatus
  source: 'imported' | 'manual'
  matched_journal_entry: number | null
  matched_entry_no: string | null
  matched_entry_voucher: string | null
  matched_entry_narration: string | null
  notes: string
  imported_at: string | null
  created_at: string
  updated_at: string
}

export interface MatchSuggestion {
  entry_id: number
  entry_no: string
  date: string
  voucher_type: string
  narration: string
  amount: string
  days_off: number
}

export async function getBankAccounts(params?: Record<string, string>) {
  const res = await api.get('/banking/accounts/', { params })
  return res.data as BankAccount[]
}

export async function getBankAccount(id: number) {
  const res = await api.get(`/banking/accounts/${id}/`)
  return res.data as BankAccount
}

export async function createBankAccount(data: Partial<BankAccount>) {
  const res = await api.post('/banking/accounts/', data)
  return res.data as BankAccount
}

export async function updateBankAccount(id: number, data: Partial<BankAccount>) {
  const res = await api.patch(`/banking/accounts/${id}/`, data)
  return res.data as BankAccount
}

export async function getCashInHand() {
  const res = await api.get('/banking/accounts/cash-in-hand/')
  return res.data as { location_id: number | null; cash_in_hand: string }
}

export async function depositCashToBank(id: number, payload: {
  date: string; amount: string; narration?: string
}) {
  const res = await api.post(`/banking/accounts/${id}/deposit-cash/`, payload)
  return res.data as { entry_no: string }
}

export async function deleteBankAccount(id: number) {
  await api.delete(`/banking/accounts/${id}/`)
}

export async function getBankTransactions(params?: Record<string, string>) {
  const res = await api.get('/banking/transactions/', { params })
  if (Array.isArray(res.data)) return { results: res.data as BankTransaction[], count: res.data.length }
  return res.data as { results: BankTransaction[]; count: number }
}

export async function createBankTransaction(data: {
  bank_account: number
  date: string
  description: string
  reference?: string
  amount: string
  notes?: string
}) {
  const res = await api.post('/banking/transactions/', data)
  return res.data as BankTransaction
}

export async function deleteBankTransaction(id: number) {
  await api.delete(`/banking/transactions/${id}/`)
}

export async function importBankCsv(bankAccountId: number, file: File) {
  const fd = new FormData()
  fd.append('bank_account', String(bankAccountId))
  fd.append('file', file)
  const res = await api.post('/banking/transactions/import/', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data as { imported: number; duplicates: number; errors: string[] }
}

export async function getBankTxnSuggestions(id: number) {
  const res = await api.get(`/banking/transactions/${id}/suggestions/`)
  return res.data as { rows: MatchSuggestion[] }
}

export async function matchBankTxn(id: number, journalEntryId: number) {
  const res = await api.post(`/banking/transactions/${id}/match/`, { journal_entry_id: journalEntryId })
  return res.data as BankTransaction
}

export async function unmatchBankTxn(id: number) {
  const res = await api.post(`/banking/transactions/${id}/unmatch/`)
  return res.data as BankTransaction
}

export async function excludeBankTxn(id: number) {
  const res = await api.post(`/banking/transactions/${id}/exclude/`)
  return res.data as BankTransaction
}

export async function restoreBankTxn(id: number) {
  const res = await api.post(`/banking/transactions/${id}/restore/`)
  return res.data as BankTransaction
}

export async function categorizeBankTxn(id: number, payload: {
  account_id: number
  party_type?: 'Customer' | 'Supplier' | ''
  party_id?: number | null
  narration?: string
}) {
  const res = await api.post(`/banking/transactions/${id}/categorize/`, payload)
  return res.data as BankTransaction
}

// ─── GST ─────────────────────────────────────────────────────────────────────

export interface GSTR1Entry {
  id: number
  period: string
  location_id: number
  invoice_no: string
  invoice_date: string
  customer_gstin: string
  invoice_type: string
  invoice_type_display: string
  place_of_supply: string
  taxable_value: string
  cgst: string
  sgst: string
  igst: string
  cess: string
  total_gst: string
  hsn_code: string
  rate: string
  source_type: string
  version: number
  is_active: boolean
  original_invoice_no: string
  is_time_barred: boolean
  irn: string
  e_invoice_status: string
  created_at: string
}

export interface GSTR3BSummary {
  id: number
  period: string
  location_id: number
  outward_taxable: string
  outward_igst: string
  outward_cgst: string
  outward_sgst: string
  outward_zero_rated: string
  outward_exempt: string
  total_outward_gst: string
  itc_igst: string
  itc_cgst: string
  itc_sgst: string
  total_itc: string
  net_payable_igst: string
  net_payable_cgst: string
  net_payable_sgst: string
  total_net_payable: string
  status: string
  status_display: string
  filed_date: string | null
  created_at: string
  updated_at: string
}

export interface GSTR2BEntry {
  id: number
  period: string
  location_id: number
  supplier_gstin: string
  supplier_name: string
  invoice_no: string
  invoice_date: string
  place_of_supply: string
  taxable_value: string
  cgst: string
  sgst: string
  igst: string
  total_gst: string
  itc_eligible: boolean
  source_po_id: number | null
  match_status: string
  match_status_display: string
  created_at: string
}

export interface ITCReconciliationRow {
  id: number
  period: string
  location_id: number
  supplier_gstin: string
  books_taxable: string
  books_cgst: string
  books_sgst: string
  books_igst: string
  gstr2b_taxable: string
  gstr2b_cgst: string
  gstr2b_sgst: string
  gstr2b_igst: string
  status: string
  status_display: string
  action_taken: string
}

export interface HSNSummaryRow {
  hsn_code: string
  segment: string
  description: string
  uqc: string
  quantity: string
  taxable_value: string
  cgst: string
  sgst: string
  igst: string
  rate: string
  total_tax: string
}

export interface GSTComputation {
  period: string
  output_tax: {
    by_rate: { rate: string; taxable: string; cgst: string; sgst: string; igst: string }[]
    total_cgst: string
    total_sgst: string
    total_igst: string
  }
  credit_notes?: { taxable: string; cgst: string; sgst: string; igst: string }
  rcm_inward?: { taxable: string; cgst: string; sgst: string; igst: string }
  exempt_outward?: string
  input_tax: { taxable: string; cgst: string; sgst: string; igst: string }
  net_payable: { cgst: string; sgst: string; igst: string; total: string }
}

export interface PartyOutstandingRow {
  party_id: number
  party_name: string
  gstin?: string
  pan?: string
  state?: string
  msme_category?: string
  opening_balance: string
  invoices: string
  payments: string
  closing_balance: string
  aging_0_30: string
  aging_31_60: string
  aging_61_90: string
  aging_90_plus: string
}

export async function generateGSTR1(period: string, locationId: number) {
  const res = await api.post('/gst/gstr1/generate/', { period, location_id: locationId })
  return res.data
}

export async function getGSTR1Entries(params?: Record<string, string>) {
  const res = await api.get('/gst/gstr1/', { params })
  return res.data as GSTR1Entry[]
}

export async function getGSTR1HSNSummary(params?: Record<string, string>) {
  const res = await api.get('/gst/gstr1-hsn/', { params })
  return res.data as { id: number; hsn_code: string; description: string; quantity: string; taxable_value: string; cgst: string; sgst: string; igst: string; rate: string }[]
}

export async function generateGSTR3B(period: string, locationId: number) {
  const res = await api.post('/gst/gstr3b/generate/', { period, location_id: locationId })
  return res.data
}

export async function getGSTR3BSummaries(params?: Record<string, string>) {
  const res = await api.get('/gst/gstr3b/', { params })
  return res.data as { results: GSTR3BSummary[]; count: number }
}

export interface GstGrandSummarySlab {
  rate: string
  output: { taxable: string; cgst: string; sgst: string; igst: string; total_tax: string }
  input: { taxable: string; cgst: string; sgst: string; igst: string; total_tax: string }
}
export interface GstGrandSummary {
  period: string
  return_type: string
  business_name: string
  gstin: string
  location_id: number | null
  slabs: GstGrandSummarySlab[]
  output_totals: { taxable: string; cgst: string; sgst: string; igst: string; total_tax: string }
  input_totals: { taxable: string; cgst: string; sgst: string; igst: string; total_tax: string }
  net: {
    total_liability: string; total_itc: string
    net_cgst: string; net_sgst: string; net_igst: string
    net_payable: string; itc_carry_forward: string
    late_fee: string; interest: string
  }
}
export async function getGstGrandSummary(period: string) {
  const res = await api.get('/gst/grand-summary/', { params: { period } })
  return res.data as GstGrandSummary
}

export async function generateGSTR2B(period: string, locationId: number) {
  const res = await api.post('/gst/gstr2b/generate/', { period, location_id: locationId })
  return res.data
}

export async function getGSTR2BEntries(params?: Record<string, string>) {
  const res = await api.get('/gst/gstr2b/', { params })
  return res.data as GSTR2BEntry[]
}

export async function toggleGSTR2BITC(id: number) {
  const res = await api.patch(`/gst/gstr2b/${id}/toggle-itc/`)
  return res.data as GSTR2BEntry
}

export async function runITCReconciliation(period: string, locationId: number) {
  const res = await api.post('/gst/itc-reconciliation/run/', { period, location_id: locationId })
  return res.data
}

export async function getITCReconciliation(params?: Record<string, string>) {
  const res = await api.get('/gst/itc-reconciliation/', { params })
  return res.data as ITCReconciliationRow[]
}

export async function getGSTComputation(params?: Record<string, string>) {
  const res = await api.get('/reports/gst-computation/', { params })
  return res.data as GSTComputation
}

export async function getHSNSummary(params?: Record<string, string>) {
  const res = await api.get('/reports/hsn-summary/', { params })
  return res.data as {
    period: string; rows: HSNSummaryRow[]; total_taxable: string; total_tax: string
    segment_totals?: Record<string, { taxable: string; tax: string }>
  }
}

export interface GSTR1DocSummaryRow {
  nature: string
  series: string
  sr_from: string
  sr_to: string
  total_issued: number
  cancelled: number
  internal: number
  net_issued: number
}

export async function getGSTR1DocSummary(period: string) {
  const res = await api.get('/gst/gstr1/doc-summary/', { params: { period } })
  return res.data as { period: string; rows: GSTR1DocSummaryRow[] }
}

export interface FilingHealthSection {
  title: string
  severity: 'error' | 'warning' | 'info'
  status: 'ok' | 'unavailable'
  count: number
  rows: Record<string, string | number | null>[]
  note: string
}

export interface FilingHealthReport {
  period: string
  sections: Record<string, FilingHealthSection>
  total_issues: number
}

export async function getGSTFilingHealth(period: string) {
  const res = await api.get('/reports/gst-filing-health/', { params: { period } })
  return res.data as FilingHealthReport
}

export async function getPartyOutstanding(params?: Record<string, string>) {
  const res = await api.get('/reports/party-outstanding/', { params })
  return res.data as { party_type: string; as_of_date: string; rows: PartyOutstandingRow[]; total_outstanding: string }
}

// ─── TDS ─────────────────────────────────────────────────────────────────────

export interface TDSDeduction {
  id: number
  deductee_name: string
  deductee_pan: string
  section: string
  nature_of_payment: string
  transaction_date: string
  gross_amount: string
  tds_rate: string
  tds_amount: string
  deductee_type: string
  source_type: string
  status: string
  challan_no: string
  challan_date: string | null
  bsr_code: string
  location_id: number | null
  created_at: string
}

export interface TDSChallan {
  id: number
  challan_no: string
  bsr_code: string
  deposit_date: string
  period: string
  section: string
  total_tds_amount: string
  created_at: string
}

export interface TDSRateConfig {
  id: number
  section: string
  deductee_type: string
  rate: string
  threshold: string
  fy_start: string
  fy_end: string
  is_active: boolean
}

export async function getTDSDeductions(params?: Record<string, string>) {
  const res = await api.get('/tds/deductions/', { params })
  return res.data as { results: TDSDeduction[]; count: number }
}

export async function createTDSDeduction(data: Partial<TDSDeduction>) {
  const res = await api.post('/tds/deductions/', data)
  return res.data as TDSDeduction
}

export async function updateTDSDeduction(id: number, data: Partial<TDSDeduction>) {
  const res = await api.patch(`/tds/deductions/${id}/`, data)
  return res.data as TDSDeduction
}

export async function getTDSChallans(params?: Record<string, string>) {
  const res = await api.get('/tds/challans/', { params })
  return res.data as { results: TDSChallan[]; count: number }
}

export async function createTDSChallan(data: Partial<TDSChallan>) {
  const res = await api.post('/tds/challans/', data)
  return res.data as TDSChallan
}

export async function autoGenerateChallan(section: string, period: string) {
  const res = await api.post('/tds/challans/auto-generate/', { section, period })
  return res.data as TDSChallan
}

export async function getTDSRateConfigs() {
  const res = await api.get('/tds/rate-configs/')
  return res.data as TDSRateConfig[]
}

export async function updateTDSRateConfig(id: number, data: Partial<TDSRateConfig>) {
  const res = await api.patch(`/tds/rate-configs/${id}/`, data)
  return res.data as TDSRateConfig
}

export async function createTDSRateConfig(data: Partial<TDSRateConfig>) {
  const res = await api.post('/tds/rate-configs/', data)
  return res.data as TDSRateConfig
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface TrialBalanceRow {
  account_code: string
  account_name: string
  account_type: string
  debit: number | string
  credit: number | string
  balance: number | string
}

export interface PLRow {
  account_code: string
  account_name: string
  amount: number | string
}

export interface PLSection {
  items: PLRow[]
  total: string
}

export interface PLReport {
  revenue: PLSection
  direct_expenses: PLSection
  gross_profit: string
  indirect_expenses: PLSection
  other_expenses: PLSection
  net_profit: string
  start_date: string
  end_date: string
}

export interface BSSection {
  account_code: string
  account_name: string
  balance: number | string
}

export interface BSGroupSection {
  items: BSSection[]
  total: string
}

export interface BSReport {
  as_of_date: string
  assets: BSGroupSection
  liabilities: BSGroupSection
  equity: BSGroupSection
  total_liabilities_equity: string
  is_balanced: boolean
}

export interface ReceivablesAgingRow {
  customer_id: number
  customer_name: string
  gstin?: string
  pan?: string
  state?: string
  total_outstanding: string
  aging_0_30: string
  aging_31_60: string
  aging_61_90: string
  aging_90_plus: string
}

export interface PayablesAgingRow {
  supplier_id: number
  supplier_name: string
  gstin?: string
  pan?: string
  state?: string
  msme_category?: string
  msme_udyam_no?: string
  total_outstanding: string
  aging_0_30: string
  aging_31_60: string
  aging_61_90: string
  aging_90_plus: string
}

export interface LedgerRow {
  date: string
  entry_no: string
  narration: string
  voucher_type?: string
  reference_type?: string
  reference_id?: number | null
  debit: number | string
  credit: number | string
  balance: number | string
}

export interface LedgerReport {
  account: { code: string; name: string; type: string }
  opening_balance: string
  transactions: LedgerRow[]
  closing_balance: string
}

export async function getTrialBalance(params?: Record<string, string>) {
  const res = await api.get('/reports/trial-balance/', { params })
  return res.data as { rows: TrialBalanceRow[]; total_debit: number | string; total_credit: number | string }
}

export async function getProfitLoss(params?: Record<string, string>) {
  const res = await api.get('/reports/profit-loss/', { params })
  return res.data as PLReport
}

export async function getBalanceSheet(params?: Record<string, string>) {
  const res = await api.get('/reports/balance-sheet/', { params })
  return res.data as BSReport
}

export async function getLedger(params?: Record<string, string>) {
  const res = await api.get('/reports/ledger/', { params })
  return res.data as LedgerReport
}

/** DRF envelope returned by /reports/ledger/ when a `page` param is sent.
 *  `results` carries the period opening balance and the page's rows with
 *  running balances; `results.closing_balance` is the balance through the
 *  END OF THE PAGE (== the true closing only on the last page). */
export interface PaginatedLedgerReport {
  count: number
  next: string | null
  previous: string | null
  results: LedgerReport
}

export async function getLedgerPage(params?: Record<string, string>) {
  const res = await api.get('/reports/ledger/', { params })
  return res.data as PaginatedLedgerReport
}

export async function getReceivablesAging(params?: Record<string, string>) {
  const res = await api.get('/reports/receivables-aging/', { params })
  return res.data as { rows: ReceivablesAgingRow[]; total_outstanding: string }
}

export interface OpenPartyInvoice {
  invoice_no: string
  voucher_type: string
  date: string
  party_id: number
  party_name: string
  /** Original invoice amount. */
  amount: string
  /** Already settled via bill-wise AGAINST allocations. */
  paid_amount?: string
  /** Remaining balance = amount − paid_amount. */
  outstanding_amount?: string
  narration: string
  customer_outstanding?: string
  supplier_outstanding?: string
}
export type OpenCustomerInvoice = OpenPartyInvoice

export async function getOpenCustomerInvoices(params?: Record<string, string>) {
  const res = await api.get('/reports/open-customer-invoices/', { params })
  return res.data as {
    rows: OpenPartyInvoice[]
    total_invoices: number
    total_outstanding: string
    as_of_date: string
  }
}

export async function getOpenSupplierInvoices(params?: Record<string, string>) {
  const res = await api.get('/reports/open-supplier-invoices/', { params })
  return res.data as {
    rows: OpenPartyInvoice[]
    total_invoices: number
    total_outstanding: string
    as_of_date: string
  }
}

export async function getPayablesAging(params?: Record<string, string>) {
  const res = await api.get('/reports/payables-aging/', { params })
  return res.data as { rows: PayablesAgingRow[]; total_outstanding: string }
}

// ─── Payroll ────────────────────────────────────────────────────────────────

export interface Employee {
  id: number
  employee_code: string
  name: string
  pan: string
  bank_account_no: string
  bank_ifsc: string
  date_of_joining: string
  date_of_leaving: string | null
  is_active: boolean
  location_id: number | null
}

export interface SalaryStructureData {
  id: number
  employee: number
  employee_name: string
  basic_salary: string
  hra: string
  conveyance: string
  medical: string
  special_allowance: string
  pf_employee_pct: string
  pf_employer_pct: string
  esi_employee_pct: string
  esi_employer_pct: string
  professional_tax: string
  gross_salary: string
  effective_from: string
  is_active: boolean
}

export interface PayrollRunData {
  id: number
  period: string
  employee: number
  employee_name: string
  employee_code: string
  gross_salary: string
  basic: string
  hra: string
  net_salary: string
  pf_employee: string
  pf_employer: string
  esi_employee: string
  esi_employer: string
  professional_tax: string
  tds: string
  status: string
  journal_entry_no: string | null
  location_id: number | null
}

export async function getEmployees() {
  const res = await api.get('/payroll/employees/')
  return res.data as Employee[]
}

export async function createEmployee(data: Partial<Employee>) {
  const res = await api.post('/payroll/employees/', data)
  return res.data as Employee
}

export async function updateEmployee(id: number, data: Partial<Employee>) {
  const res = await api.patch(`/payroll/employees/${id}/`, data)
  return res.data as Employee
}

export async function deleteEmployee(id: number) {
  await api.delete(`/payroll/employees/${id}/`)
}

export async function getSalaryStructures(params?: Record<string, string>) {
  const res = await api.get('/payroll/salary-structures/', { params })
  return res.data as SalaryStructureData[]
}

export async function createSalaryStructure(data: Partial<SalaryStructureData>) {
  const res = await api.post('/payroll/salary-structures/', data)
  return res.data as SalaryStructureData
}

export async function updateSalaryStructure(id: number, data: Partial<SalaryStructureData>) {
  const res = await api.patch(`/payroll/salary-structures/${id}/`, data)
  return res.data as SalaryStructureData
}

export async function getPayrollRuns(params?: Record<string, string>) {
  const res = await api.get('/payroll/runs/', { params })
  return res.data as { results: PayrollRunData[]; count: number }
}

export async function processPayroll(period: string, locationId?: number | null) {
  const res = await api.post('/payroll/runs/process/', { period, location_id: locationId })
  return res.data as { detail: string; runs: PayrollRunData[] }
}

export async function markPayrollPaid(id: number) {
  const res = await api.post(`/payroll/runs/${id}/mark-paid/`)
  return res.data as PayrollRunData
}

// ─── Books ──────────────────────────────────────────────────────────────────

export interface BookTransaction {
  date: string
  entry_no: string
  narration: string
  voucher_type: string
  debit: string
  credit: string
  balance: string
}

export interface BookAccount {
  account_code: string
  account_name: string
  opening_balance: string
  transactions: BookTransaction[]
  closing_balance: string
}

export interface BookResponse {
  accounts: BookAccount[]
  summary: { total_debit: string; total_credit: string }
}

export async function getBankBook(params?: Record<string, string>) {
  const res = await api.get('/reports/bank-book/', { params })
  return res.data as BookResponse
}

export async function getCashBook(params?: Record<string, string>) {
  const res = await api.get('/reports/cash-book/', { params })
  return res.data as BookResponse
}

export interface DaybookEntry {
  id: number
  entry_no: string
  voucher_type: string
  narration: string
  reference_type?: string
  reference_id?: number | null
  lines: { account_code: string; account_name: string; debit: string; credit: string }[]
}

export interface DaybookDay {
  date: string
  entries: DaybookEntry[]
}

export interface DaybookResponse {
  start_date: string
  end_date: string
  days: DaybookDay[]
  summary: { total_entries: number; total_debit: string; total_credit: string }
}

export async function getDaybook(params?: Record<string, string>) {
  const res = await api.get('/reports/daybook/', { params })
  return res.data as DaybookResponse
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export interface SyncLog {
  id: number
  sync_type: string
  last_synced_at: string
  records_processed: number
  error_count: number
  /** Wall-clock duration of the most recent run, in seconds. */
  duration_seconds: string | null
  status: string
  error_message?: string
}

export interface SyncError {
  id: number
  sync_type: string
  source_id: number
  error_message: string
  traceback: string
  retry_count: number
  max_retries: number
  resolved: boolean
  created_at: string
  updated_at: string
}

export async function runSync() {
  const res = await api.post('/sync/run/')
  return res.data
}

export async function getSyncLogs(params?: { sync_type?: string }) {
  const res = await api.get('/sync/logs/', { params })
  return res.data as SyncLog[]
}

export async function retrySyncErrors() {
  const res = await api.post('/sync/retry/')
  return res.data
}

export async function getSyncErrors(params?: { status?: 'open' | 'resolved'; sync_type?: string }) {
  const res = await api.get('/sync/errors/', { params })
  return res.data as SyncError[]
}

export async function resolveSyncError(id: number) {
  const res = await api.post(`/sync/errors/${id}/resolve/`)
  return res.data as SyncError
}

export interface FullResyncPreview {
  dry_run: boolean
  would_delete_journals?: number
  would_reset_cursors?: number
  wiped_entries?: number
  resync?: Record<string, number>
}

export async function fullResyncDryRun() {
  const res = await api.get('/sync/full-resync/')
  return res.data as FullResyncPreview
}

export async function fullResyncConfirm() {
  const res = await api.post('/sync/full-resync/', { confirm: true })
  return res.data as FullResyncPreview
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface AccountingSettings {
  id?: number
  company_name: string
  gstin: string
  tan: string
  state_code: string
  pan: string
  registered_address: string
  /** Month the financial year starts, 1-12 (backend validates the range). */
  financial_year_start: number
  is_fy_closed: boolean
  last_closed_fy: string
}

export async function getSettings() {
  const res = await api.get('/accounts/settings/')
  return res.data as AccountingSettings
}

export async function updateSettings(data: Partial<AccountingSettings>) {
  const res = await api.patch('/accounts/settings/', data)
  return res.data as AccountingSettings
}

// ─── Per-location GST registrations ────────────────────────────────────────────

export interface LocationTaxProfile {
  location_id: number
  location_name: string
  /** Accounting-side override (blank for most stores). */
  gstin: string
  state_code: string
  legal_name: string
  has_profile: boolean
  /** Live GSTIN from the pharmacy store settings (blank when not set there). */
  pharma_gstin: string
  /** Where the effective GSTIN comes from. */
  source: 'override' | 'pharma' | 'unconfigured'
  /** True when an effective GSTIN exists (override or pharma). */
  configured: boolean
  /** What GST returns / e-invoices actually use. */
  effective_gstin: string
  effective_state_code: string
}

export interface LocationTaxProfilesResponse {
  company_gstin: string
  company_state_code: string
  company_name: string
  profiles: LocationTaxProfile[]
}

export async function getLocationTaxProfiles() {
  const res = await api.get('/accounts/location-tax-profiles/')
  return res.data as LocationTaxProfilesResponse
}

export async function saveLocationTaxProfile(data: {
  location_id: number
  gstin?: string
  state_code?: string
  legal_name?: string
}) {
  const res = await api.put('/accounts/location-tax-profiles/', data)
  return res.data as { id: number; location_id: number; gstin: string; state_code: string; legal_name: string }
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: number
  timestamp: string
  username: string | null
  action: string
  model_name: string
  object_id: string
  object_repr: string
  changes: Record<string, unknown> | null
  ip_address: string | null
  extra: Record<string, unknown> | null
}

export interface AuditLogParams {
  action?: string
  model_name?: string
  object_id?: string
  date_from?: string
  date_to?: string
  search?: string
  page?: number
}

export async function getAuditLogs(params: AuditLogParams = {}) {
  const res = await api.get('/audit/', { params })
  return res.data as { count: number; next: string | null; previous: string | null; results: AuditLog[] }
}

/** Download the (filtered) audit log as CSV. Uses the authed api client so the
 *  JWT header is sent, then triggers a browser download. */
export async function exportAuditLogsCsv(params: AuditLogParams = {}) {
  const res = await api.get('/audit/export-csv/', { params, responseType: 'blob' })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Stock / Inventory ──────────────────────────────────────────────────────

export interface StockMovementRow {
  product_id: number
  product_name: string
  hsn_code: string
  opening_qty: number
  inward_qty: number
  outward_qty: number
  closing_qty: number
}

export interface StockValuationRow {
  product_id: number
  product_name: string
  hsn_code: string
  closing_qty: number
  avg_rate: string
  value: string
}

export async function getStockMovement(params?: Record<string, string>) {
  const res = await api.get('/reports/stock-movement/', { params })
  return res.data as { start_date: string; end_date: string; rows: StockMovementRow[]; total_products: number }
}

export async function getStockValuation(params?: Record<string, string>) {
  const res = await api.get('/reports/stock-valuation/', { params })
  return res.data as { as_of_date: string; rows: StockValuationRow[]; total_products: number; total_value: string }
}

// ─── Wave 6 — Fixed Assets ──────────────────────────────────────────────────

export interface AssetClass {
  id: number
  code: string
  name: string
  description: string
  dep_method: 'SLM' | 'WDV'
  useful_life_years: number
  salvage_value_pct: string
  wdv_rate_pct: string
  asset_account: number
  asset_account_code?: string
  accum_dep_account: number
  accum_dep_account_code?: string
  dep_expense_account: number
  dep_expense_account_code?: string
}

export interface FixedAsset {
  id: number
  asset_no: string
  name: string
  description: string
  asset_class: number
  asset_class_name?: string
  location_id: number | null
  serial_no: string
  vendor_name: string
  vendor_id: number | null
  acquisition_date: string
  acquisition_cost: string
  salvage_value: string
  useful_life_months: number
  status: 'active' | 'disposed' | 'written_off'
  disposal_date: string | null
  disposal_proceeds: string | null
  gain_loss_on_disposal: string | null
  accumulated_depreciation?: string
  net_book_value?: string
  acquisition_entry_no?: string | null
  notes: string
  created_at: string
}

export async function listAssetClasses() {
  const res = await api.get('/fixed-assets/classes/')
  return res.data as AssetClass[]
}
export async function createAssetClass(data: Partial<AssetClass>) {
  const res = await api.post('/fixed-assets/classes/', data)
  return res.data as AssetClass
}
export async function listFixedAssets(params?: Record<string, string>) {
  const res = await api.get('/fixed-assets/assets/', { params })
  return res.data as { results?: FixedAsset[] } | FixedAsset[]
}
export async function getFixedAsset(id: number) {
  const res = await api.get(`/fixed-assets/assets/${id}/`)
  return res.data as FixedAsset
}
export async function createFixedAsset(data: Partial<FixedAsset>) {
  const res = await api.post('/fixed-assets/assets/', data)
  return res.data as FixedAsset
}
export async function postAssetAcquisition(id: number, payment_mode = 'bank') {
  const res = await api.post(`/fixed-assets/assets/${id}/post-acquisition/`,
                             { payment_mode })
  return res.data as FixedAsset
}
export async function disposeAsset(id: number, payload: { disposal_date: string; proceeds: string; mode?: string }) {
  const res = await api.post(`/fixed-assets/assets/${id}/dispose/`, payload)
  return res.data as FixedAsset
}
export async function previewDepreciation(period: string, location_id?: number) {
  const res = await api.get('/fixed-assets/depreciation/',
                            { params: { period, ...(location_id ? { location_id } : {}) } })
  return res.data as { period: string; rows: any[]; total: string }
}
export async function postDepreciation(period: string, location_id?: number) {
  const res = await api.post('/fixed-assets/depreciation/',
                             { period, ...(location_id ? { location_id } : {}) })
  return res.data as { period: string; posted: any[] }
}

// ─── Wave 6 — Loans & EMI ───────────────────────────────────────────────────

export interface Loan {
  id: number
  loan_no: string
  lender_name: string
  lender_id: number | null
  loan_type: 'term' | 'working_capital' | 'overdraft' | 'vehicle' | 'mortgage'
  principal_amount: string
  interest_rate_pct: string
  tenure_months: number
  start_date: string
  end_date: string
  emi_day: number
  emi_amount: string
  status: 'active' | 'closed' | 'written_off'
  liability_account: number
  liability_account_code?: string
  interest_expense_account: number
  interest_expense_account_code?: string
  outstanding_principal?: string
  disbursement_entry_no?: string | null
  notes: string
}

export interface EMIRow {
  id: number
  loan: number
  installment_no: number
  due_date: string
  principal: string
  interest: string
  total_emi?: string
  balance_principal: string
  status: 'pending' | 'paid' | 'overdue'
  paid_date: string | null
  entry_no?: string | null
}

export async function listLoans(params?: Record<string, string>) {
  const res = await api.get('/loans/loans/', { params })
  return res.data as { results?: Loan[] } | Loan[]
}
export async function createLoan(data: Partial<Loan>) {
  const res = await api.post('/loans/loans/', data)
  return res.data as Loan
}
export async function getLoanSchedule(id: number) {
  const res = await api.get(`/loans/loans/${id}/schedule/`)
  return res.data as { rows: EMIRow[]; count: number; outstanding_principal: string }
}
export async function disburseLoan(id: number, mode = 'bank') {
  const res = await api.post(`/loans/loans/${id}/post-disbursement/`, { mode })
  return res.data as Loan
}
export async function payEMI(emi_id: number, payment_date?: string, mode = 'bank') {
  const res = await api.post('/loans/emi/', { emi_id, payment_date, mode })
  return res.data as EMIRow
}

// ─── Wave 6 — Cheques ───────────────────────────────────────────────────────

export interface Cheque {
  id: number
  cheque_no: string
  kind: 'issued' | 'received'
  bank_account: number
  bank_account_name?: string
  cheque_date: string
  expected_clear_date: string | null
  amount: string
  party_type: string
  party_id: number | null
  party_name: string
  status: 'pending' | 'cleared' | 'bounced' | 'cancelled'
  bounce_reason: string
  bounce_charge: string | null
  is_pdc?: boolean
  entry_no?: string | null
  bounce_entry_no?: string | null
  bill_payment: number | null
  notes: string
}

export async function listCheques(params?: Record<string, string>) {
  const res = await api.get('/banking/cheques/', { params })
  return res.data as { results?: Cheque[] } | Cheque[]
}
export async function createCheque(data: Partial<Cheque>) {
  const res = await api.post('/banking/cheques/', data)
  return res.data as Cheque
}
export async function clearCheque(id: number) {
  const res = await api.post(`/banking/cheques/${id}/clear/`)
  return res.data as Cheque
}
export async function bounceCheque(id: number, reason: string, bank_charge?: string) {
  const res = await api.post(`/banking/cheques/${id}/bounce/`,
                             { reason, ...(bank_charge ? { bank_charge } : {}) })
  return res.data as Cheque
}

// ─── Wave 6 — Petty Cash ────────────────────────────────────────────────────

export interface PettyCashFloat {
  id: number
  location_id: number
  location_name: string
  chart_account: number
  chart_account_code?: string
  imprest_amount: string
  replenishment_threshold: string
  is_active: boolean
  custodian_name: string
  current_balance?: string
  needs_replenishment?: boolean
}

export interface PettyCashTxn {
  id: number
  float: number
  date: string
  kind: 'spend' | 'receipt'
  amount: string
  expense_account: number
  expense_account_code?: string
  description: string
  voucher_no: string
  entry_no?: string | null
}

export async function listPettyCashFloats() {
  const res = await api.get('/banking/petty-cash/')
  return res.data as { results?: PettyCashFloat[] } | PettyCashFloat[]
}
export async function createPettyCashFloat(data: Partial<PettyCashFloat>) {
  const res = await api.post('/banking/petty-cash/', data)
  return res.data as PettyCashFloat
}
export async function spendPettyCash(id: number, payload: { date: string; amount: string; expense_account: number; description: string; voucher_no?: string }) {
  const res = await api.post(`/banking/petty-cash/${id}/spend/`, payload)
  return res.data as PettyCashTxn
}
export async function replenishPettyCash(id: number, payload: { date: string; amount: string; source?: string }) {
  const res = await api.post(`/banking/petty-cash/${id}/replenish/`, payload)
  return res.data as PettyCashTxn
}
export async function getPettyCashTxns(id: number) {
  const res = await api.get(`/banking/petty-cash/${id}/transactions/`)
  return res.data as { rows: PettyCashTxn[]; count: number; current_balance: string }
}

// ─── Wave 6 — Notifications ─────────────────────────────────────────────────

export interface Notification {
  id: number
  user: number | null
  role_code: string
  kind: string
  title: string
  body: string
  priority: 'low' | 'normal' | 'high' | 'critical'
  link_url: string
  related_model: string
  related_id: number | null
  is_read: boolean
  read_at: string | null
  created_at: string
}

export async function listNotifications(params?: Record<string, string>) {
  const res = await api.get('/notifications/', { params })
  return res.data as { results?: Notification[] } | Notification[]
}
export async function getNotificationCounts() {
  const res = await api.get('/notifications/counts/')
  return res.data as { unread_total: number; by_priority: Record<string, number> }
}
export async function markNotificationRead(id: number) {
  const res = await api.post(`/notifications/${id}/read/`)
  return res.data as Notification
}
export async function markAllNotificationsRead() {
  const res = await api.post('/notifications/mark-all-read/')
  return res.data as { marked_read: number }
}

export interface NotificationKindPref {
  kind: string
  label: string
  muted: boolean
  preference_id: number | null
}

export async function listNotificationKindPrefs() {
  const res = await api.get('/notifications/preferences/all-kinds/')
  return res.data as NotificationKindPref[]
}

export async function setNotificationKindPref(kind: string, muted: boolean) {
  const res = await api.post('/notifications/preferences/set/', { kind, muted })
  return res.data
}

// ─── Wave 6 — Closing-entries wizard helpers ────────────────────────────────

export interface InventoryAdjustmentPayload {
  date: string
  location_id: number
  value: string
  adjustment_type?: 'shrinkage' | 'damage' | 'count_variance'
  itc_to_reverse?: string
  narration?: string
}
export async function postInventoryAdjustment(payload: InventoryAdjustmentPayload) {
  const res = await api.post('/journals/entries/inventory-adjustment/', payload)
  return res.data
}

export interface DrugExpiryPayload {
  date: string
  location_id: number
  value_at_cost: string
  itc_to_reverse?: string
  narration?: string
}
export async function postDrugExpiry(payload: DrugExpiryPayload) {
  const res = await api.post('/journals/entries/drug-expiry/', payload)
  return res.data
}

export interface StockTransferPayload {
  date: string
  value: string
  from_location_id: number
  to_location_id: number
  narration?: string
}
export async function postStockTransfer(payload: StockTransferPayload) {
  const res = await api.post('/journals/entries/stock-transfer/', payload)
  return res.data as { out_entry: any; in_entry: any }
}

export async function postBadDebtsProvision(payload: { as_of?: string; location_id?: number; narration?: string }) {
  const res = await api.post('/journals/entries/provision-bad-debts/', payload)
  return res.data
}

export async function autoCloseStockAllLocations(as_of?: string) {
  const res = await api.post('/journals/entries/auto-close-stock/',
                             as_of ? { as_of } : {})
  return res.data as {
    as_of: string
    created: { location_id: number; location_name: string; entry_no: string; value: string }[]
    skipped: { location_id: number; location_name: string; reason: string }[]
    errors: { location_id: number; location_name: string; error: string }[]
  }
}

// ─── Closing-Stock Reconciliation ───────────────────────────────────────────

export interface ClosingStockRecon {
  as_of: string
  books_closing_stock: string
  inventory_value: string
  variance: string
  recommended_jv_value: string
  note?: string
}

export async function getClosingStockRecon(params?: { as_of?: string }) {
  const res = await api.get('/reports/closing-stock-recon/', { params })
  return res.data as ClosingStockRecon
}

// ─── Tally: Cost Categories & Cost Centres ──────────────────────────────────

export interface CostCategory {
  id: number
  name: string
  description: string
  allocate_revenue: boolean
  allocate_non_revenue: boolean
  is_active: boolean
  centre_count?: number
}

export interface CostCentre {
  id: number
  name: string
  code: string
  category: number
  category_name?: string
  parent: number | null
  parent_name?: string | null
  location_id: number | null
  is_active: boolean
  description: string
}

export async function listCostCategories(params?: Record<string, string>) {
  const res = await api.get('/accounts/cost-categories/', { params })
  return res.data as CostCategory[]
}
export async function createCostCategory(data: Partial<CostCategory>) {
  const res = await api.post('/accounts/cost-categories/', data)
  return res.data as CostCategory
}
export async function updateCostCategory(id: number, data: Partial<CostCategory>) {
  const res = await api.patch(`/accounts/cost-categories/${id}/`, data)
  return res.data as CostCategory
}
export async function deleteCostCategory(id: number) {
  await api.delete(`/accounts/cost-categories/${id}/`)
}

export async function listCostCentres(params?: Record<string, string>) {
  const res = await api.get('/accounts/cost-centres/', { params })
  return res.data as CostCentre[]
}
export async function createCostCentre(data: Partial<CostCentre>) {
  const res = await api.post('/accounts/cost-centres/', data)
  return res.data as CostCentre
}
export async function updateCostCentre(id: number, data: Partial<CostCentre>) {
  const res = await api.patch(`/accounts/cost-centres/${id}/`, data)
  return res.data as CostCentre
}
export async function deleteCostCentre(id: number) {
  await api.delete(`/accounts/cost-centres/${id}/`)
}

// ─── Tally: Voucher-Type Profiles ───────────────────────────────────────────

export interface VoucherTypeProfile {
  id: number
  name: string
  base_type: string
  base_type_display?: string
  prefix: string
  numbering_method: 'AUTO' | 'MANUAL'
  restart_yearly: boolean
  default_narration: string
  is_active: boolean
}

export async function listVoucherTypeProfiles(params?: Record<string, string>) {
  const res = await api.get('/journals/voucher-types/', { params })
  return res.data as VoucherTypeProfile[]
}
export async function createVoucherTypeProfile(data: Partial<VoucherTypeProfile>) {
  const res = await api.post('/journals/voucher-types/', data)
  return res.data as VoucherTypeProfile
}
export async function updateVoucherTypeProfile(id: number, data: Partial<VoucherTypeProfile>) {
  const res = await api.patch(`/journals/voucher-types/${id}/`, data)
  return res.data as VoucherTypeProfile
}
export async function deleteVoucherTypeProfile(id: number) {
  await api.delete(`/journals/voucher-types/${id}/`)
}

// ─── Tally: Bill References (bill-wise allocations) ─────────────────────────

export type BillReferenceKind = 'NEW' | 'AGAINST' | 'ADVANCE' | 'ON_ACCOUNT'

export interface BillReference {
  id: number
  line: number
  kind: BillReferenceKind
  ref_no: string
  ref_date: string | null
  amount: string
  bill_id: number | null
  created_at: string
}

export async function listBillReferences(params?: Record<string, string>) {
  const res = await api.get('/journals/bill-references/', { params })
  return res.data as BillReference[]
}
export async function createBillReference(data: {
  line: number
  kind: BillReferenceKind
  ref_no?: string
  ref_date?: string | null
  amount: string
  bill_id?: number | null
}) {
  const res = await api.post('/journals/bill-references/', data)
  return res.data as BillReference
}
export async function deleteBillReference(id: number) {
  await api.delete(`/journals/bill-references/${id}/`)
}

export default api

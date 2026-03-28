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
  is_leaf: boolean
  description: string
  children?: Account[]
}

export async function getChartOfAccounts(params?: Record<string, string>) {
  const res = await api.get('/accounts/chart-of-accounts/', { params })
  return res.data as Account[]
}

export async function getAccountTree() {
  const res = await api.get('/accounts/chart-of-accounts/tree/')
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

// ─── Account Mappings ────────────────────────────────────────────────────────

export interface AccountMapping {
  id: number
  key: string
  account: number
  account_code: string
  account_name: string
}

export async function getAccountMappings() {
  const res = await api.get('/accounts/account-mappings/')
  return res.data as AccountMapping[]
}

export async function updateAccountMapping(id: number, data: { account: number }) {
  const res = await api.patch(`/accounts/account-mappings/${id}/`, data)
  return res.data as AccountMapping
}

export async function resetAccountMappings() {
  const res = await api.post('/accounts/account-mappings/reset/')
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
  monthly_data?: {
    month: string
    revenue: number
    expenses: number
  }[]
}

export async function getDashboard() {
  const res = await api.get('/accounts/dashboard/')
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
}

export interface JournalEntry {
  id: number
  entry_no: string
  date: string
  narration: string
  voucher_type: string
  reference_type: string
  reference_id: number | null
  is_posted: boolean
  lines: JournalLine[]
  created_at: string
}

export async function getJournalEntries(params?: Record<string, string>) {
  const res = await api.get('/journals/entries/', { params })
  return res.data as { results: JournalEntry[]; count: number }
}

export async function getJournalEntry(id: number) {
  const res = await api.get(`/journals/entries/${id}/`)
  return res.data as JournalEntry
}

export async function createJournalEntry(data: {
  date: string
  narration: string
  voucher_type: string
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
  input_tax: { taxable: string; cgst: string; sgst: string; igst: string }
  net_payable: { cgst: string; sgst: string; igst: string; total: string }
}

export interface PartyOutstandingRow {
  party_id: number
  party_name: string
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
  return res.data as { period: string; rows: HSNSummaryRow[]; total_taxable: string; total_tax: string }
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
  expenses: PLSection
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
  total_outstanding: string
  aging_0_30: string
  aging_31_60: string
  aging_61_90: string
  aging_90_plus: string
}

export interface PayablesAgingRow {
  supplier_id: number
  supplier_name: string
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
  debit: number | string
  credit: number | string
  balance: number | string
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
  return res.data as { rows: LedgerRow[] }
}

export async function getReceivablesAging(params?: Record<string, string>) {
  const res = await api.get('/reports/receivables-aging/', { params })
  return res.data as { rows: ReceivablesAgingRow[]; total_outstanding: string }
}

export async function getPayablesAging(params?: Record<string, string>) {
  const res = await api.get('/reports/payables-aging/', { params })
  return res.data as { rows: PayablesAgingRow[]; total_outstanding: string }
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export interface SyncLog {
  id: number
  sync_type: string
  last_synced_at: string
  records_processed: number
  status: string
  error_message?: string
}

export interface SyncError {
  id: number
  sync_type: string
  source_id: number
  error_message: string
  retry_count: number
  max_retries: number
  resolved: boolean
  created_at: string
}

export async function runSync() {
  const res = await api.post('/sync/run/')
  return res.data
}

export async function getSyncLogs() {
  const res = await api.get('/sync/logs/')
  return res.data as SyncLog[]
}

export async function retrySyncErrors() {
  const res = await api.post('/sync/retry/')
  return res.data
}

export async function getSyncErrors() {
  const res = await api.get('/sync/errors/')
  return res.data as SyncError[]
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
  financial_year_start: string
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

export default api

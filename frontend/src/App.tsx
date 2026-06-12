import { lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import Layout from './components/Layout'
import { LocationProvider } from './contexts/LocationContext'
// Static: the two screens on the critical login path. Everything else is
// route-lazy so the initial bundle stops shipping all ~60 pages (and big
// page-only deps — recharts is used by DashboardPage alone). The single
// Suspense boundary lives in Layout around the <Outlet/>.
import LoginPage from './pages/LoginPage'
import GatewayPage from './pages/GatewayPage'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const SetupChecklistPage = lazy(() => import('./pages/SetupChecklistPage'))
const CostCentresPage = lazy(() => import('./pages/CostCentresPage'))
const VoucherTypesPage = lazy(() => import('./pages/VoucherTypesPage'))
const ActivityMapPage = lazy(() => import('./pages/ActivityMapPage'))
const AccountsPage = lazy(() => import('./pages/AccountsPage'))
const JournalsPage = lazy(() => import('./pages/JournalsPage'))
const JournalEditorPage = lazy(() => import('./pages/journals/JournalEditorPage'))
const JournalDetailPage = lazy(() => import('./pages/journals/JournalDetailPage'))
const PaymentVoucherPage = lazy(() => import('./pages/vouchers/PaymentVoucherPage'))
const ReceiptVoucherPage = lazy(() => import('./pages/vouchers/ReceiptVoucherPage'))
const ContraVoucherPage = lazy(() => import('./pages/vouchers/ContraVoucherPage'))
const JournalVoucherPage = lazy(() => import('./pages/vouchers/JournalVoucherPage'))
const SalesVoucherPage = lazy(() => import('./pages/vouchers/SalesVoucherPage'))
const PurchaseVoucherPage = lazy(() => import('./pages/vouchers/PurchaseVoucherPage'))
const CreditNoteVoucherPage = lazy(() => import('./pages/vouchers/CreditNoteVoucherPage'))
const DebitNoteVoucherPage = lazy(() => import('./pages/vouchers/DebitNoteVoucherPage'))
const RecurringJournalsListPage = lazy(() => import('./pages/journals/RecurringJournalsListPage'))
const RecurringJournalEditorPage = lazy(() => import('./pages/journals/RecurringJournalEditorPage'))
const RecurringJournalDetailPage = lazy(() => import('./pages/journals/RecurringJournalDetailPage'))
const BillsListPage = lazy(() => import('./pages/bills/BillsListPage'))
const BillEditorPage = lazy(() => import('./pages/bills/BillEditorPage'))
const BillDetailPage = lazy(() => import('./pages/bills/BillDetailPage'))
const RecurringBillsListPage = lazy(() => import('./pages/bills/RecurringBillsListPage'))
const RecurringBillEditorPage = lazy(() => import('./pages/bills/RecurringBillEditorPage'))
const RecurringBillDetailPage = lazy(() => import('./pages/bills/RecurringBillDetailPage'))
const BankingPage = lazy(() => import('./pages/banking/BankingPage'))
const BankAccountPage = lazy(() => import('./pages/banking/BankAccountPage'))
const ExpensesListPage = lazy(() => import('./pages/expenses/ExpensesListPage'))
const ExpenseEditorPage = lazy(() => import('./pages/expenses/ExpenseEditorPage'))
const ExpenseDetailPage = lazy(() => import('./pages/expenses/ExpenseDetailPage'))
const ReceivablesPage = lazy(() => import('./pages/ReceivablesPage'))
const PayablesPage = lazy(() => import('./pages/PayablesPage'))
const GSTR1Page = lazy(() => import('./pages/gst/GSTR1Page'))
const GSTR2BPage = lazy(() => import('./pages/gst/GSTR2BPage'))
const GSTR3BPage = lazy(() => import('./pages/gst/GSTR3BPage'))
const GstGrandSummaryPage = lazy(() => import('./pages/gst/GstGrandSummaryPage'))
const ITCReconciliationPage = lazy(() => import('./pages/gst/ITCReconciliationPage'))
const GSTFilingHealthPage = lazy(() => import('./pages/gst/GSTFilingHealthPage'))
const TDSPage = lazy(() => import('./pages/TDSPage'))
const TrialBalancePage = lazy(() => import('./pages/reports/TrialBalancePage'))
const ProfitLossPage = lazy(() => import('./pages/reports/ProfitLossPage'))
const BalanceSheetPage = lazy(() => import('./pages/reports/BalanceSheetPage'))
const GSTComputationPage = lazy(() => import('./pages/reports/GSTComputationPage'))
const HSNSummaryPage = lazy(() => import('./pages/reports/HSNSummaryPage'))
const PartyOutstandingPage = lazy(() => import('./pages/reports/PartyOutstandingPage'))
const BankBookPage = lazy(() => import('./pages/reports/BankBookPage'))
const CashBookPage = lazy(() => import('./pages/reports/CashBookPage'))
const DaybookPage = lazy(() => import('./pages/reports/DaybookPage'))
const PayrollPage = lazy(() => import('./pages/PayrollPage'))
const StockSummaryPage = lazy(() => import('./pages/reports/StockSummaryPage'))
const LedgerPage = lazy(() => import('./pages/reports/LedgerPage'))
const SyncPage = lazy(() => import('./pages/SyncPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'))
const SuppliersListPage = lazy(() => import('./pages/parties/SuppliersListPage'))
const CustomersListPage = lazy(() => import('./pages/parties/CustomersListPage'))
const PartyDetailPage = lazy(() => import('./pages/parties/PartyDetailPage'))
const FixedAssetsPage = lazy(() => import('./pages/fixed-assets/FixedAssetsPage'))
const LoansPage = lazy(() => import('./pages/loans/LoansPage'))
const ChequesPage = lazy(() => import('./pages/banking/ChequesPage'))
const PettyCashPage = lazy(() => import('./pages/banking/PettyCashPage'))
const NotificationsPage = lazy(() => import('./pages/notifications/NotificationsPage'))
const ClosingEntriesPage = lazy(() => import('./pages/journals/ClosingEntriesPage'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token')
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <LocationProvider>
                <Layout />
              </LocationProvider>
            </ProtectedRoute>
          }
        >
          <Route index element={<GatewayPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="journals" element={<JournalsPage />} />
          <Route path="journals/new" element={<JournalEditorPage />} />
          <Route path="vouchers/payment" element={<PaymentVoucherPage />} />
          <Route path="vouchers/payment/:id/edit" element={<PaymentVoucherPage />} />
          <Route path="vouchers/receipt" element={<ReceiptVoucherPage />} />
          <Route path="vouchers/receipt/:id/edit" element={<ReceiptVoucherPage />} />
          <Route path="vouchers/contra" element={<ContraVoucherPage />} />
          <Route path="vouchers/contra/:id/edit" element={<ContraVoucherPage />} />
          <Route path="vouchers/journal" element={<JournalVoucherPage />} />
          <Route path="vouchers/journal/:id/edit" element={<JournalVoucherPage />} />
          <Route path="vouchers/sales" element={<SalesVoucherPage />} />
          <Route path="vouchers/sales/:id/edit" element={<SalesVoucherPage />} />
          <Route path="vouchers/purchase" element={<PurchaseVoucherPage />} />
          <Route path="vouchers/purchase/:id/edit" element={<PurchaseVoucherPage />} />
          <Route path="vouchers/credit-note" element={<CreditNoteVoucherPage />} />
          <Route path="vouchers/credit-note/:id/edit" element={<CreditNoteVoucherPage />} />
          <Route path="vouchers/debit-note" element={<DebitNoteVoucherPage />} />
          <Route path="vouchers/debit-note/:id/edit" element={<DebitNoteVoucherPage />} />
          <Route path="journals/recurring" element={<RecurringJournalsListPage />} />
          <Route path="journals/recurring/new" element={<RecurringJournalEditorPage />} />
          <Route path="journals/recurring/:id" element={<RecurringJournalDetailPage />} />
          <Route path="journals/recurring/:id/edit" element={<RecurringJournalEditorPage />} />
          <Route path="journals/:id" element={<JournalDetailPage />} />
          <Route path="journals/:id/edit" element={<JournalEditorPage />} />
          <Route path="bills" element={<BillsListPage />} />
          <Route path="bills/new" element={<BillEditorPage />} />
          <Route path="bills/recurring" element={<RecurringBillsListPage />} />
          <Route path="bills/recurring/new" element={<RecurringBillEditorPage />} />
          <Route path="bills/recurring/:id" element={<RecurringBillDetailPage />} />
          <Route path="bills/recurring/:id/edit" element={<RecurringBillEditorPage />} />
          <Route path="bills/:id" element={<BillDetailPage />} />
          <Route path="bills/:id/edit" element={<BillEditorPage />} />
          <Route path="banking" element={<BankingPage />} />
          <Route path="banking/:id" element={<BankAccountPage />} />
          <Route path="expenses" element={<ExpensesListPage />} />
          <Route path="expenses/new" element={<ExpenseEditorPage />} />
          <Route path="expenses/:id" element={<ExpenseDetailPage />} />
          <Route path="expenses/:id/edit" element={<ExpenseEditorPage />} />
          <Route path="receivables" element={<ReceivablesPage />} />
          <Route path="payables" element={<PayablesPage />} />
          <Route path="parties/suppliers" element={<SuppliersListPage />} />
          <Route path="parties/suppliers/:id" element={<PartyDetailPage partyType="Supplier" />} />
          <Route path="parties/customers" element={<CustomersListPage />} />
          <Route path="parties/customers/:id" element={<PartyDetailPage partyType="Customer" />} />
          <Route path="gst/gstr1" element={<GSTR1Page />} />
          <Route path="gst/gstr2b" element={<GSTR2BPage />} />
          <Route path="gst/gstr3b" element={<GSTR3BPage />} />
          <Route path="gst/grand-summary" element={<GstGrandSummaryPage />} />
          <Route path="gst/itc-reconciliation" element={<ITCReconciliationPage />} />
          <Route path="gst/filing-health" element={<GSTFilingHealthPage />} />
          <Route path="tds" element={<TDSPage />} />
          <Route path="reports/trial-balance" element={<TrialBalancePage />} />
          <Route path="reports/profit-loss" element={<ProfitLossPage />} />
          <Route path="reports/balance-sheet" element={<BalanceSheetPage />} />
          <Route path="reports/gst-computation" element={<GSTComputationPage />} />
          <Route path="reports/hsn-summary" element={<HSNSummaryPage />} />
          <Route path="reports/party-outstanding" element={<PartyOutstandingPage />} />
          <Route path="reports/bank-book" element={<BankBookPage />} />
          <Route path="reports/cash-book" element={<CashBookPage />} />
          <Route path="reports/daybook" element={<DaybookPage />} />
          <Route path="payroll" element={<PayrollPage />} />
          <Route path="reports/stock-summary" element={<StockSummaryPage />} />
          <Route path="reports/ledger/:code" element={<LedgerPage />} />
          <Route path="sync" element={<SyncPage />} />
          <Route path="audit" element={<AuditLogPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="setup" element={<SetupChecklistPage />} />
          <Route path="cost-centres" element={<CostCentresPage />} />
          <Route path="voucher-types" element={<VoucherTypesPage />} />
          <Route path="activity-map" element={<ActivityMapPage />} />
          {/* Wave 6 — new pages */}
          <Route path="fixed-assets" element={<FixedAssetsPage />} />
          <Route path="loans" element={<LoansPage />} />
          <Route path="banking/cheques" element={<ChequesPage />} />
          <Route path="banking/petty-cash" element={<PettyCashPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="journals/closing-entries" element={<ClosingEntriesPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

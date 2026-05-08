import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import Layout from './components/Layout'
import { LocationProvider } from './contexts/LocationContext'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import GatewayPage from './pages/GatewayPage'
import SetupChecklistPage from './pages/SetupChecklistPage'
import CostCentresPage from './pages/CostCentresPage'
import VoucherTypesPage from './pages/VoucherTypesPage'
import ActivityMapPage from './pages/ActivityMapPage'
import AccountsPage from './pages/AccountsPage'
import JournalsPage from './pages/JournalsPage'
import JournalEditorPage from './pages/journals/JournalEditorPage'
import JournalDetailPage from './pages/journals/JournalDetailPage'
import PaymentVoucherPage from './pages/vouchers/PaymentVoucherPage'
import ReceiptVoucherPage from './pages/vouchers/ReceiptVoucherPage'
import ContraVoucherPage from './pages/vouchers/ContraVoucherPage'
import JournalVoucherPage from './pages/vouchers/JournalVoucherPage'
import SalesVoucherPage from './pages/vouchers/SalesVoucherPage'
import PurchaseVoucherPage from './pages/vouchers/PurchaseVoucherPage'
import CreditNoteVoucherPage from './pages/vouchers/CreditNoteVoucherPage'
import DebitNoteVoucherPage from './pages/vouchers/DebitNoteVoucherPage'
import RecurringJournalsListPage from './pages/journals/RecurringJournalsListPage'
import RecurringJournalEditorPage from './pages/journals/RecurringJournalEditorPage'
import RecurringJournalDetailPage from './pages/journals/RecurringJournalDetailPage'
import BillsListPage from './pages/bills/BillsListPage'
import BillEditorPage from './pages/bills/BillEditorPage'
import BillDetailPage from './pages/bills/BillDetailPage'
import RecurringBillsListPage from './pages/bills/RecurringBillsListPage'
import RecurringBillEditorPage from './pages/bills/RecurringBillEditorPage'
import RecurringBillDetailPage from './pages/bills/RecurringBillDetailPage'
import BankingPage from './pages/banking/BankingPage'
import BankAccountPage from './pages/banking/BankAccountPage'
import ExpensesListPage from './pages/expenses/ExpensesListPage'
import ExpenseEditorPage from './pages/expenses/ExpenseEditorPage'
import ExpenseDetailPage from './pages/expenses/ExpenseDetailPage'
import ReceivablesPage from './pages/ReceivablesPage'
import PayablesPage from './pages/PayablesPage'
import GSTR1Page from './pages/gst/GSTR1Page'
import GSTR2BPage from './pages/gst/GSTR2BPage'
import GSTR3BPage from './pages/gst/GSTR3BPage'
import ITCReconciliationPage from './pages/gst/ITCReconciliationPage'
import TDSPage from './pages/TDSPage'
import TrialBalancePage from './pages/reports/TrialBalancePage'
import ProfitLossPage from './pages/reports/ProfitLossPage'
import BalanceSheetPage from './pages/reports/BalanceSheetPage'
import GSTComputationPage from './pages/reports/GSTComputationPage'
import HSNSummaryPage from './pages/reports/HSNSummaryPage'
import PartyOutstandingPage from './pages/reports/PartyOutstandingPage'
import BankBookPage from './pages/reports/BankBookPage'
import CashBookPage from './pages/reports/CashBookPage'
import DaybookPage from './pages/reports/DaybookPage'
import PayrollPage from './pages/PayrollPage'
import StockSummaryPage from './pages/reports/StockSummaryPage'
import SyncPage from './pages/SyncPage'
import SettingsPage from './pages/SettingsPage'
import AuditLogPage from './pages/AuditLogPage'
import SuppliersListPage from './pages/parties/SuppliersListPage'
import CustomersListPage from './pages/parties/CustomersListPage'
import PartyDetailPage from './pages/parties/PartyDetailPage'
import FixedAssetsPage from './pages/fixed-assets/FixedAssetsPage'
import LoansPage from './pages/loans/LoansPage'
import ChequesPage from './pages/banking/ChequesPage'
import PettyCashPage from './pages/banking/PettyCashPage'
import NotificationsPage from './pages/notifications/NotificationsPage'
import ClosingEntriesPage from './pages/journals/ClosingEntriesPage'

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
          <Route path="gst/itc-reconciliation" element={<ITCReconciliationPage />} />
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

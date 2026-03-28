import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import Layout from './components/Layout'
import { LocationProvider } from './contexts/LocationContext'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AccountsPage from './pages/AccountsPage'
import JournalsPage from './pages/JournalsPage'
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
import SyncPage from './pages/SyncPage'
import SettingsPage from './pages/SettingsPage'
import AuditLogPage from './pages/AuditLogPage'

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
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="journals" element={<JournalsPage />} />
          <Route path="receivables" element={<ReceivablesPage />} />
          <Route path="payables" element={<PayablesPage />} />
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
          <Route path="sync" element={<SyncPage />} />
          <Route path="audit" element={<AuditLogPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

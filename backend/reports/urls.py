from django.urls import path
from . import views

urlpatterns = [
    path('trial-balance/', views.TrialBalanceView.as_view(), name='trial-balance'),
    path('profit-loss/', views.ProfitLossView.as_view(), name='profit-loss'),
    path('balance-sheet/', views.BalanceSheetView.as_view(), name='balance-sheet'),
    path('ledger/', views.LedgerView.as_view(), name='ledger'),
    path('receivables-aging/', views.ReceivablesAgingView.as_view(), name='receivables-aging'),
    path('payables-aging/', views.PayablesAgingView.as_view(), name='payables-aging'),
    path('gst-computation/', views.GSTComputationView.as_view(), name='gst-computation'),
    path('hsn-summary/', views.HSNSummaryView.as_view(), name='hsn-summary'),
    path('party-outstanding/', views.PartyOutstandingView.as_view(), name='party-outstanding'),
]

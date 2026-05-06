from django.urls import path
from .views import AuditLogListView, AuditLogCSVExportView, AuditChainVerifyView

urlpatterns = [
    path('', AuditLogListView.as_view(), name='audit-log-list'),
    path('export-csv/', AuditLogCSVExportView.as_view(), name='audit-log-csv'),
    path('verify-chain/', AuditChainVerifyView.as_view(), name='audit-chain-verify'),
]

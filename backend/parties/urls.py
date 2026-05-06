from django.urls import path
from . import views

urlpatterns = [
    # Suppliers
    path('suppliers/', views.SuppliersListView.as_view(), name='parties-suppliers-list'),
    path('suppliers/<int:pk>/', views.SupplierDetailView.as_view(), name='parties-supplier-detail'),
    path('suppliers/<int:pk>/transactions/', views.SupplierTransactionsView.as_view(), name='parties-supplier-transactions'),
    path('suppliers/<int:pk>/statement/', views.SupplierStatementView.as_view(), name='parties-supplier-statement'),
    path('suppliers/<int:pk>/statement.csv', views.SupplierStatementCSVView.as_view(), name='parties-supplier-statement-csv'),
    path('suppliers/<int:pk>/communications/', views.SupplierCommunicationsView.as_view(), name='parties-supplier-comms'),
    path('suppliers/<int:pk>/opening-balance/', views.SupplierOpeningBalanceView.as_view(), name='parties-supplier-opening'),

    # Customers
    path('customers/', views.CustomersListView.as_view(), name='parties-customers-list'),
    path('customers/<int:pk>/', views.CustomerDetailView.as_view(), name='parties-customer-detail'),
    path('customers/<int:pk>/transactions/', views.CustomerTransactionsView.as_view(), name='parties-customer-transactions'),
    path('customers/<int:pk>/statement/', views.CustomerStatementView.as_view(), name='parties-customer-statement'),
    path('customers/<int:pk>/statement.csv', views.CustomerStatementCSVView.as_view(), name='parties-customer-statement-csv'),
    path('customers/<int:pk>/communications/', views.CustomerCommunicationsView.as_view(), name='parties-customer-comms'),
    path('customers/<int:pk>/opening-balance/', views.CustomerOpeningBalanceView.as_view(), name='parties-customer-opening'),

    # Single communication CRUD
    path('communications/<int:pk>/', views.CommunicationDetailView.as_view(), name='parties-comm-detail'),
]

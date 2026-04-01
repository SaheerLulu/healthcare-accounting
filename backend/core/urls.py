from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('chart-of-accounts', views.ChartOfAccountViewSet)
router.register('account-mappings', views.AccountMappingViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('settings/', views.AccountingSettingsView.as_view(), name='accounting-settings'),
    path('dashboard/', views.DashboardView.as_view(), name='dashboard'),
    path('user-locations/', views.UserLocationsView.as_view(), name='user-locations'),
    path('suppliers/', views.SuppliersListView.as_view(), name='suppliers-list'),
    path('customers/', views.CustomersListView.as_view(), name='customers-list'),
]

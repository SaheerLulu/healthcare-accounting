from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'deductions', views.TDSDeductionViewSet, basename='tds-deduction')
router.register(r'challans', views.TDSChallanViewSet, basename='tds-challan')
router.register(r'rate-configs', views.TDSRateConfigViewSet, basename='tds-rate-config')

urlpatterns = [
    path('', include(router.urls)),
]

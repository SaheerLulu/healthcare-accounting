from django.urls import path, include
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('bills', views.BillViewSet)
router.register('recurring', views.RecurringBillViewSet, basename='recurring-bill')
router.register('payments', views.BillPaymentDetailView, basename='bill-payment')
router.register('attachments', views.BillAttachmentDetailViewSet, basename='bill-attachment')

urlpatterns = [
    path('', include(router.urls)),
]

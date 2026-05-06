from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('accounts', views.BankAccountViewSet)
router.register('transactions', views.BankTransactionViewSet)
router.register('cheques', views.ChequeViewSet)
router.register('petty-cash', views.PettyCashFloatViewSet)

urlpatterns = [
    path('', include(router.urls)),
]

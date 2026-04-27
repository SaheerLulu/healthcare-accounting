from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('accounts', views.BankAccountViewSet)
router.register('transactions', views.BankTransactionViewSet)

urlpatterns = [
    path('', include(router.urls)),
]

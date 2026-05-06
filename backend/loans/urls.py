from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('loans', views.LoanViewSet)
router.register('emi', views.EMIPayView, basename='emi-pay')

urlpatterns = [path('', include(router.urls))]

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('budgets', views.BudgetViewSet)
router.register('variance', views.BudgetVarianceView, basename='budget-variance')

urlpatterns = [path('', include(router.urls))]

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('employees', views.EmployeeViewSet)
router.register('salary-structures', views.SalaryStructureViewSet)
router.register('runs', views.PayrollRunViewSet)

urlpatterns = [
    path('', include(router.urls)),
]

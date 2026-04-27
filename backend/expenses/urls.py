from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('expenses', views.ExpenseViewSet)
router.register('attachments', views.ExpenseAttachmentViewSet, basename='expense-attachment')

urlpatterns = [
    path('', include(router.urls)),
]

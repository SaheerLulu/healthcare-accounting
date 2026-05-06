from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('classes', views.AssetClassViewSet)
router.register('assets', views.FixedAssetViewSet)
router.register('depreciation', views.DepreciationRunView, basename='depreciation-run')

urlpatterns = [path('', include(router.urls))]

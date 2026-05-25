from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
# Register preferences BEFORE the '' prefix so its routes don't get
# shadowed by the catch-all notification viewset.
router.register('preferences', views.NotificationPreferenceViewSet,
                basename='notification-preference')
router.register('', views.NotificationViewSet, basename='notification')

urlpatterns = [path('', include(router.urls))]

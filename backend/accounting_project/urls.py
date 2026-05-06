"""
URL configuration for the accounting project.
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)

urlpatterns = [
    # Admin
    path('admin/', admin.site.urls),

    # Auth – JWT standard endpoints
    path('api/auth/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/token/verify/', TokenVerifyView.as_view(), name='token_verify'),

    # Application endpoints
    path('api/accounts/', include('core.urls')),
    path('api/journals/', include('journals.urls')),
    path('api/gst/', include('gst_returns.urls')),
    path('api/tds/', include('tds.urls')),
    path('api/reports/', include('reports.urls')),
    path('api/sync/', include('sync.urls')),
    path('api/audit/', include('audit.urls')),
    path('api/payroll/', include('payroll.urls')),
    path('api/parties/', include('parties.urls')),
    path('api/bills/', include('bills.urls')),
    path('api/banking/', include('banking.urls')),
    path('api/expenses/', include('expenses.urls')),
    path('api/fixed-assets/', include('fixed_assets.urls')),
    path('api/loans/', include('loans.urls')),
    path('api/notifications/', include('notifications.urls')),
    path('api/budgets/', include('budgets.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

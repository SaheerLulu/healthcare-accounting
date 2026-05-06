from django.urls import path
from . import views

urlpatterns = [
    path('run/', views.SyncRunView.as_view(), name='sync-run'),
    path('logs/', views.SyncLogListView.as_view(), name='sync-logs'),
    path('retry/', views.SyncRetryView.as_view(), name='sync-retry'),
    path('errors/', views.SyncErrorListView.as_view(), name='sync-errors'),
    path('full-resync/', views.FullResyncView.as_view(), name='sync-full-resync'),
]

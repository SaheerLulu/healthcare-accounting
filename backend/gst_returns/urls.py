from rest_framework.routers import DefaultRouter
from django.urls import path
from .views import (
    GSTR1EntryViewSet, GSTR1HSNSummaryViewSet, GSTR3BSummaryViewSet,
    GSTR2BEntryViewSet, ITCReconciliationViewSet, RCMEntryViewSet,
    GSTSetoffPreviewView, GSTR9View, GSTR9CView, GSTLateFeeView, EWayBillViewSet,
)
from .grand_summary import GSTGrandSummaryView
from .register_views import (
    B2BRegisterView, B2CSummaryView, CreditNoteRegisterView,
    GSTWorkingPapersView,
)

router = DefaultRouter()
router.register(r'gstr1', GSTR1EntryViewSet, basename='gstr1-entry')
router.register(r'gstr1-hsn', GSTR1HSNSummaryViewSet, basename='gstr1-hsn')
router.register(r'gstr3b', GSTR3BSummaryViewSet, basename='gstr3b-summary')
router.register(r'gstr2b', GSTR2BEntryViewSet, basename='gstr2b-entry')
router.register(r'itc-reconciliation', ITCReconciliationViewSet, basename='itc-reconciliation')
router.register(r'rcm', RCMEntryViewSet, basename='rcm-entry')
router.register(r'setoff-preview', GSTSetoffPreviewView, basename='gst-setoff-preview')
router.register(r'gstr9', GSTR9View, basename='gstr9-annual')
router.register(r'gstr9c', GSTR9CView, basename='gstr9c')
router.register(r'late-fee', GSTLateFeeView, basename='gst-late-fee')
router.register(r'eway-bills', EWayBillViewSet, basename='eway-bill')

urlpatterns = router.urls + [
    path('grand-summary/', GSTGrandSummaryView.as_view(), name='gst-grand-summary'),
    path('reports/b2b-register/', B2BRegisterView.as_view(),
         name='gst-b2b-register'),
    path('reports/b2c-summary/', B2CSummaryView.as_view(),
         name='gst-b2c-summary'),
    path('reports/credit-notes/', CreditNoteRegisterView.as_view(),
         name='gst-credit-note-register'),
    path('working-papers/', GSTWorkingPapersView.as_view(),
         name='gst-working-papers'),
]

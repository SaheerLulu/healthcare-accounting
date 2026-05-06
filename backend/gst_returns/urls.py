from rest_framework.routers import DefaultRouter
from .views import (
    GSTR1EntryViewSet, GSTR1HSNSummaryViewSet, GSTR3BSummaryViewSet,
    GSTR2BEntryViewSet, ITCReconciliationViewSet, RCMEntryViewSet,
    GSTSetoffPreviewView, GSTR9View, GSTR9CView, GSTLateFeeView, EWayBillViewSet,
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

urlpatterns = router.urls

from rest_framework.routers import DefaultRouter
from .views import (
    JournalEntryViewSet, RecurringJournalViewSet,
    BillReferenceViewSet, VoucherTypeProfileViewSet,
)

router = DefaultRouter()
router.register(r'entries', JournalEntryViewSet, basename='journal-entry')
router.register(r'recurring', RecurringJournalViewSet, basename='recurring-journal')
router.register(r'bill-references', BillReferenceViewSet, basename='bill-reference')
router.register(r'voucher-types', VoucherTypeProfileViewSet, basename='voucher-type-profile')

urlpatterns = router.urls

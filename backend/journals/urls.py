from rest_framework.routers import DefaultRouter
from .views import JournalEntryViewSet, RecurringJournalViewSet

router = DefaultRouter()
router.register(r'entries', JournalEntryViewSet, basename='journal-entry')
router.register(r'recurring', RecurringJournalViewSet, basename='recurring-journal')

urlpatterns = router.urls

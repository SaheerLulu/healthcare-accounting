from .middleware import resolve_active_location, _has_all_location_access


def get_active_location(request):
    location = getattr(request, 'active_location', None)
    if location is not None:
        return location

    # Lazy resolution for JWT-auth users (auth happens at DRF view level,
    # after middleware has already run).
    location = resolve_active_location(request)
    if location:
        request.active_location = location
        request.active_location_id = location.id
    return location


class LocationFilterMixin:
    """Filters querysets by the active location from X-Location-Id header."""

    location_field = 'location_id'

    def get_queryset(self):
        qs = super().get_queryset()
        location = get_active_location(self.request)

        if _has_all_location_access(self.request.user) and location is None:
            return qs

        if location:
            return qs.filter(**{self.location_field: location.id})

        return qs.none()

    def perform_create(self, serializer):
        location = get_active_location(self.request)
        if location and 'location_id' not in serializer.validated_data:
            serializer.save(location_id=location.id)
            return
        super().perform_create(serializer)

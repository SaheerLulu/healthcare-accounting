from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

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


def user_can_access_location(user, location_id):
    """True if `user` may read/write data scoped to `location_id`."""
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if _has_all_location_access(user):
        return True
    from inventory_reader.models import UserLocationAssignmentRO
    return UserLocationAssignmentRO.objects.filter(
        user_profile__user=user, location_id=location_id,
    ).exists()


def assert_location_access(request, location_id):
    """Refuse a client-supplied location_id the user is not assigned to.

    A None location_id is a no-op (caller decides whether 'unscoped' is
    allowed — see require_location_or_all_access for that case).
    """
    if location_id in (None, ''):
        return
    try:
        location_id = int(location_id)
    except (TypeError, ValueError):
        raise PermissionDenied('Invalid location_id.')
    if not user_can_access_location(getattr(request, 'user', None), location_id):
        raise PermissionDenied(
            f'You do not have access to location {location_id}.'
        )


def require_location_or_all_access(request):
    """Resolve the active location for report-style endpoints.

    Returns the active location, or None for admin/all-access users (the
    consolidated all-stores view). Regular users without a valid
    X-Location-Id header are refused instead of silently falling through
    to unscoped, all-location data.
    """
    location = get_active_location(request)
    if location is None and not _has_all_location_access(request.user):
        raise PermissionDenied(
            'A valid X-Location-Id header for a location you are assigned '
            'to is required.'
        )
    return location


class HasAllLocationAccess(BasePermission):
    """Allow only superusers / admin-role users (all-stores access).

    Used for global, cross-store operations such as the inventory full
    re-sync, which would otherwise let any store user rebuild every
    store's books.
    """

    message = 'Administrator (all-stores) access is required.'

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated and _has_all_location_access(user))


class LocationFilterMixin:
    """Filters querysets by the active location from X-Location-Id header."""

    location_field = 'location_id'

    def initial(self, request, *args, **kwargs):
        """Reject writes that carry a location_id the user is not assigned to.

        Enforced here (not in perform_create/perform_update) because many
        viewsets override those hooks for audit logging and would otherwise
        silently skip the check.
        """
        super().initial(request, *args, **kwargs)
        if request.method in ('POST', 'PUT', 'PATCH'):
            data = request.data
            if isinstance(data, dict) and data.get('location_id') not in (None, ''):
                assert_location_access(request, data.get('location_id'))

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
        supplied = serializer.validated_data.get('location_id')
        if supplied is not None:
            # Client-supplied location must be one the user can act on —
            # otherwise the body could bypass the X-Location-Id scoping.
            assert_location_access(self.request, supplied)
        if location and 'location_id' not in serializer.validated_data:
            serializer.save(location_id=location.id)
            return
        super().perform_create(serializer)

    def perform_update(self, serializer):
        supplied = serializer.validated_data.get('location_id')
        if supplied is not None:
            assert_location_access(self.request, supplied)
        super().perform_update(serializer)

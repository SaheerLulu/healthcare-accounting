from inventory_reader.models import LocationRO, UserProfileRO, UserLocationAssignmentRO


def _has_all_location_access(user):
    if user.is_superuser:
        return True
    try:
        profile = UserProfileRO.objects.select_related('role').get(user=user)
        return profile.role and profile.role.code == 'admin'
    except UserProfileRO.DoesNotExist:
        return False


def resolve_active_location(request):
    user = getattr(request, 'user', None)
    if not user or not user.is_authenticated:
        return None

    location_id = request.META.get('HTTP_X_LOCATION_ID')
    if not location_id:
        return None

    try:
        location_id = int(location_id)
    except (ValueError, TypeError):
        return None

    try:
        location = LocationRO.objects.get(pk=location_id)
    except LocationRO.DoesNotExist:
        return None

    if _has_all_location_access(user):
        return location

    has_access = UserLocationAssignmentRO.objects.filter(
        user_profile__user=user,
        location=location,
    ).exists()
    return location if has_access else None


class ActiveLocationMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.active_location = None
        request.active_location_id = None

        # Eager resolution for session-auth users.
        # JWT users are resolved lazily in get_active_location().
        user = getattr(request, 'user', None)
        if user and hasattr(user, 'is_authenticated') and user.is_authenticated:
            location = resolve_active_location(request)
            if location:
                request.active_location = location
                request.active_location_id = location.id

        return self.get_response(request)

from .models import AuditLog


def get_client_ip(request):
    if request is None:
        return None
    x_forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded:
        return x_forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def log_action(action, model_name, object_id, object_repr, user=None, request=None, changes=None, extra=None):
    """
    Create an AuditLog entry.

    action      – one of CREATE / UPDATE / DELETE / POST / REVERSE / GENERATE / SYNC
    model_name  – e.g. 'JournalEntry', 'ChartOfAccount'
    object_id   – str(pk) of the affected object
    object_repr – human-readable description, e.g. 'JV-2026-000001'
    user        – User instance or None
    request     – DRF/Django request (used to extract user + IP if not supplied)
    changes     – dict with before/after values for UPDATE actions
    extra       – any additional context dict
    """
    if user is None and request is not None and request.user.is_authenticated:
        user = request.user

    AuditLog.objects.create(
        user=user,
        action=action,
        model_name=model_name,
        object_id=str(object_id),
        object_repr=str(object_repr)[:500],
        changes=changes,
        ip_address=get_client_ip(request),
        extra=extra,
    )

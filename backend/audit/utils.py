import hashlib
import json

from .models import AuditLog


def _row_hash(prev_hash: str, payload: dict) -> str:
    """SHA-256 over (prev_hash || canonical-JSON(payload))."""
    body = json.dumps(payload, sort_keys=True, default=str, separators=(',', ':'))
    h = hashlib.sha256()
    h.update((prev_hash or '').encode())
    h.update(b'|')
    h.update(body.encode())
    return h.hexdigest()


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

    last = AuditLog.objects.order_by('-id').only('content_hash').first()
    prev_hash = last.content_hash if last else ''

    payload = {
        'user_id': user.id if user else None,
        'action': action,
        'model_name': model_name,
        'object_id': str(object_id),
        'object_repr': str(object_repr)[:500],
        'changes': changes,
        'ip_address': get_client_ip(request),
        'extra': extra,
    }
    content_hash = _row_hash(prev_hash, payload)

    AuditLog.objects.create(
        user=user,
        action=action,
        model_name=model_name,
        object_id=str(object_id),
        object_repr=str(object_repr)[:500],
        changes=changes,
        ip_address=get_client_ip(request),
        extra=extra,
        prev_hash=prev_hash,
        content_hash=content_hash,
    )


def verify_chain(start_id: int = 1, end_id: int = None):
    """
    Re-compute the hash chain and return the first row where it diverges
    (or None if the chain is intact). Use from a management shell to detect
    tampering: `from audit.utils import verify_chain; verify_chain()`.
    """
    qs = AuditLog.objects.order_by('id').only(
        'id', 'user_id', 'action', 'model_name', 'object_id', 'object_repr',
        'changes', 'ip_address', 'extra', 'prev_hash', 'content_hash',
    )
    if start_id:
        qs = qs.filter(id__gte=start_id)
    if end_id:
        qs = qs.filter(id__lte=end_id)

    expected_prev = ''
    for row in qs.iterator():
        if row.prev_hash != expected_prev:
            return {'broken_at': row.id, 'reason': 'prev_hash mismatch'}
        recalc = _row_hash(row.prev_hash, {
            'user_id': row.user_id,
            'action': row.action,
            'model_name': row.model_name,
            'object_id': row.object_id,
            'object_repr': row.object_repr,
            'changes': row.changes,
            'ip_address': row.ip_address,
            'extra': row.extra,
        })
        if recalc != row.content_hash:
            return {'broken_at': row.id, 'reason': 'content_hash mismatch'}
        expected_prev = row.content_hash
    return None

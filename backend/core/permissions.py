"""Function-level authorization for accounting capabilities (WP 610).

The JWT SECRET_KEY is shared with the inventory system, so *any*
authenticated inventory user (e.g. a cashier) holds a token this API
accepts. ``IsAuthenticated`` alone therefore says nothing about whether the
caller may post journals, close a fiscal year or remap the GL — that is
what the :class:`core.models.AccountingRole` capability flags encode.

``HasAccountingCapability`` enforces those flags on mutating requests:

- superusers always pass;
- users in any AccountingRole whose flag is True pass;
- everyone else gets a 403.

Read-only requests (``SAFE_METHODS``) are intentionally left to the
default ``IsAuthenticated`` policy — only writes are capability-gated.

Usage::

    class LockedPeriodViewSet(viewsets.ModelViewSet):
        permission_classes = [IsAuthenticated, HasAccountingCapability]
        required_capability = 'can_lock_period'

or, for a single @action on a viewset whose other writes stay open::

    @action(..., permission_classes=[IsAuthenticated,
                                     require_capability('can_post_journals')])
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import AccountingRole


class HasAccountingCapability(BasePermission):
    """Deny mutating requests unless the user holds the required capability.

    The capability flag is taken from ``self.required_capability`` (set by
    the :func:`require_capability` factory) or, failing that, from a
    ``required_capability`` attribute on the view.
    """

    message = 'You do not have the accounting permission required for this action.'

    required_capability = None

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        capability = self.required_capability or getattr(
            view, 'required_capability', None)
        if not capability:
            return True
        return AccountingRole.has_capability(request.user, capability)


def require_capability(capability: str):
    """Permission-class factory: ``require_capability('can_post_journals')``.

    Returns a HasAccountingCapability subclass bound to one flag, suitable
    for ``permission_classes`` lists (DRF instantiates the class itself).
    """
    return type(
        f'HasAccountingCapability__{capability}',
        (HasAccountingCapability,),
        {'required_capability': capability},
    )

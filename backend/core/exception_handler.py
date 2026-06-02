"""Project-wide DRF exception handler.

Django's own ``ValidationError`` (django.core.exceptions) is raised by model
``clean()``/``save()`` guards and by the period-lock check (``PeriodLockedError``
subclasses it). DRF's default handler does NOT recognise it — only its own
``rest_framework.exceptions.APIException`` family — so a Django ValidationError
raised below the serializer (in a service or model save) escaped as a raw HTTP
500 on perfectly ordinary operator actions: posting/reversing into a locked
period, clearing a party opening balance in a closed FY, a negative payroll
line, etc. Map it to a clean 400 carrying the real message so the frontend can
show the reason instead of a generic 'Server error'.

We deliberately do NOT blanket-convert ``ValueError`` here — an unexpected
ValueError is usually a real bug and should stay a 500. The few legitimate
value errors (e.g. an unconfigured AccountMapping key) are caught and re-raised
as Django ValidationError at their source, so they flow through this handler.
"""
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


def _as_detail(exc):
    """Normalise a Django ValidationError into a JSON-serialisable detail."""
    if hasattr(exc, 'message_dict'):
        return exc.message_dict
    if hasattr(exc, 'messages'):
        msgs = list(exc.messages)
        return msgs[0] if len(msgs) == 1 else msgs
    return str(exc)


def custom_exception_handler(exc, context):
    # Let DRF handle everything it knows about (APIException, Http404, …).
    response = drf_exception_handler(exc, context)
    if response is not None:
        return response

    # Translate Django's model/period-lock ValidationError into a 400.
    if isinstance(exc, DjangoValidationError):
        return Response({'detail': _as_detail(exc)}, status=status.HTTP_400_BAD_REQUEST)

    # Anything else stays unhandled → DRF/Django returns a 500 (correct: a
    # genuine server bug should not be masked as a client error).
    return None

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from audit.utils import log_action
from core.mixins import LocationFilterMixin

from .models import Expense, ExpenseAttachment
from .serializers import (
    ExpenseReadSerializer, ExpenseWriteSerializer, ExpenseAttachmentSerializer,
)
from . import services

ALLOWED_ATTACHMENT_TYPES = {
    'application/pdf',
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
}
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024


class ExpenseViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = Expense.objects.prefetch_related('items__account', 'attachments') \
        .select_related('paid_through_account', 'journal_entry', 'created_by')

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ExpenseWriteSerializer
        return ExpenseReadSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        s = params.get('status')
        if s:
            qs = qs.filter(status__in=[x.strip() for x in s.split(',') if x.strip()])

        if params.get('search'):
            from django.db.models import Q
            term = params['search']
            qs = qs.filter(
                Q(vendor_name__icontains=term) |
                Q(reference__icontains=term) |
                Q(notes__icontains=term)
            )
        if params.get('date_from'):
            qs = qs.filter(expense_date__gte=params['date_from'])
        if params.get('date_to'):
            qs = qs.filter(expense_date__lte=params['date_to'])
        if params.get('paid_through'):
            qs = qs.filter(paid_through_account_id=params['paid_through'])

        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'Expense', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'Expense', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        if instance.status != 'draft':
            from rest_framework.exceptions import ValidationError
            raise ValidationError('Reverse the expense before deleting it.')
        log_action('DELETE', 'Expense', instance.pk, str(instance), request=self.request)
        instance.delete()

    @action(detail=False, methods=['get'], url_path='counts')
    def counts(self, request):
        from django.db.models import Sum, Count
        qs = self.get_queryset()
        by_status = {row['status']: row['count']
                     for row in qs.values('status').annotate(count=Count('id'))}
        total = qs.aggregate(total=Sum('total_amount'))['total'] or 0
        return Response({
            'total': qs.count(),
            'by_status': by_status,
            'total_amount': str(total),
        })

    @action(detail=True, methods=['post'], url_path='record')
    def record(self, request, pk=None):
        expense = self.get_object()
        try:
            services.record_expense(expense, user=request.user if request.user.is_authenticated else None)
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0] if hasattr(e, 'messages') else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        log_action('POST', 'Expense', expense.pk, f"Recorded {expense}", request=request)
        return Response(ExpenseReadSerializer(expense, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='reverse')
    def reverse(self, request, pk=None):
        expense = self.get_object()
        try:
            services.reverse_expense(expense, user=request.user if request.user.is_authenticated else None)
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0] if hasattr(e, 'messages') else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        log_action('UPDATE', 'Expense', expense.pk, 'Reversed', request=request)
        return Response(ExpenseReadSerializer(expense, context={'request': request}).data)

    @action(
        detail=True, methods=['get', 'post'], url_path='attachments',
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def attachments(self, request, pk=None):
        expense = self.get_object()
        if request.method.lower() == 'get':
            ser = ExpenseAttachmentSerializer(
                expense.attachments.all(), many=True, context={'request': request})
            return Response({'rows': ser.data, 'count': expense.attachments.count()})

        upload = request.FILES.get('file')
        if not upload:
            return Response({'detail': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_ATTACHMENT_BYTES:
            return Response({'detail': 'File too large. Max 10 MB.'},
                            status=status.HTTP_400_BAD_REQUEST)
        ctype = (upload.content_type or '').lower()
        if ctype and ctype not in ALLOWED_ATTACHMENT_TYPES:
            return Response({'detail': f'Unsupported file type: {ctype}'},
                            status=status.HTTP_400_BAD_REQUEST)

        att = ExpenseAttachment.objects.create(
            expense=expense, file=upload,
            original_name=upload.name, content_type=ctype, size=upload.size,
            uploaded_by=request.user if request.user.is_authenticated else None,
        )
        log_action('CREATE', 'ExpenseAttachment', att.pk,
                   f"Uploaded {upload.name} on expense {expense.id}", request=request)
        return Response(ExpenseAttachmentSerializer(att, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)


class ExpenseAttachmentViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = ExpenseAttachment.objects.all()
    serializer_class = ExpenseAttachmentSerializer
    http_method_names = ['delete']
    location_field = 'expense__location_id'

    def perform_destroy(self, instance):
        log_action('DELETE', 'ExpenseAttachment', instance.pk,
                   f"Removed {instance.original_name}", request=self.request)
        if instance.file:
            instance.file.delete(save=False)
        instance.delete()

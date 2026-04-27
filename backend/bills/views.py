from datetime import date as date_cls

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from audit.utils import log_action
from core.mixins import LocationFilterMixin

from .models import Bill, BillPayment, BillAttachment, RecurringBill
from .serializers import (
    BillReadSerializer, BillWriteSerializer,
    BillPaymentSerializer, RecordPaymentSerializer,
    BillAttachmentSerializer,
    RecurringBillReadSerializer, RecurringBillWriteSerializer,
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
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # 10 MB


class BillViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    """Bills (vendor invoices for non-inventory expenses)."""

    queryset = Bill.objects.prefetch_related('lines__account', 'payments').select_related('journal_entry', 'created_by')

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return BillWriteSerializer
        return BillReadSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        status_filter = params.get('status')
        if status_filter:
            statuses = [s.strip() for s in status_filter.split(',') if s.strip()]
            qs = qs.filter(status__in=statuses)

        vendor_id = params.get('vendor_id')
        if vendor_id:
            qs = qs.filter(vendor_id=vendor_id)

        date_from = params.get('date_from')
        if date_from:
            qs = qs.filter(bill_date__gte=date_from)
        date_to = params.get('date_to')
        if date_to:
            qs = qs.filter(bill_date__lte=date_to)

        search = params.get('search')
        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(bill_no__icontains=search) |
                Q(vendor_name__icontains=search) |
                Q(notes__icontains=search)
            )

        overdue = params.get('overdue')
        if overdue == 'true':
            today = date_cls.today()
            qs = qs.filter(due_date__lt=today, status__in=['open', 'partially_paid'])

        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'Bill', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'Bill', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        if instance.status not in ('draft',):
            from rest_framework.exceptions import ValidationError
            raise ValidationError('Only draft bills can be deleted.')
        log_action('DELETE', 'Bill', instance.pk, str(instance), request=self.request)
        instance.delete()

    @action(detail=False, methods=['get'], url_path='counts')
    def counts(self, request):
        """Status counts + total outstanding for the pill UI."""
        from django.db.models import Sum, F, Q
        today = date_cls.today()
        qs = self.get_queryset()
        # Count by status
        from django.db.models import Count
        by_status = {row['status']: row['count']
                     for row in qs.values('status').annotate(count=Count('id'))}
        outstanding = qs.filter(status__in=['open', 'partially_paid']).aggregate(
            total=Sum(F('total_amount') - F('amount_paid')),
        )['total'] or 0
        overdue_count = qs.filter(
            due_date__lt=today, status__in=['open', 'partially_paid']
        ).count()
        return Response({
            'total': qs.count(),
            'by_status': by_status,
            'overdue': overdue_count,
            'outstanding': str(outstanding),
        })

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        """Post the bill to the books (creates the journal entry)."""
        bill = self.get_object()
        try:
            services.post_bill(bill, user=request.user if request.user.is_authenticated else None)
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0] if hasattr(e, 'messages') else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        log_action('POST', 'Bill', bill.pk, f"Approved bill {bill}", request=request)
        return Response(BillReadSerializer(bill).data)

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        """Cancel a bill (reverses the JE if posted)."""
        bill = self.get_object()
        try:
            services.cancel_bill(bill, user=request.user if request.user.is_authenticated else None)
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0] if hasattr(e, 'messages') else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        log_action('UPDATE', 'Bill', bill.pk, f"Cancelled bill {bill}", request=request)
        return Response(BillReadSerializer(bill).data)

    @action(detail=True, methods=['get', 'post'], url_path='payments')
    def payments(self, request, pk=None):
        """List or record a payment for this bill."""
        bill = self.get_object()
        if request.method.lower() == 'get':
            ser = BillPaymentSerializer(bill.payments.all(), many=True)
            return Response({'rows': ser.data, 'count': bill.payments.count()})

        ser = RecordPaymentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            payment = services.record_payment(
                bill,
                user=request.user if request.user.is_authenticated else None,
                **ser.validated_data,
            )
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0] if hasattr(e, 'messages') else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        log_action('CREATE', 'BillPayment', payment.pk,
                   f"Payment {payment.amount} for bill {bill}", request=request)
        return Response(BillReadSerializer(bill).data, status=status.HTTP_201_CREATED)


    @action(
        detail=True, methods=['get', 'post'], url_path='attachments',
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def attachments(self, request, pk=None):
        """List or upload an attachment file (bill PDF/image/etc)."""
        bill = self.get_object()
        if request.method.lower() == 'get':
            ser = BillAttachmentSerializer(
                bill.attachments.all(), many=True, context={'request': request},
            )
            return Response({'rows': ser.data, 'count': bill.attachments.count()})

        upload = request.FILES.get('file')
        if not upload:
            return Response({'detail': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_ATTACHMENT_BYTES:
            mb = MAX_ATTACHMENT_BYTES // (1024 * 1024)
            return Response({'detail': f'File too large. Max {mb} MB.'},
                            status=status.HTTP_400_BAD_REQUEST)
        ctype = (upload.content_type or '').lower()
        if ctype and ctype not in ALLOWED_ATTACHMENT_TYPES:
            return Response(
                {'detail': f'Unsupported file type: {ctype}. '
                           f'Allowed: PDF, images, common Office/text formats.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        attachment = BillAttachment.objects.create(
            bill=bill,
            file=upload,
            original_name=upload.name,
            content_type=ctype,
            size=upload.size,
            uploaded_by=request.user if request.user.is_authenticated else None,
        )
        log_action('CREATE', 'BillAttachment', attachment.pk,
                   f"Uploaded {upload.name} on bill {bill}", request=request)
        ser = BillAttachmentSerializer(attachment, context={'request': request})
        return Response(ser.data, status=status.HTTP_201_CREATED)


class BillAttachmentDetailViewSet(viewsets.ModelViewSet):
    """Delete a single attachment."""
    queryset = BillAttachment.objects.all()
    serializer_class = BillAttachmentSerializer
    http_method_names = ['delete']

    def perform_destroy(self, instance):
        log_action('DELETE', 'BillAttachment', instance.pk,
                   f"Removed {instance.original_name} from bill {instance.bill_id}",
                   request=self.request)
        # Remove the underlying file from storage too
        if instance.file:
            instance.file.delete(save=False)
        instance.delete()


class RecurringBillViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    """Recurring-bill templates that auto-generate Bills on a schedule."""
    queryset = RecurringBill.objects.prefetch_related('items__account').select_related('created_by')

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return RecurringBillWriteSerializer
        return RecurringBillReadSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        s = params.get('status')
        if s:
            qs = qs.filter(status__in=[x.strip() for x in s.split(',') if x.strip()])
        if params.get('search'):
            from django.db.models import Q
            term = params['search']
            qs = qs.filter(Q(profile_name__icontains=term) | Q(vendor_name__icontains=term))
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'RecurringBill', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'RecurringBill', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        log_action('DELETE', 'RecurringBill', instance.pk, str(instance), request=self.request)
        instance.delete()

    @action(detail=False, methods=['get'], url_path='counts')
    def counts(self, request):
        from django.db.models import Count
        qs = self.get_queryset()
        by_status = {row['status']: row['count']
                     for row in qs.values('status').annotate(count=Count('id'))}
        return Response({'total': qs.count(), 'by_status': by_status})

    @action(detail=True, methods=['post'], url_path='generate-now')
    def generate_now(self, request, pk=None):
        """Force-create one bill at the current next_run_date (for testing or backfill)."""
        rb = self.get_object()
        try:
            bill = services.generate_one(
                rb, user=request.user if request.user.is_authenticated else None,
            )
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0] if hasattr(e, 'messages') else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        log_action('CREATE', 'Bill', bill.pk, f'Generated from recurring {rb.id}', request=request)
        return Response({'bill_id': bill.id, 'bill_no': bill.bill_no,
                         'recurring': RecurringBillReadSerializer(rb).data},
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='pause')
    def pause(self, request, pk=None):
        rb = self.get_object()
        if rb.status == 'active':
            rb.status = 'paused'
            rb.save(update_fields=['status', 'updated_at'])
        return Response(RecurringBillReadSerializer(rb).data)

    @action(detail=True, methods=['post'], url_path='resume')
    def resume(self, request, pk=None):
        rb = self.get_object()
        if rb.status == 'paused':
            rb.status = 'active'
            rb.last_error = ''
            rb.save(update_fields=['status', 'last_error', 'updated_at'])
        return Response(RecurringBillReadSerializer(rb).data)

    @action(detail=True, methods=['post'], url_path='stop')
    def stop(self, request, pk=None):
        rb = self.get_object()
        rb.status = 'stopped'
        rb.save(update_fields=['status', 'updated_at'])
        return Response(RecurringBillReadSerializer(rb).data)

    @action(detail=False, methods=['post'], url_path='run-due')
    def run_due(self, request):
        """Run the cycle for any profile with next_run_date <= today (manual trigger)."""
        result = services.generate_due(
            user=request.user if request.user.is_authenticated else None,
        )
        log_action('CREATE', 'Bill', 'batch',
                   f"Recurring run: created {result['created']}, errors {len(result['errors'])}",
                   request=request, extra=result)
        return Response(result)


class BillPaymentDetailView(viewsets.ModelViewSet):
    """Single-payment delete (reverses the payment JE and rolls back amount_paid)."""
    queryset = BillPayment.objects.all()
    serializer_class = BillPaymentSerializer
    http_method_names = ['delete']

    def perform_destroy(self, instance):
        from django.db import transaction
        with transaction.atomic():
            bill = instance.bill
            # Reverse the payment JE if present
            if instance.journal_entry_id:
                from journals.models import JournalEntry, JournalEntryLine
                original = instance.journal_entry
                if original.is_posted:
                    reversal = JournalEntry.objects.create(
                        date=date_cls.today(),
                        narration=f"Reversal of payment {original.entry_no}",
                        voucher_type=original.voucher_type,
                        reference_type=original.reference_type,
                        location_id=original.location_id,
                        created_by=self.request.user if self.request.user.is_authenticated else None,
                    )
                    for line in original.lines.all():
                        JournalEntryLine.objects.create(
                            entry=reversal, account=line.account,
                            debit=line.credit, credit=line.debit,
                            narration=line.narration,
                            party_type=line.party_type, party_id=line.party_id,
                        )
                    reversal.post()
            # Roll back amount_paid + status
            bill.amount_paid = max((bill.amount_paid or 0) - instance.amount, 0)
            bill.status = bill.recalc_status()
            bill.save(update_fields=['amount_paid', 'status', 'updated_at'])
            log_action('DELETE', 'BillPayment', instance.pk,
                       f"Voided payment {instance.amount} on bill {bill}",
                       request=self.request)
            instance.delete()

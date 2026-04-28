import django_filters
from django.utils.dateparse import parse_date
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from .models import JournalEntry, JournalEntryLine, RecurringJournal
from .serializers import (
    JournalEntrySerializer,
    JournalEntryCreateSerializer,
    PaymentVoucherSerializer,
    ReceiptVoucherSerializer,
    ContraVoucherSerializer,
    RecurringJournalReadSerializer,
    RecurringJournalWriteSerializer,
)
from .services import (
    JournalAutoGenerationService,
    generate_one_recurring_journal, generate_due_recurring_journals,
)
from audit.utils import log_action
from core.mixins import LocationFilterMixin


class JournalEntryFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name='date', lookup_expr='gte')
    date_to = django_filters.DateFilter(field_name='date', lookup_expr='lte')
    voucher_type = django_filters.CharFilter(field_name='voucher_type')
    reference_type = django_filters.CharFilter(field_name='reference_type')
    is_posted = django_filters.BooleanFilter(field_name='is_posted')
    narration = django_filters.CharFilter(field_name='narration', lookup_expr='icontains')
    entry_no = django_filters.CharFilter(field_name='entry_no', lookup_expr='icontains')

    class Meta:
        model = JournalEntry
        fields = ['date_from', 'date_to', 'voucher_type', 'reference_type', 'is_posted', 'narration', 'entry_no']


class JournalEntryViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    """
    ViewSet for managing journal entries.

    list:   Filter by date_from, date_to, voucher_type, reference_type, location_id, is_posted.
    retrieve: Returns entry with all lines.
    create: Create a manual balanced journal entry with lines.
    update/partial_update: Only allowed if entry is not yet posted.
    post_entry: POST /{id}/post/ — posts the entry (validates balance first).
    reverse_entry: POST /{id}/reverse/ — creates a reversal entry with debits and credits swapped.
    """

    queryset = JournalEntry.objects.prefetch_related('lines__account').select_related('created_by')
    filterset_class = JournalEntryFilter
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.OrderingFilter]
    ordering_fields = ['date', 'created_at', 'entry_no']
    ordering = ['-date', '-created_at']

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return JournalEntryCreateSerializer
        return JournalEntrySerializer

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        qs = self.filter_queryset(self.get_queryset())
        if hasattr(response, 'data') and isinstance(response.data, dict):
            response.data['posted_count'] = qs.filter(is_posted=True).count()
            response.data['draft_count'] = qs.filter(is_posted=False).count()
        return response

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'JournalEntry', instance.pk, instance.entry_no, request=self.request)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_posted:
            raise ValidationError('Cannot edit a posted journal entry.')
        response = super().update(request, *args, **kwargs)
        log_action('UPDATE', 'JournalEntry', instance.pk, instance.entry_no, request=request)
        return response

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_posted:
            raise ValidationError('Cannot edit a posted journal entry.')
        response = super().partial_update(request, *args, **kwargs)
        log_action('UPDATE', 'JournalEntry', instance.pk, instance.entry_no, request=request)
        return response

    def perform_destroy(self, instance):
        log_action('DELETE', 'JournalEntry', instance.pk, instance.entry_no, request=self.request)
        instance.delete()

    @action(detail=True, methods=['post'], url_path='post')
    def post_entry(self, request, pk=None):
        """Post the journal entry after validating that it is balanced."""
        entry = self.get_object()
        if entry.is_posted:
            return Response(
                {'detail': 'Entry is already posted.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            entry.post()
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        log_action('POST', 'JournalEntry', entry.pk, entry.entry_no, request=request)
        serializer = JournalEntrySerializer(entry, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='reverse')
    def reverse_entry(self, request, pk=None):
        """
        Create a reversal journal entry: all debits and credits are swapped.
        The original entry must be posted before it can be reversed.
        """
        original = self.get_object()
        if not original.is_posted:
            return Response(
                {'detail': 'Only posted entries can be reversed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reversal_date = request.data.get('date')
        if reversal_date:
            reversal_date = parse_date(reversal_date)
        if not reversal_date:
            from django.utils import timezone
            reversal_date = timezone.now().date()

        reversal = JournalEntry.objects.create(
            date=reversal_date,
            narration=f"Reversal of {original.entry_no}: {original.narration}".strip(': '),
            voucher_type=original.voucher_type,
            reference_type=original.reference_type,
            reference_id=original.reference_id,
            location_id=original.location_id,
            created_by=request.user if request.user.is_authenticated else None,
        )

        for line in original.lines.all():
            JournalEntryLine.objects.create(
                entry=reversal,
                account=line.account,
                debit=line.credit,   # swap
                credit=line.debit,   # swap
                narration=line.narration,
                party_type=line.party_type,
                party_id=line.party_id,
            )

        try:
            reversal.post()
        except Exception as exc:
            reversal.delete()
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        log_action(
            'REVERSE', 'JournalEntry', original.pk, original.entry_no,
            request=request,
            extra={'reversal_entry_no': reversal.entry_no},
        )
        serializer = JournalEntrySerializer(reversal, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='payment')
    def create_payment(self, request):
        """Create a payment voucher: Debit Payables, Credit Bank/Cash."""
        ser = PaymentVoucherSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            svc = JournalAutoGenerationService()
            entry = svc.generate_payment(ser.validated_data)
            log_action('CREATE', 'JournalEntry', entry.pk, entry.entry_no,
                       request=request, extra={'voucher_type': 'PAYMENT'})
            return Response(JournalEntrySerializer(entry, context={'request': request}).data,
                            status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='receipt')
    def create_receipt(self, request):
        """Create a receipt voucher: Debit Bank/Cash, Credit Receivables."""
        ser = ReceiptVoucherSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            svc = JournalAutoGenerationService()
            entry = svc.generate_receipt(ser.validated_data)
            log_action('CREATE', 'JournalEntry', entry.pk, entry.entry_no,
                       request=request, extra={'voucher_type': 'RECEIPT'})
            return Response(JournalEntrySerializer(entry, context={'request': request}).data,
                            status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='contra')
    def create_contra(self, request):
        """Create a contra voucher: Transfer between Bank and Cash."""
        ser = ContraVoucherSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            svc = JournalAutoGenerationService()
            entry = svc.generate_contra(ser.validated_data)
            log_action('CREATE', 'JournalEntry', entry.pk, entry.entry_no,
                       request=request, extra={'voucher_type': 'CONTRA'})
            return Response(JournalEntrySerializer(entry, context={'request': request}).data,
                            status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class RecurringJournalViewSet(viewsets.ModelViewSet):
    """Recurring journal-entry templates that auto-generate JEs on a schedule."""
    queryset = RecurringJournal.objects.prefetch_related('lines__account').select_related('created_by')

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return RecurringJournalWriteSerializer
        return RecurringJournalReadSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        s = params.get('status')
        if s:
            qs = qs.filter(status__in=[x.strip() for x in s.split(',') if x.strip()])
        if params.get('search'):
            from django.db.models import Q
            term = params['search']
            qs = qs.filter(Q(profile_name__icontains=term) | Q(narration_template__icontains=term))
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'RecurringJournal', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'RecurringJournal', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        log_action('DELETE', 'RecurringJournal', instance.pk, str(instance), request=self.request)
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
        rj = self.get_object()
        from django.core.exceptions import ValidationError
        try:
            entry = generate_one_recurring_journal(
                rj, user=request.user if request.user.is_authenticated else None,
            )
        except ValidationError as e:
            return Response({'detail': e.messages[0] if hasattr(e, 'messages') else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        log_action('CREATE', 'JournalEntry', entry.pk,
                   f'Generated from recurring journal {rj.id}', request=request)
        return Response({
            'entry_id': entry.id, 'entry_no': entry.entry_no,
            'recurring': RecurringJournalReadSerializer(rj).data,
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='pause')
    def pause(self, request, pk=None):
        rj = self.get_object()
        if rj.status == 'active':
            rj.status = 'paused'
            rj.save(update_fields=['status', 'updated_at'])
        return Response(RecurringJournalReadSerializer(rj).data)

    @action(detail=True, methods=['post'], url_path='resume')
    def resume(self, request, pk=None):
        rj = self.get_object()
        if rj.status == 'paused':
            rj.status = 'active'
            rj.last_error = ''
            rj.save(update_fields=['status', 'last_error', 'updated_at'])
        return Response(RecurringJournalReadSerializer(rj).data)

    @action(detail=True, methods=['post'], url_path='stop')
    def stop(self, request, pk=None):
        rj = self.get_object()
        rj.status = 'stopped'
        rj.save(update_fields=['status', 'updated_at'])
        return Response(RecurringJournalReadSerializer(rj).data)

    @action(detail=False, methods=['post'], url_path='run-due')
    def run_due(self, request):
        result = generate_due_recurring_journals(
            user=request.user if request.user.is_authenticated else None,
        )
        log_action('CREATE', 'JournalEntry', 'batch',
                   f"Recurring-journal run: created {result['created']}, errors {len(result['errors'])}",
                   request=request, extra=result)
        return Response(result)

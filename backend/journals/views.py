import django_filters
from django.utils.dateparse import parse_date
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from .models import JournalEntry, JournalEntryLine, RecurringJournal, BillReference, VoucherTypeProfile
from .serializers import (
    JournalEntrySerializer,
    JournalEntryCreateSerializer,
    PaymentVoucherSerializer,
    ReceiptVoucherSerializer,
    ContraVoucherSerializer,
    RecurringJournalReadSerializer,
    RecurringJournalWriteSerializer,
    BillReferenceSerializer,
    VoucherTypeProfileSerializer,
)
from .services import (
    JournalAutoGenerationService,
    generate_one_recurring_journal, generate_due_recurring_journals,
)
from audit.utils import log_action
from core.mixins import LocationFilterMixin, get_active_location


class JournalEntryFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name='date', lookup_expr='gte')
    date_to = django_filters.DateFilter(field_name='date', lookup_expr='lte')
    voucher_type = django_filters.CharFilter(field_name='voucher_type')
    reference_type = django_filters.CharFilter(field_name='reference_type')
    is_posted = django_filters.BooleanFilter(field_name='is_posted')
    narration = django_filters.CharFilter(field_name='narration', lookup_expr='icontains')
    entry_no = django_filters.CharFilter(field_name='entry_no', lookup_expr='icontains')
    # WP 619 — extra filters
    account = django_filters.NumberFilter(method='filter_account')
    party_type = django_filters.CharFilter(method='filter_party')
    party_id = django_filters.NumberFilter(method='filter_party_id')
    amount_min = django_filters.NumberFilter(method='filter_amount_min')
    amount_max = django_filters.NumberFilter(method='filter_amount_max')
    cost_center = django_filters.CharFilter(field_name='cost_center')

    class Meta:
        model = JournalEntry
        fields = ['date_from', 'date_to', 'voucher_type', 'reference_type', 'is_posted',
                  'narration', 'entry_no', 'account', 'party_type', 'party_id',
                  'amount_min', 'amount_max', 'cost_center']

    def filter_account(self, qs, name, value):
        return qs.filter(lines__account_id=value).distinct()

    def filter_party(self, qs, name, value):
        return qs.filter(lines__party_type=value).distinct()

    def filter_party_id(self, qs, name, value):
        return qs.filter(lines__party_id=value).distinct()

    def filter_amount_min(self, qs, name, value):
        from django.db.models import Sum
        return qs.annotate(_total=Sum('lines__debit')).filter(_total__gte=value)

    def filter_amount_max(self, qs, name, value):
        from django.db.models import Sum
        return qs.annotate(_total=Sum('lines__debit')).filter(_total__lte=value)


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
        Reversal date cannot fall in a locked period.
        Each posted entry can be reversed at most once — re-reversing a
        reversal would just create unbounded ping-pong; reverse the reversal
        if you really need to undo the undo.
        """
        original = self.get_object()
        if not original.is_posted:
            return Response(
                {'detail': 'Only posted entries can be reversed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Reverse-once: refuse if a reversal already exists for this entry
        if hasattr(original, 'reversal_entry'):
            return Response(
                {'detail': f'This entry was already reversed by '
                           f'{original.reversal_entry.entry_no}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reversal_date = request.data.get('date')
        if reversal_date:
            reversal_date = parse_date(reversal_date)
        if not reversal_date:
            from django.utils import timezone
            reversal_date = timezone.now().date()

        from core.period_lock import assert_unlocked, PeriodLockedError
        try:
            assert_unlocked(reversal_date)
        except PeriodLockedError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        reversal = JournalEntry.objects.create(
            date=reversal_date,
            narration=f"Reversal of {original.entry_no}: {original.narration}".strip(': '),
            voucher_type=original.voucher_type,
            reference_type=original.reference_type,
            reference_id=original.reference_id,
            location_id=original.location_id,
            reversal_of=original,
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

        # Voiding a payment must release its bill-wise allocations so the
        # settled invoices re-open (the reversal posts a NEW entry rather than
        # deleting lines, so CASCADE never fires — do it explicitly here).
        from .models import BillReference
        freed = list(BillReference.objects.filter(line__entry=original))
        for ref in freed:
            log_action('DELETE', 'BillReference', ref.pk, str(ref), request=request)
        BillReference.objects.filter(line__entry=original).delete()

        log_action(
            'REVERSE', 'JournalEntry', original.pk, original.entry_no,
            request=request,
            extra={'reversal_entry_no': reversal.entry_no,
                   'released_allocations': len(freed)},
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

    @action(detail=False, methods=['post'], url_path='provision-bad-debts')
    def provision_bad_debts(self, request):
        """Post the provision-for-doubtful-debts adjustment for `as_of` date."""
        from datetime import date as _d
        from .bad_debts import post_provision_adjustment
        from core.mixins import get_active_location
        try:
            as_of = (_d.fromisoformat(request.data['as_of'])
                     if request.data.get('as_of') else _d.today())
            loc = get_active_location(request)
            result = post_provision_adjustment(
                as_of=as_of,
                location_id=request.data.get('location_id') or (loc.id if loc else None),
                narration=request.data.get('narration', ''),
                user=request.user if request.user.is_authenticated else None,
            )
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('GENERATE', 'JournalEntry', 'bad-debts',
                   f"Bad debt provision as of {as_of}", request=request,
                   extra={'adjustment': result.get('adjustment')})
        return Response(result)

    @action(detail=False, methods=['get'], url_path='sequence-audit')
    def sequence_audit(self, request):
        """Detect gaps in JV-YYYY-NNNNNN sequence — gap-free numbering is an audit requirement."""
        year = request.query_params.get('year')
        if not year:
            return Response({'detail': 'year required'}, status=400)
        prefix = f'JV-{year}-'
        nums = sorted(
            int(en.split('-')[-1])
            for en in JournalEntry.objects.filter(entry_no__startswith=prefix)
            .values_list('entry_no', flat=True)
        )
        if not nums:
            return Response({'year': year, 'count': 0, 'gaps': [],
                             'note': 'No entries found.'})
        gaps = []
        for i, n in enumerate(nums):
            expected = nums[0] + i
            if n != expected:
                gaps.append({'expected': expected, 'found': n})
        return Response({
            'year': year, 'first': nums[0], 'last': nums[-1],
            'count': len(nums), 'expected_count': nums[-1] - nums[0] + 1,
            'gap_count': len(gaps), 'gaps': gaps[:200],
        })


    @action(detail=False, methods=['post'], url_path='inventory-adjustment')
    def inventory_adjustment(self, request):
        """Post a shrinkage / damage / count-variance JV with §17(5)(h) ITC reversal."""
        from decimal import Decimal as _D
        try:
            svc = JournalAutoGenerationService()
            entry = svc.post_inventory_adjustment(
                date=request.data.get('date'),
                location_id=request.data.get('location_id'),
                value=_D(str(request.data.get('value', '0'))),
                adjustment_type=request.data.get('adjustment_type', 'shrinkage'),
                itc_to_reverse=_D(str(request.data.get('itc_to_reverse', '0'))),
                narration=request.data.get('narration', ''),
                user=request.user if request.user.is_authenticated else None,
            )
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('CREATE', 'JournalEntry', entry.pk, entry.entry_no,
                   request=request, extra={'voucher_type': 'INV_ADJ'})
        return Response(JournalEntrySerializer(entry, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='drug-expiry')
    def drug_expiry(self, request):
        """Pharmacy-specific expired-stock write-off with ITC reversal."""
        from decimal import Decimal as _D
        try:
            svc = JournalAutoGenerationService()
            entry = svc.post_drug_expiry_writeoff(
                date=request.data.get('date'),
                location_id=request.data.get('location_id'),
                value_at_cost=_D(str(request.data.get('value_at_cost', '0'))),
                itc_to_reverse=_D(str(request.data.get('itc_to_reverse', '0'))),
                narration=request.data.get('narration', ''),
                user=request.user if request.user.is_authenticated else None,
            )
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('CREATE', 'JournalEntry', entry.pk, entry.entry_no,
                   request=request, extra={'voucher_type': 'EXPIRY'})
        return Response(JournalEntrySerializer(entry, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='stock-transfer')
    def stock_transfer(self, request):
        """Inter-branch stock-in-transit JE pair."""
        from decimal import Decimal as _D
        try:
            svc = JournalAutoGenerationService()
            res = svc.post_stock_transfer(
                date=request.data.get('date'),
                value=_D(str(request.data.get('value', '0'))),
                from_location_id=int(request.data['from_location_id']),
                to_location_id=int(request.data['to_location_id']),
                narration=request.data.get('narration', ''),
                user=request.user if request.user.is_authenticated else None,
            )
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('CREATE', 'JournalEntry', 'transfer-pair',
                   f'Stock transfer {res["out_entry"].entry_no} ↔ '
                   f'{res["in_entry"].entry_no}', request=request)
        return Response({
            'out_entry': JournalEntrySerializer(res['out_entry'],
                                                context={'request': request}).data,
            'in_entry': JournalEntrySerializer(res['in_entry'],
                                               context={'request': request}).data,
        }, status=status.HTTP_201_CREATED)

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


class RecurringJournalViewSet(LocationFilterMixin, viewsets.ModelViewSet):
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
        # Stamp the active store so the template (and every JE it generates)
        # stays store-scoped. Explicit location_id in the payload wins.
        location = get_active_location(self.request)
        extra = {}
        if location and serializer.validated_data.get('location_id') is None:
            extra['location_id'] = location.id
        instance = serializer.save(**extra)
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
        # Manual trigger honours the active store; the cron command (no
        # request) still runs every store's due templates.
        location = get_active_location(request)
        result = generate_due_recurring_journals(
            user=request.user if request.user.is_authenticated else None,
            location_id=location.id if location else None,
        )
        log_action('CREATE', 'JournalEntry', 'batch',
                   f"Recurring-journal run: created {result['created']}, errors {len(result['errors'])}",
                   request=request, extra=result)
        return Response(result)


# ─── Bill References ────────────────────────────────────────────────────────


class BillReferenceViewSet(viewsets.ModelViewSet):
    queryset = BillReference.objects.select_related('line', 'line__entry').all()
    serializer_class = BillReferenceSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        # Multi-location invariant: only see allocations for the active store
        # (admin/all-stores sees everything). Prevents cross-store settlement leak.
        from core.mixins import get_active_location
        loc = get_active_location(self.request)
        if loc:
            qs = qs.filter(line__entry__location_id=loc.id)
        if params.get('line'):
            qs = qs.filter(line_id=params.get('line'))
        if params.get('entry'):
            qs = qs.filter(line__entry_id=params.get('entry'))
        if params.get('ref_no'):
            qs = qs.filter(ref_no__icontains=params.get('ref_no'))
        if params.get('bill_id'):
            qs = qs.filter(bill_id=params.get('bill_id'))
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'BillReference', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        log_action('DELETE', 'BillReference', instance.pk, str(instance), request=self.request)
        instance.delete()


# ─── Custom Voucher Type Profiles ───────────────────────────────────────────


class VoucherTypeProfileViewSet(viewsets.ModelViewSet):
    queryset = VoucherTypeProfile.objects.all()
    serializer_class = VoucherTypeProfileSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get('active_only') == 'true':
            qs = qs.filter(is_active=True)
        if self.request.query_params.get('base_type'):
            qs = qs.filter(base_type=self.request.query_params.get('base_type'))
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'VoucherTypeProfile', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'VoucherTypeProfile', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        log_action('DELETE', 'VoucherTypeProfile', instance.pk, str(instance), request=self.request)
        instance.delete()

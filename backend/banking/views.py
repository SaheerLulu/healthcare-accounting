from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from audit.utils import log_action
from core.mixins import LocationFilterMixin, get_active_location, user_can_access_location
from core.middleware import _has_all_location_access
from journals.models import JournalEntry


def _assert_bank_account_access(request, account):
    """Refuse acting on a bank account outside the caller's active store.

    Detail routes get this via LocationFilterMixin.get_queryset(); this is
    for endpoints that take the bank account as a payload field and would
    otherwise accept any store's account.
    """
    from rest_framework.exceptions import PermissionDenied
    location = get_active_location(request)
    if location is not None:
        if account.location_id is not None and account.location_id != location.id:
            raise PermissionDenied('Bank account belongs to another store.')
        return
    if _has_all_location_access(request.user):
        return
    if account.location_id is not None and not user_can_access_location(
            request.user, account.location_id):
        raise PermissionDenied('Bank account belongs to another store.')

from .models import BankAccount, BankTransaction, Cheque, PettyCashFloat, PettyCashTransaction
from .serializers import (
    BankAccountSerializer, BankTransactionSerializer, ChequeSerializer,
    CategorizePayloadSerializer, MatchPayloadSerializer,
    PettyCashFloatSerializer, PettyCashTransactionSerializer,
)
from . import services


class BankAccountViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = BankAccount.objects.select_related('chart_account')
    serializer_class = BankAccountSerializer
    pagination_class = None
    # An account with no location is the company's, usable from any store —
    # which is what _assert_bank_account_access above already assumes. Without
    # this the read filter excluded exactly the accounts that guard permits,
    # leaving the cheque form's bank picker empty in every store.
    location_allows_null = True

    def get_queryset(self):
        qs = super().get_queryset()  # LocationFilterMixin scopes by location_id
        if self.request.query_params.get('is_active') == 'true':
            qs = qs.filter(is_active=True)
        if self.request.query_params.get('is_active') == 'false':
            qs = qs.filter(is_active=False)
        return qs.order_by('name')

    def perform_create(self, serializer):
        # Tag the account to the active store unless one is explicitly given.
        location = get_active_location(self.request)
        extra = {}
        if location and 'location_id' not in serializer.validated_data:
            extra['location_id'] = location.id
        instance = serializer.save(
            created_by=self.request.user if self.request.user.is_authenticated else None,
            **extra,
        )
        log_action('CREATE', 'BankAccount', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'BankAccount', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        if instance.transactions.exists():
            from rest_framework.exceptions import ValidationError
            raise ValidationError('Bank account has transactions; archive it instead.')
        log_action('DELETE', 'BankAccount', instance.pk, str(instance), request=self.request)
        instance.delete()

    @action(detail=False, methods=['get'], url_path='cash-in-hand')
    def cash_in_hand(self, request):
        """Cash-in-hand balance for the active location (Cash 1110 GL)."""
        from core.mixins import require_location_or_all_access
        location = require_location_or_all_access(request)
        location_id = location.id if location else None
        balance = services.cash_in_hand_balance(location_id)
        return Response({'location_id': location_id, 'cash_in_hand': str(balance)})

    @action(detail=True, methods=['post'], url_path='deposit-cash')
    def deposit_cash(self, request, pk=None):
        """Deposit cash-in-hand into this bank account (Dr Bank / Cr Cash)."""
        from core.mixins import get_active_location
        bank_account = self.get_object()
        location = get_active_location(request)
        location_id = location.id if location else bank_account.location_id
        try:
            je = services.post_cash_deposit(
                bank_account=bank_account,
                date=request.data.get('date'),
                amount=request.data.get('amount'),
                location_id=location_id,
                narration=request.data.get('narration', ''),
                user=request.user if request.user.is_authenticated else None,
            )
        except DjangoValidationError as e:
            return Response({'detail': '; '.join(e.messages)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('CREATE', 'JournalEntry', je.pk,
                   f'Cash deposit to {bank_account.name}', request=request)
        return Response({'entry_no': je.entry_no}, status=status.HTTP_201_CREATED)


class BankTransactionViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = BankTransaction.objects.select_related('bank_account', 'matched_journal_entry')
    serializer_class = BankTransactionSerializer
    # No own location_id — scope through the owning bank account's store, and
    # follow that account's shared-when-null rule so a company-wide account's
    # statement lines don't disappear once a store is selected.
    location_field = 'bank_account__location_id'
    location_allows_null = True

    def get_queryset(self):
        qs = super().get_queryset()  # LocationFilterMixin scopes via bank_account__location_id
        params = self.request.query_params
        if params.get('bank_account'):
            qs = qs.filter(bank_account_id=params['bank_account'])
        status_p = params.get('status')
        if status_p:
            qs = qs.filter(status__in=[s for s in status_p.split(',') if s])
        if params.get('search'):
            from django.db.models import Q
            s = params['search']
            qs = qs.filter(Q(description__icontains=s) | Q(reference__icontains=s))
        if params.get('date_from'):
            qs = qs.filter(date__gte=params['date_from'])
        if params.get('date_to'):
            qs = qs.filter(date__lte=params['date_to'])
        return qs.order_by('-date', '-id')

    def perform_create(self, serializer):
        # Manual single transaction. The mixin scopes reads via the owning
        # account; creates must apply the same store check to the payload FK.
        _assert_bank_account_access(self.request, serializer.validated_data['bank_account'])
        instance = serializer.save(
            source='manual',
            created_by=self.request.user if self.request.user.is_authenticated else None,
        )
        log_action('CREATE', 'BankTransaction', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        # A matched (reconciled) line's reconciliation-critical fields are frozen
        # — editing amount/date/account silently breaks the match invariant
        # (the report would still claim the account is reconciled). Unmatch first.
        instance = self.get_object()
        if instance.status == 'matched':
            from rest_framework.exceptions import ValidationError
            data = serializer.validated_data
            for field, current in (
                ('amount', instance.amount),
                ('date', instance.date),
                ('bank_account', instance.bank_account),
            ):
                if field in data and data[field] != current:
                    raise ValidationError(
                        'Unmatch this transaction before changing its amount, date or account.'
                    )
        instance = serializer.save()
        log_action('UPDATE', 'BankTransaction', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        if instance.status == 'matched':
            from rest_framework.exceptions import ValidationError
            raise ValidationError('Unmatch this transaction before deleting.')
        log_action('DELETE', 'BankTransaction', instance.pk, str(instance), request=self.request)
        instance.delete()

    @action(detail=False, methods=['post'], url_path='import',
            parser_classes=[MultiPartParser, FormParser, JSONParser])
    def import_csv(self, request):
        """Upload a CSV statement: form-data { bank_account: <id>, file: <csv> }"""
        bank_account_id = request.data.get('bank_account')
        if not bank_account_id:
            return Response({'detail': 'bank_account is required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        account = get_object_or_404(BankAccount, pk=bank_account_id)
        _assert_bank_account_access(request, account)
        upload = request.FILES.get('file')
        if not upload:
            return Response({'detail': 'file is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = services.import_csv(
                account, upload.read(),
                user=request.user if request.user.is_authenticated else None,
            )
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0] if hasattr(e, 'messages') else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        log_action('CREATE', 'BankTransaction', 'batch',
                   f"Imported {result['imported']} transactions on {account.name}",
                   request=request, extra=result)
        return Response(result, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='suggestions')
    def suggestions(self, request, pk=None):
        txn = self.get_object()
        return Response({'rows': services.find_match_suggestions(txn)})

    @action(detail=True, methods=['post'], url_path='match')
    def match(self, request, pk=None):
        txn = self.get_object()
        ser = MatchPayloadSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        je = get_object_or_404(JournalEntry, pk=ser.validated_data['journal_entry_id'])
        try:
            services.match_transaction(txn, je)
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0] if hasattr(e, 'messages') else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        log_action('UPDATE', 'BankTransaction', txn.pk,
                   f"Matched to {je.entry_no}", request=request)
        return Response(BankTransactionSerializer(txn).data)

    @action(detail=True, methods=['post'], url_path='unmatch')
    def unmatch(self, request, pk=None):
        txn = self.get_object()
        services.unmatch_transaction(txn)
        log_action('UPDATE', 'BankTransaction', txn.pk, 'Unmatched', request=request)
        return Response(BankTransactionSerializer(txn).data)

    @action(detail=True, methods=['post'], url_path='exclude')
    def exclude(self, request, pk=None):
        txn = self.get_object()
        try:
            services.set_excluded(txn, True)
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0] if hasattr(e, 'messages') else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        log_action('UPDATE', 'BankTransaction', txn.pk, 'Excluded', request=request)
        return Response(BankTransactionSerializer(txn).data)

    @action(detail=True, methods=['post'], url_path='restore')
    def restore(self, request, pk=None):
        txn = self.get_object()
        services.set_excluded(txn, False)
        log_action('UPDATE', 'BankTransaction', txn.pk, 'Restored', request=request)
        return Response(BankTransactionSerializer(txn).data)

    @action(detail=True, methods=['post'], url_path='categorize')
    def categorize(self, request, pk=None):
        txn = self.get_object()
        ser = CategorizePayloadSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            entry = services.categorize_transaction(
                txn,
                user=request.user if request.user.is_authenticated else None,
                **ser.validated_data,
            )
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0] if hasattr(e, 'messages') else str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        log_action('CREATE', 'JournalEntry', entry.pk,
                   f"Categorized bank txn {txn.pk} → {entry.entry_no}", request=request)
        return Response(BankTransactionSerializer(txn).data, status=status.HTTP_201_CREATED)


class ChequeViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    """Cheque register: PDC + clearance + bounce tracking (issued + received)."""
    queryset = Cheque.objects.select_related('bank_account', 'journal_entry',
                                             'bounce_journal_entry')
    serializer_class = ChequeSerializer

    def get_queryset(self):
        qs = super().get_queryset()  # LocationFilterMixin scopes by location_id
        params = self.request.query_params
        if (k := params.get('kind')):
            qs = qs.filter(kind=k)
        if (s := params.get('status')):
            qs = qs.filter(status__in=[x.strip() for x in s.split(',')])
        if (acc := params.get('bank_account')):
            qs = qs.filter(bank_account_id=acc)
        if params.get('pdc') == 'true':
            from datetime import date as _d
            qs = qs.filter(expected_clear_date__gt=_d.today(), status='pending')
        return qs

    def perform_create(self, serializer):
        location = get_active_location(self.request)
        extra = {}
        if serializer.validated_data.get('location_id') is None:
            # In All-Stores mode fall back to the bank account's own store. A
            # cheque saved with no location vanished from the register as soon
            # as any store was selected, which read as "the save failed".
            account = serializer.validated_data.get('bank_account')
            resolved = location.id if location else getattr(account, 'location_id', None)
            if resolved is None:
                raise ValidationError({'location_id': [
                    'Select a store before recording a cheque — this bank '
                    'account is shared across stores, so there is nothing to '
                    'file the cheque under.',
                ]})
            extra['location_id'] = resolved
        instance = serializer.save(
            created_by=self.request.user if self.request.user.is_authenticated else None,
            **extra,
        )
        log_action('CREATE', 'Cheque', instance.pk, str(instance), request=self.request)

    # Once a cheque leaves 'pending' its financial identity is settled —
    # the same immutability contract as posted journal entries. Only the
    # bookkeeping annotations may still change.
    FROZEN_AFTER_PENDING = ('cheque_no', 'kind', 'bank_account', 'cheque_date', 'amount')

    def perform_update(self, serializer):
        instance = self.get_object()
        if instance.status != 'pending':
            from rest_framework.exceptions import ValidationError
            for field in self.FROZEN_AFTER_PENDING:
                if field in serializer.validated_data and \
                        serializer.validated_data[field] != getattr(instance, field):
                    raise ValidationError(
                        f'Cheque is {instance.status} — {field} can no longer change.')
        instance = serializer.save()
        log_action('UPDATE', 'Cheque', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        from rest_framework.exceptions import ValidationError
        if instance.status != 'pending':
            raise ValidationError(
                f'Cheque is {instance.status} and part of the register history '
                f'— it cannot be deleted.')
        if instance.journal_entry_id or instance.bounce_journal_entry_id:
            raise ValidationError(
                'Cheque is linked to journal entries — cancel it instead of deleting.')
        log_action('DELETE', 'Cheque', instance.pk, str(instance), request=self.request)
        instance.delete()

    @action(detail=True, methods=['post'], url_path='clear')
    def clear(self, request, pk=None):
        cheque = self.get_object()
        try:
            services.mark_cheque_cleared(cheque)
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0]}, status=status.HTTP_400_BAD_REQUEST)
        log_action('UPDATE', 'Cheque', cheque.pk, f'Cheque {cheque.cheque_no} cleared',
                   request=request)
        return Response(ChequeSerializer(cheque).data)

    @action(detail=True, methods=['post'], url_path='bounce')
    def bounce(self, request, pk=None):
        cheque = self.get_object()
        try:
            services.mark_cheque_bounced(
                cheque,
                reason=request.data.get('reason', ''),
                bank_charge=request.data.get('bank_charge'),
                user=request.user if request.user.is_authenticated else None,
            )
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0]}, status=status.HTTP_400_BAD_REQUEST)
        log_action('UPDATE', 'Cheque', cheque.pk,
                   f'Cheque {cheque.cheque_no} bounced',
                   request=request,
                   extra={'reason': cheque.bounce_reason})
        return Response(ChequeSerializer(cheque).data)

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        cheque = self.get_object()
        try:
            services.mark_cheque_cancelled(
                cheque,
                reason=request.data.get('reason', ''),
                user=request.user if request.user.is_authenticated else None,
            )
        except DjangoValidationError as e:
            return Response({'detail': e.messages[0]}, status=status.HTTP_400_BAD_REQUEST)
        log_action('UPDATE', 'Cheque', cheque.pk,
                   f'Cheque {cheque.cheque_no} cancelled', request=request)
        return Response(ChequeSerializer(cheque).data)


class PettyCashFloatViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = PettyCashFloat.objects.select_related('chart_account')
    serializer_class = PettyCashFloatSerializer
    pagination_class = None

    def perform_create(self, serializer):
        # This used to be a bare save(), skipping the mixin, so the float was
        # never stamped with the active store and the create failed outright
        # unless the page happened to post location_id itself.
        extra = {}
        if serializer.validated_data.get('location_id') is None:
            location = get_active_location(self.request)
            if location is None:
                raise ValidationError({'location_id': [
                    'Select a store before creating a petty-cash float — each '
                    'store keeps its own.',
                ]})
            extra['location_id'] = location.id
            if not serializer.validated_data.get('location_name'):
                extra['location_name'] = getattr(location, 'name', '') or ''
        instance = serializer.save(**extra)
        log_action('CREATE', 'PettyCashFloat', instance.pk, str(instance), request=self.request)

    @action(detail=True, methods=['post'], url_path='spend')
    def spend(self, request, pk=None):
        from datetime import date as _d
        from decimal import Decimal as _D
        from core.models import ChartOfAccount
        float_obj = self.get_object()
        try:
            txn = services.post_petty_cash_spend(
                float_obj=float_obj,
                date=_d.fromisoformat(request.data.get('date', _d.today().isoformat())),
                amount=_D(str(request.data.get('amount', '0'))),
                expense_account=ChartOfAccount.objects.get(pk=request.data['expense_account']),
                description=request.data.get('description', ''),
                voucher_no=request.data.get('voucher_no', ''),
                user=request.user if request.user.is_authenticated else None,
            )
        except (DjangoValidationError, KeyError, ChartOfAccount.DoesNotExist) as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('CREATE', 'PettyCashTransaction', txn.pk, str(txn), request=request)
        return Response(PettyCashTransactionSerializer(txn).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='replenish')
    def replenish(self, request, pk=None):
        from datetime import date as _d
        from decimal import Decimal as _D
        float_obj = self.get_object()
        try:
            txn = services.replenish_petty_cash(
                float_obj=float_obj,
                date=_d.fromisoformat(request.data.get('date', _d.today().isoformat())),
                amount=_D(str(request.data.get('amount', '0'))),
                source=request.data.get('source', 'bank'),
                user=request.user if request.user.is_authenticated else None,
            )
        except DjangoValidationError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('CREATE', 'PettyCashTransaction', txn.pk, str(txn), request=request)
        return Response(PettyCashTransactionSerializer(txn).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='transactions')
    def transactions(self, request, pk=None):
        float_obj = self.get_object()
        qs = float_obj.transactions.all()[:200]
        return Response({
            'rows': PettyCashTransactionSerializer(qs, many=True).data,
            'count': float_obj.transactions.count(),
            'current_balance': str(services.petty_cash_balance(float_obj)),
        })

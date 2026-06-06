import calendar
from datetime import date
from decimal import Decimal

from django.db import models
from django.db.models import Sum, Q, Case, When, Value, DecimalField
from django.db.models.functions import ExtractMonth, ExtractYear
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AccountingSettings, ChartOfAccount, AccountMapping, CostCategory, CostCentre
from .period_lock import LockedPeriod
from .serializers import (
    AccountingSettingsSerializer,
    ChartOfAccountSerializer,
    ChartOfAccountTreeSerializer,
    AccountMappingSerializer,
    LockedPeriodSerializer,
    CostCategorySerializer,
    CostCentreSerializer,
)
from .mixins import get_active_location
from audit.utils import log_action
from inventory_reader.models import LocationRO, UserLocationAssignmentRO, UserProfileRO, SupplierRO, CustomerRO


class AccountingSettingsView(RetrieveUpdateAPIView):
    serializer_class = AccountingSettingsSerializer

    def get_object(self):
        return AccountingSettings.get_settings()

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        log_action('UPDATE', 'AccountingSettings', 'singleton', 'Accounting Settings', request=request)
        return response


class ChartOfAccountViewSet(viewsets.ModelViewSet):
    queryset = ChartOfAccount.objects.all()
    serializer_class = ChartOfAccountSerializer
    pagination_class = None

    def _apply_location_scope(self, qs):
        """Per-store scoping shared by the list and counts endpoints.

        By default (`location_scope=auto`) a request with X-Location-Id sees
        this store's clones + the NULL-location shared accounts (GST, equity
        etc.). `location_scope=all` opts out (COA admin view); `shared`
        returns just the NULL-location templates. No active location → show
        all (legacy admin behaviour).
        """
        scope = self.request.query_params.get('location_scope', 'auto')
        if scope == 'all':
            return qs
        if scope == 'shared':
            return qs.filter(location_id__isnull=True)
        location = get_active_location(self.request)
        if location:
            return qs.filter(
                models.Q(location_id=location.id) | models.Q(location_id__isnull=True)
            )
        return qs

    def get_queryset(self):
        from django.db.models import Count
        # "Number of entries" per account must match the ledger you land on when
        # you click it (reports.LedgerView): posted, non-optional, non-memorandum
        # lines, scoped to the active store. A bare Count('journal_lines') counted
        # every store and every status, so the figure looked wrong on click.
        doc_filter = models.Q(
            journal_lines__entry__is_posted=True,
            journal_lines__entry__is_optional=False,
            journal_lines__entry__is_memorandum=False,
        )
        scope = self.request.query_params.get('location_scope', 'auto')
        if scope not in ('all', 'shared'):
            location = get_active_location(self.request)
            if location:
                doc_filter &= models.Q(journal_lines__entry__location_id=location.id)
        qs = ChartOfAccount.objects.select_related('parent').annotate(
            _documents_count=Count('journal_lines', filter=doc_filter)
        ).order_by('account_code')

        params = self.request.query_params
        account_type = params.get('account_type')
        if account_type:
            qs = qs.filter(account_type=account_type)
        subtype = params.get('account_subtype')
        if subtype:
            qs = qs.filter(account_subtype=subtype)
        is_active = params.get('is_active')
        if is_active in ('true', 'false'):
            qs = qs.filter(is_active=(is_active == 'true'))
        search = params.get('search')
        if search:
            qs = qs.filter(
                models.Q(account_code__icontains=search) |
                models.Q(account_name__icontains=search)
            )
        # Per-party ledgers (Sundry Creditor/Debtor leaves) can number in the
        # hundreds. `party_ledgers=exclude` keeps them out of the generic
        # account picker; `only` returns just them; default `all`. A specific
        # party's ledger is fetched with party_type + party_id.
        party_scope = params.get('party_ledgers')
        if party_scope == 'exclude':
            qs = qs.filter(party_id__isnull=True)
        elif party_scope == 'only':
            qs = qs.filter(party_id__isnull=False)
        p_type = params.get('party_type')
        p_id = params.get('party_id')
        if p_type and p_id:
            qs = qs.filter(party_type=p_type, party_id=p_id)
        return self._apply_location_scope(qs)

    def perform_create(self, serializer):
        instance = serializer.save()
        if instance.parent_id:
            ChartOfAccount.objects.filter(pk=instance.parent_id, is_leaf=True).update(is_leaf=False)
        log_action('CREATE', 'ChartOfAccount', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        # WP 613 — system accounts (those bound to an AccountMapping) cannot
        # change account_type or account_code; that would silently break
        # auto-generation across journals/GST/TDS/payroll.
        old = self.get_object()
        new = serializer.validated_data
        is_system = AccountMapping.objects.filter(account=old).exists()
        if is_system:
            for protected in ('account_type', 'account_code'):
                new_value = new.get(protected, getattr(old, protected))
                if new_value != getattr(old, protected):
                    from rest_framework.exceptions import ValidationError
                    raise ValidationError({
                        protected: f'Cannot change {protected} on a system-mapped account.',
                    })
        old_parent_id = serializer.instance.parent_id
        instance = serializer.save()
        new_parent_id = instance.parent_id
        if old_parent_id != new_parent_id:
            if new_parent_id:
                ChartOfAccount.objects.filter(pk=new_parent_id, is_leaf=True).update(is_leaf=False)
            if old_parent_id:
                still_has_children = ChartOfAccount.objects.filter(parent_id=old_parent_id).exists()
                if not still_has_children:
                    ChartOfAccount.objects.filter(pk=old_parent_id).update(is_leaf=True)
        log_action('UPDATE', 'ChartOfAccount', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        # WP 612 — cannot delete an account with movements; deactivate instead.
        if instance.journal_lines.exists():
            from rest_framework.exceptions import ValidationError
            raise ValidationError(
                'This account has journal entries; deactivate it instead of deleting.'
            )
        # WP 613 — system-mapped accounts can't be deleted either (PROTECT FK
        # would block at DB level, but we want a friendly message).
        if AccountMapping.objects.filter(account=instance).exists():
            from rest_framework.exceptions import ValidationError
            raise ValidationError(
                'This account is bound to a system mapping; remove the mapping first.'
            )
        parent_id = instance.parent_id
        log_action('DELETE', 'ChartOfAccount', instance.pk, str(instance), request=self.request)
        instance.delete()
        if parent_id and not ChartOfAccount.objects.filter(parent_id=parent_id).exists():
            ChartOfAccount.objects.filter(pk=parent_id).update(is_leaf=True)

    @action(detail=False, methods=['get'], url_path='tree')
    def tree(self, request):
        root_accounts = ChartOfAccount.objects.filter(parent__isnull=True).order_by('account_code')
        serializer = ChartOfAccountTreeSerializer(root_accounts, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='counts')
    def counts(self, request):
        """Per-type counts for pill filter UI.

        Scoped to the active store the same way the list endpoint is, so the
        pill totals match the rows actually shown (previously counted every
        store's accounts).
        """
        from django.db.models import Count
        base = self._apply_location_scope(ChartOfAccount.objects.all())
        agg = base.values('account_type').annotate(c=Count('id'))
        counts = {row['account_type']: row['c'] for row in agg}
        active_count = base.filter(is_active=True).count()
        inactive_count = base.filter(is_active=False).count()
        total = sum(counts.values())
        return Response({
            'total': total,
            'active': active_count,
            'inactive': inactive_count,
            'by_type': counts,
        })

    @action(detail=True, methods=['post'], url_path='toggle-active')
    def toggle_active(self, request, pk=None):
        account = self.get_object()
        account.is_active = not account.is_active
        account.save(update_fields=['is_active', 'updated_at'])
        log_action('UPDATE', 'ChartOfAccount', account.pk,
                   f"{account} → {'active' if account.is_active else 'inactive'}",
                   request=request)
        return Response(self.get_serializer(account).data)


class AccountMappingViewSet(viewsets.ModelViewSet):
    queryset = AccountMapping.objects.select_related('account').all()
    serializer_class = AccountMappingSerializer
    pagination_class = None

    def get_queryset(self):
        """Filter by location_id when given. `location_id=null` returns only
        the shared NULL defaults; a numeric `location_id` returns rows scoped
        to that location (per-store overrides). Omitted = all rows (admin)."""
        qs = AccountMapping.objects.select_related('account').order_by('key', 'location_id')
        loc = self.request.query_params.get('location_id')
        if loc == 'null':
            qs = qs.filter(location_id__isnull=True)
        elif loc is not None and loc != '':
            try:
                qs = qs.filter(location_id=int(loc))
            except ValueError:
                pass
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'AccountMapping', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'AccountMapping', instance.pk, str(instance), request=self.request)

    @action(detail=False, methods=['post'], url_path='reset')
    def reset(self, request):
        """Reset NULL-location (shared) mappings to defaults based on existing COA
        codes. Per-store overrides are left intact. Pass `keys=[...]` in the
        body to reset only those keys (e.g. to reset just the Payroll group)."""
        wanted = set(request.data.get('keys') or AccountMapping.DEFAULT_CODES.keys())
        created = 0
        updated = 0
        for key, code in AccountMapping.DEFAULT_CODES.items():
            if key not in wanted:
                continue
            account = ChartOfAccount.objects.filter(
                account_code=code, location_id__isnull=True,
            ).first()
            if account:
                _, was_created = AccountMapping.objects.update_or_create(
                    key=key, location_id=None,
                    defaults={'account': account},
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
        log_action('UPDATE', 'AccountMapping', 'reset',
                   f'Reset {created+updated} shared mappings', request=request)
        return Response({
            'detail': f'Mappings reset. {created} created, {updated} updated.',
            'created': created, 'updated': updated,
        })

    @action(detail=False, methods=['get'], url_path='all-keys')
    def all_keys(self, request):
        """Return every defined mapping key + its display label + the existing
        AccountMapping row (if any) at the requested scope. When `location_id`
        is given, each row also reports `has_override` so the UI can show
        per-store overrides distinctly from the shared default fallback.
        """
        loc = request.query_params.get('location_id')
        loc_int = None
        if loc and loc != 'null':
            try:
                loc_int = int(loc)
            except ValueError:
                loc_int = None

        # Defaults (NULL location) — used as the fallback for any key without
        # a per-store override.
        defaults = {
            m.key: m for m in
            AccountMapping.objects.select_related('account').filter(location_id__isnull=True)
        }
        # Per-store overrides for the requested location.
        overrides = {}
        if loc_int is not None:
            overrides = {
                m.key: m for m in
                AccountMapping.objects.select_related('account')
                .filter(location_id=loc_int)
            }

        shared_keys = AccountMapping.SHARED_KEYS
        rows = []
        for key, label in AccountMapping.KEY_CHOICES:
            override = overrides.get(key)
            default = defaults.get(key)
            effective = override or default
            rows.append({
                'key': key,
                'label': label,
                'default_code': AccountMapping.DEFAULT_CODES.get(key),
                'is_shared_key': key in shared_keys,
                'mapping_id': effective.pk if effective else None,
                'account': effective.account_id if effective else None,
                'account_code': effective.account.account_code if effective else None,
                'account_name': effective.account.account_name if effective else None,
                'has_override': override is not None,
                'override_id': override.pk if override else None,
            })
        return Response(rows)


def _get_fy_dates():
    settings = AccountingSettings.get_settings()
    fy_start_month = settings.financial_year_start
    today = date.today()
    if today.month >= fy_start_month:
        fy_start_year = today.year
    else:
        fy_start_year = today.year - 1

    fy_start = date(fy_start_year, fy_start_month, 1)

    if fy_start_month == 1:
        fy_end = date(fy_start_year, 12, 31)
    else:
        fy_end_year = fy_start_year + 1
        fy_end_month = fy_start_month - 1
        last_day = calendar.monthrange(fy_end_year, fy_end_month)[1]
        fy_end = date(fy_end_year, fy_end_month, last_day)

    return fy_start, fy_end


class UserLocationsView(APIView):
    def get(self, request):
        from .middleware import _has_all_location_access

        user = request.user
        can_see_all = _has_all_location_access(user)

        if can_see_all:
            locations = LocationRO.objects.filter(
                usage='internal'
            ).order_by('name').values('id', 'name', 'complete_name')
            result = [
                {'id': loc['id'], 'name': loc['name'],
                 'complete_name': loc['complete_name'], 'is_default': False}
                for loc in locations
            ]
        else:
            assignments = UserLocationAssignmentRO.objects.filter(
                user_profile__user=user,
            ).select_related('location').order_by('-is_default', 'location__name')
            result = [
                {'id': a.location.id, 'name': a.location.name,
                 'complete_name': a.location.complete_name, 'is_default': a.is_default}
                for a in assignments
            ]

        return Response({'locations': result, 'can_see_all': can_see_all})


class SuppliersListView(APIView):
    def get(self, request):
        suppliers = SupplierRO.objects.all().order_by('company_name').values('id', 'company_name')
        return Response([{'id': s['id'], 'name': s['company_name']} for s in suppliers])


class CustomersListView(APIView):
    def get(self, request):
        customers = CustomerRO.objects.all().order_by('customer_name').values('id', 'customer_name')
        return Response([{'id': c['id'], 'name': c['customer_name']} for c in customers])


class DashboardView(APIView):
    def get(self, request):
        from journals.models import JournalEntryLine

        fy_start, fy_end = _get_fy_dates()
        today = date.today()
        month_start = date(today.year, today.month, 1)
        last_day = calendar.monthrange(today.year, today.month)[1]
        month_end = date(today.year, today.month, last_day)

        location = get_active_location(request)

        # Phase 5A: Single aggregate query instead of N+1 loops.
        # Exclude optional/memorandum vouchers so the dashboard KPIs match the
        # ledger balances (ChartOfAccount.get_balance honours the same flags).
        fy_lines = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            entry__is_optional=False,
            entry__is_memorandum=False,
            entry__date__range=[fy_start, fy_end],
        )
        if location:
            fy_lines = fy_lines.filter(entry__location_id=location.id)

        # Aggregate by account type for FY totals
        type_agg = fy_lines.values('account__account_type').annotate(
            total_debit=Sum('debit'),
            total_credit=Sum('credit'),
        )
        type_totals = {row['account__account_type']: row for row in type_agg}

        rev = type_totals.get('REVENUE', {})
        rev_dr = rev.get('total_debit') or Decimal('0')
        rev_cr = rev.get('total_credit') or Decimal('0')
        total_revenue = rev_cr - rev_dr

        exp = type_totals.get('EXPENSE', {})
        exp_dr = exp.get('total_debit') or Decimal('0')
        exp_cr = exp.get('total_credit') or Decimal('0')
        total_expenses = exp_dr - exp_cr

        net_profit = total_revenue - total_expenses

        # Subtype aggregates for receivables, payables, GST
        subtype_qs = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            entry__is_optional=False,
            entry__is_memorandum=False,
        )
        if location:
            subtype_qs = subtype_qs.filter(entry__location_id=location.id)
        subtype_agg = subtype_qs.values('account__account_subtype').annotate(
            total_debit=Sum('debit'),
            total_credit=Sum('credit'),
        )
        subtype_totals = {row['account__account_subtype']: row for row in subtype_agg}

        def get_subtype_balance(subtype):
            s = subtype_totals.get(subtype, {})
            return (s.get('total_debit') or Decimal('0')) - (s.get('total_credit') or Decimal('0'))

        total_receivables = get_subtype_balance('Receivable')
        total_payables = -(get_subtype_balance('Payable'))
        output_gst = -(get_subtype_balance('Output_GST'))
        input_gst = get_subtype_balance('Input_GST')
        gst_payable = output_gst - input_gst

        # Current month
        month_lines = fy_lines.filter(entry__date__range=[month_start, month_end])
        month_type_agg = month_lines.values('account__account_type').annotate(
            total_debit=Sum('debit'), total_credit=Sum('credit'),
        )
        month_type_totals = {row['account__account_type']: row for row in month_type_agg}

        m_rev = month_type_totals.get('REVENUE', {})
        current_month_revenue = (m_rev.get('total_credit') or Decimal('0')) - (m_rev.get('total_debit') or Decimal('0'))
        m_exp = month_type_totals.get('EXPENSE', {})
        current_month_expenses = (m_exp.get('total_debit') or Decimal('0')) - (m_exp.get('total_credit') or Decimal('0'))

        # Monthly data: single query with ExtractMonth/ExtractYear
        monthly_agg = fy_lines.annotate(
            month=ExtractMonth('entry__date'),
            year=ExtractYear('entry__date'),
        ).values('account__account_type', 'month', 'year').annotate(
            total_debit=Sum('debit'),
            total_credit=Sum('credit'),
        )

        monthly_map = {}
        for row in monthly_agg:
            key = (row['year'], row['month'])
            if key not in monthly_map:
                monthly_map[key] = {'revenue': Decimal('0'), 'expenses': Decimal('0')}
            if row['account__account_type'] == 'REVENUE':
                monthly_map[key]['revenue'] += (row['total_credit'] or Decimal('0')) - (row['total_debit'] or Decimal('0'))
            elif row['account__account_type'] == 'EXPENSE':
                monthly_map[key]['expenses'] += (row['total_debit'] or Decimal('0')) - (row['total_credit'] or Decimal('0'))

        monthly_data = []
        fy_month = fy_start.month
        fy_year = fy_start.year
        for i in range(12):
            m = (fy_month - 1 + i) % 12 + 1
            y = fy_year + (fy_month - 1 + i) // 12
            m_start = date(y, m, 1)
            if m_start > today:
                break
            data = monthly_map.get((y, m), {'revenue': Decimal('0'), 'expenses': Decimal('0')})
            monthly_data.append({
                'month': m_start.strftime('%b %Y'),
                'revenue': round(float(data['revenue']), 2),
                'expenses': round(float(data['expenses']), 2),
            })

        return Response({
            'total_revenue': float(total_revenue),
            'total_expenses': float(total_expenses),
            'net_profit': float(net_profit),
            'total_receivables': float(total_receivables),
            'total_payables': float(total_payables),
            'gst_payable': float(gst_payable),
            'current_month_revenue': float(current_month_revenue),
            'current_month_expenses': float(current_month_expenses),
            'financial_year_start': str(fy_start),
            'financial_year_end': str(fy_end),
            'monthly_data': monthly_data,
        })


class LockedPeriodViewSet(viewsets.ModelViewSet):
    """Manage per-month period locks (block JV mutation in a closed month)."""
    queryset = LockedPeriod.objects.all().order_by('-period')
    serializer_class = LockedPeriodSerializer
    pagination_class = None
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def perform_create(self, serializer):
        instance = serializer.save(
            locked_by=self.request.user if self.request.user.is_authenticated else None,
        )
        log_action('CREATE', 'LockedPeriod', instance.pk,
                   f'Locked period {instance.period}', request=self.request,
                   extra={'reason': instance.reason})

    def perform_destroy(self, instance):
        log_action('DELETE', 'LockedPeriod', instance.pk,
                   f'Unlocked period {instance.period}', request=self.request)
        instance.delete()


class CloseFiscalYearView(APIView):
    """POST {fy_start_year, location_id?, generate_opening?} → close FY + post opening JV."""

    def post(self, request):
        from .year_end import close_fiscal_year

        fy_start_year = request.data.get('fy_start_year')
        if not fy_start_year:
            return Response({'detail': 'fy_start_year is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            fy_start_year = int(fy_start_year)
        except (TypeError, ValueError):
            return Response({'detail': 'fy_start_year must be an integer'}, status=status.HTTP_400_BAD_REQUEST)

        from django.core.exceptions import ValidationError as DjangoValidationError
        from core.mixins import get_active_location
        _loc = get_active_location(request)
        try:
            result = close_fiscal_year(
                fy_start_year,
                location_id=request.data.get('location_id') or (_loc.id if _loc else None),
                generate_opening=bool(request.data.get('generate_opening', True)),
                user=request.user if request.user.is_authenticated else None,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except DjangoValidationError as exc:
            # Closing month sits in a locked period (PeriodLockedError) — surface
            # a clean 400 with the reason instead of an unhandled 500.
            msg = exc.messages[0] if hasattr(exc, 'messages') else str(exc)
            return Response({'detail': msg}, status=status.HTTP_400_BAD_REQUEST)

        log_action('GENERATE', 'AccountingSettings', 'fy-close',
                   f"Closed FY {result['fy']}", request=request, extra=result)
        return Response(result)


class CostCategoryViewSet(viewsets.ModelViewSet):
    queryset = CostCategory.objects.all()
    serializer_class = CostCategorySerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get('active_only') == 'true':
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'CostCategory', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'CostCategory', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        log_action('DELETE', 'CostCategory', instance.pk, str(instance), request=self.request)
        instance.delete()


class CostCentreViewSet(viewsets.ModelViewSet):
    queryset = CostCentre.objects.select_related('category', 'parent').all()
    serializer_class = CostCentreSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get('active_only') == 'true':
            qs = qs.filter(is_active=True)
        if params.get('category'):
            qs = qs.filter(category_id=params.get('category'))
        if params.get('search'):
            qs = qs.filter(name__icontains=params.get('search'))
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'CostCentre', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'CostCentre', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        log_action('DELETE', 'CostCentre', instance.pk, str(instance), request=self.request)
        instance.delete()


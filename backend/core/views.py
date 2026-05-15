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

    def get_queryset(self):
        from django.db.models import Count
        # Annotate document count (number of journal lines) so list view stays fast.
        qs = ChartOfAccount.objects.select_related('parent').annotate(
            _documents_count=Count('journal_lines')
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
        return qs

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
        """Per-type counts for pill filter UI."""
        from django.db.models import Count
        agg = ChartOfAccount.objects.values('account_type').annotate(c=Count('id'))
        counts = {row['account_type']: row['c'] for row in agg}
        active_count = ChartOfAccount.objects.filter(is_active=True).count()
        inactive_count = ChartOfAccount.objects.filter(is_active=False).count()
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

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'AccountMapping', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'AccountMapping', instance.pk, str(instance), request=self.request)

    @action(detail=False, methods=['post'], url_path='reset')
    def reset(self, request):
        """Reset account mappings to defaults based on existing COA codes."""
        created = 0
        for key, code in AccountMapping.DEFAULT_CODES.items():
            account = ChartOfAccount.objects.filter(account_code=code).first()
            if account:
                _, was_created = AccountMapping.objects.update_or_create(
                    key=key, defaults={'account': account}
                )
                if was_created:
                    created += 1
        log_action('UPDATE', 'AccountMapping', 'all', 'Reset account mappings', request=request)
        return Response({'detail': f'Mappings reset. {created} new mappings created.'})

    @action(detail=False, methods=['get'], url_path='all-keys')
    def all_keys(self, request):
        """Return every defined mapping key + its display label + the
        existing AccountMapping row (if any). Lets the Settings page show
        unmapped keys with a "Map to..." dropdown rather than hiding them.
        """
        existing = {m.key: m for m in AccountMapping.objects.select_related('account').all()}
        rows = []
        for key, label in AccountMapping.KEY_CHOICES:
            m = existing.get(key)
            rows.append({
                'key': key,
                'label': label,
                'default_code': AccountMapping.DEFAULT_CODES.get(key),
                'mapping_id': m.pk if m else None,
                'account': m.account_id if m else None,
                'account_code': m.account.account_code if m else None,
                'account_name': m.account.account_name if m else None,
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

        # Phase 5A: Single aggregate query instead of N+1 loops
        fy_lines = JournalEntryLine.objects.filter(
            entry__is_posted=True,
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

        from decimal import Decimal as _D
        cs_value = request.data.get('closing_stock_value')
        try:
            result = close_fiscal_year(
                fy_start_year,
                location_id=request.data.get('location_id'),
                generate_opening=bool(request.data.get('generate_opening', True)),
                closing_stock_value=_D(str(cs_value)) if cs_value is not None else None,
                user=request.user if request.user.is_authenticated else None,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

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


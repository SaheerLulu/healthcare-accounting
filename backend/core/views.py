import calendar
from datetime import date
from decimal import Decimal

from django.db.models import Sum, Q, Case, When, Value, DecimalField
from django.db.models.functions import ExtractMonth, ExtractYear
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AccountingSettings, ChartOfAccount, AccountMapping
from .serializers import (
    AccountingSettingsSerializer,
    ChartOfAccountSerializer,
    ChartOfAccountTreeSerializer,
    AccountMappingSerializer,
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
    queryset = ChartOfAccount.objects.all().order_by('account_code')
    serializer_class = ChartOfAccountSerializer
    pagination_class = None

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action('CREATE', 'ChartOfAccount', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'ChartOfAccount', instance.pk, str(instance), request=self.request)

    def perform_destroy(self, instance):
        log_action('DELETE', 'ChartOfAccount', instance.pk, str(instance), request=self.request)
        instance.delete()

    @action(detail=False, methods=['get'], url_path='tree')
    def tree(self, request):
        root_accounts = ChartOfAccount.objects.filter(parent__isnull=True).order_by('account_code')
        serializer = ChartOfAccountTreeSerializer(root_accounts, many=True)
        return Response(serializer.data)


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

from datetime import date as date_cls
from decimal import Decimal

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from audit.utils import log_action
from core.middleware import _has_all_location_access
from core.mixins import (
    LocationFilterMixin, assert_location_access, get_active_location,
)

from .models import AssetClass, DepreciationEntry, FixedAsset
from .serializers import (
    AssetClassSerializer, DepreciationEntrySerializer, FixedAssetSerializer,
)
from .services import (
    compute_monthly_depreciation, dispose_asset, post_acquisition,
    post_monthly_depreciation,
)


class AssetClassViewSet(viewsets.ModelViewSet):
    queryset = AssetClass.objects.select_related(
        'asset_account', 'accum_dep_account', 'dep_expense_account',
    )
    serializer_class = AssetClassSerializer
    pagination_class = None


class FixedAssetViewSet(LocationFilterMixin, viewsets.ModelViewSet):
    queryset = FixedAsset.objects.select_related('asset_class')
    serializer_class = FixedAssetSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if (s := self.request.query_params.get('status')):
            qs = qs.filter(status=s)
        if (cls := self.request.query_params.get('asset_class')):
            qs = qs.filter(asset_class_id=cls)
        return qs

    def perform_create(self, serializer):
        instance = serializer.save(
            created_by=self.request.user if self.request.user.is_authenticated else None,
        )
        log_action('CREATE', 'FixedAsset', instance.pk, str(instance), request=self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action('UPDATE', 'FixedAsset', instance.pk, str(instance), request=self.request)

    @action(detail=True, methods=['post'], url_path='post-acquisition')
    def post_acquisition_action(self, request, pk=None):
        asset = self.get_object()
        try:
            je = post_acquisition(
                asset, payment_mode=request.data.get('payment_mode', 'bank'),
                user=request.user if request.user.is_authenticated else None,
            )
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('POST', 'FixedAsset', asset.pk,
                   f'Acquisition JE {je.entry_no} posted', request=request)
        return Response(FixedAssetSerializer(asset).data)

    @action(detail=True, methods=['post'], url_path='dispose')
    def dispose(self, request, pk=None):
        asset = self.get_object()
        try:
            disposal_date = date_cls.fromisoformat(request.data.get('disposal_date',
                                                                    date_cls.today().isoformat()))
            proceeds = Decimal(str(request.data.get('proceeds', '0')))
            mode = request.data.get('mode', 'bank')
            je = dispose_asset(asset, disposal_date=disposal_date,
                               proceeds=proceeds, mode=mode,
                               user=request.user if request.user.is_authenticated else None)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('POST', 'FixedAsset', asset.pk,
                   f'Disposed via JE {je.entry_no}', request=request,
                   extra={'gain_loss': str(asset.gain_loss_on_disposal)})
        return Response(FixedAssetSerializer(asset).data)

    @action(detail=True, methods=['get'], url_path='depreciation-history')
    def depreciation_history(self, request, pk=None):
        asset = self.get_object()
        entries = asset.depreciation_entries.all()
        ser = DepreciationEntrySerializer(entries, many=True)
        return Response({'rows': ser.data, 'count': entries.count(),
                         'accumulated': str(asset.accumulated_depreciation()),
                         'net_book_value': str(asset.net_book_value())})


class DepreciationRunView(viewsets.ViewSet):
    """POST {period: YYYY-MM, location_id?} to post monthly depreciation."""

    def create(self, request):
        period = request.data.get('period')
        if not period:
            return Response({'detail': 'period (YYYY-MM) is required'},
                            status=status.HTTP_400_BAD_REQUEST)
        # Cross-store guard (mirrors journals/tds/payroll): explicit body
        # location wins, else the active store from X-Location-Id; the caller
        # must be allowed to act on it, and only all-stores users may run an
        # unscoped (every-store) depreciation.
        location_id = request.data.get('location_id')
        if location_id is None:
            active = get_active_location(request)
            location_id = active.id if active else None
        assert_location_access(request, location_id)
        if location_id is None and not _has_all_location_access(request.user):
            raise PermissionDenied('A valid X-Location-Id header is required.')
        try:
            if location_id is not None:
                location_id = int(location_id)
            result = post_monthly_depreciation(
                period, location_id=location_id,
                user=request.user if request.user.is_authenticated else None,
            )
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        log_action('POST', 'DepreciationEntry', period,
                   f"Monthly depreciation run for {period}",
                   request=request, extra=result)
        return Response(result)

    def list(self, request):
        """GET ?period=YYYY-MM&location_id=… → preview without posting."""
        period = request.query_params.get('period')
        if not period:
            return Response({'detail': 'period query param required'}, status=400)
        location_id = request.query_params.get('location_id')
        qs = FixedAsset.objects.filter(status='active').select_related('asset_class')
        if location_id:
            qs = qs.filter(location_id=int(location_id))
        rows = []
        total = Decimal('0.00')
        for asset in qs:
            if DepreciationEntry.objects.filter(fixed_asset=asset, period=period).exists():
                continue
            amt = compute_monthly_depreciation(asset, period=period)
            if amt > 0:
                rows.append({'asset_no': asset.asset_no, 'name': asset.name,
                             'class': asset.asset_class.code,
                             'method': asset.asset_class.dep_method,
                             'amount': str(amt)})
                total += amt
        return Response({'period': period, 'rows': rows, 'total': str(total)})

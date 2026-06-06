import csv
from datetime import date
from django.db import transaction
from django.http import HttpResponse
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404

from core.mixins import get_active_location
from inventory_reader.models import SupplierRO, CustomerRO
from .models import PartyCommunication, PartyOpeningBalance
from .opening_balance import post_opening_balance_je, void_opening_balance_je
from .serializers import PartyCommunicationSerializer, PartyOpeningBalanceSerializer
from . import services


def _parse_date(s):
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _supplier_dict(s: SupplierRO) -> dict:
    return {
        'id': s.id,
        'name': s.company_name,
        'gst_no': s.gst_no,
        'contact_person': s.contact_person,
        'phone': s.phone,
        'email': s.email,
        'address': s.address,
        'city': s.city,
        'state': s.state,
        'pincode': s.pincode,
        'payment_terms': s.payment_terms,
        'credit_days': s.credit_days,
        'status': s.status,
        'location_id': s.location_id,
        'created_at': s.created_at.isoformat() if s.created_at else None,
    }


def _customer_dict(c: CustomerRO) -> dict:
    return {
        'id': c.id,
        'name': c.customer_name,
        'customer_code': c.customer_code,
        'gst_no': c.gst_no,
        'phone': c.phone,
        'email': c.email,
        'address': c.address,
        'city': c.city,
        'state': c.state,
        'pincode': c.pincode,
        'payment_terms': c.payment_terms,
        'credit_days': c.credit_days,
        'credit_limit': str(c.credit_limit) if c.credit_limit is not None else '0.00',
        'customer_type': c.customer_type,
        'status': c.status,
        'location_id': c.location_id,
        'created_at': c.created_at.isoformat() if c.created_at else None,
    }


# ─── List views ─────────────────────────────────────────────────────────────

class SuppliersListView(APIView):
    def get(self, request):
        loc = get_active_location(request)
        rows = services.list_parties(
            'Supplier',
            location_id=loc.id if loc else None,
            search=request.query_params.get('search', ''),
        )
        return Response({'rows': rows, 'count': len(rows)})


class CustomersListView(APIView):
    def get(self, request):
        loc = get_active_location(request)
        rows = services.list_parties(
            'Customer',
            location_id=loc.id if loc else None,
            search=request.query_params.get('search', ''),
        )
        return Response({'rows': rows, 'count': len(rows)})


# ─── Detail views (Overview tab) ────────────────────────────────────────────

class SupplierDetailView(APIView):
    def get(self, request, pk: int):
        supplier = get_object_or_404(SupplierRO, pk=pk)
        loc = get_active_location(request)
        data = _supplier_dict(supplier)
        data['summary'] = services.party_overview(
            'Supplier', supplier.id, location_id=loc.id if loc else None
        )
        return Response(data)


class CustomerDetailView(APIView):
    def get(self, request, pk: int):
        customer = get_object_or_404(CustomerRO, pk=pk)
        loc = get_active_location(request)
        data = _customer_dict(customer)
        data['summary'] = services.party_overview(
            'Customer', customer.id, location_id=loc.id if loc else None
        )
        return Response(data)


# ─── Transactions tab ───────────────────────────────────────────────────────

class _PartyTransactionsView(APIView):
    party_type = ''  # set by subclass

    def get(self, request, pk: int):
        loc = get_active_location(request)
        rows = services.transaction_list(
            self.party_type, pk,
            location_id=loc.id if loc else None,
            start_date=_parse_date(request.query_params.get('start_date')),
            end_date=_parse_date(request.query_params.get('end_date')),
        )
        return Response({'rows': rows, 'count': len(rows)})


class SupplierTransactionsView(_PartyTransactionsView):
    party_type = 'Supplier'


class CustomerTransactionsView(_PartyTransactionsView):
    party_type = 'Customer'


# ─── Statement tab ──────────────────────────────────────────────────────────

class _PartyStatementView(APIView):
    party_type = ''

    def get(self, request, pk: int):
        loc = get_active_location(request)
        data = services.statement_of_account(
            self.party_type, pk,
            location_id=loc.id if loc else None,
            start_date=_parse_date(request.query_params.get('start_date')),
            end_date=_parse_date(request.query_params.get('end_date')),
        )
        return Response(data)


class SupplierStatementView(_PartyStatementView):
    party_type = 'Supplier'


class CustomerStatementView(_PartyStatementView):
    party_type = 'Customer'


class _PartyStatementCSVView(APIView):
    """WP 646 / WP 648 — CSV export of statement of account."""
    party_type = ''
    party_model = None

    def get(self, request, pk: int):
        get_object_or_404(self.party_model, pk=pk)
        loc = get_active_location(request)
        data = services.statement_of_account(
            self.party_type, pk,
            location_id=loc.id if loc else None,
            start_date=_parse_date(request.query_params.get('start_date')),
            end_date=_parse_date(request.query_params.get('end_date')),
        )

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = (
            f'attachment; filename="{self.party_type}_{pk}_statement.csv"'
        )
        w = csv.writer(response)
        w.writerow([f'{self.party_type} ID', pk,
                    'Opening', data.get('opening_balance', 0)])
        w.writerow([])
        w.writerow(['Date', 'Voucher', 'Narration', 'Debit', 'Credit', 'Running Balance'])
        for row in data.get('rows', []):
            w.writerow([
                row.get('date', ''),
                row.get('entry_no', ''),
                row.get('narration', ''),
                row.get('debit', ''),
                row.get('credit', ''),
                row.get('running_balance', ''),
            ])
        w.writerow([])
        w.writerow(['', '', 'Closing', '', '', data.get('closing_balance', 0)])
        return response


class SupplierStatementCSVView(_PartyStatementCSVView):
    party_type = 'Supplier'
    party_model = SupplierRO


class CustomerStatementCSVView(_PartyStatementCSVView):
    party_type = 'Customer'
    party_model = CustomerRO


# ─── Emails / Communications tab ────────────────────────────────────────────

class _PartyCommunicationsView(APIView):
    party_type = ''
    party_model = None

    def _ensure_party_exists(self, pk):
        get_object_or_404(self.party_model, pk=pk)

    def get(self, request, pk: int):
        self._ensure_party_exists(pk)
        qs = PartyCommunication.objects.filter(party_type=self.party_type, party_id=pk)
        channel = request.query_params.get('channel')
        if channel:
            qs = qs.filter(channel=channel)
        ser = PartyCommunicationSerializer(qs, many=True)
        return Response({'rows': ser.data, 'count': qs.count()})

    def post(self, request, pk: int):
        self._ensure_party_exists(pk)
        payload = dict(request.data)
        payload['party_type'] = self.party_type
        payload['party_id'] = pk
        ser = PartyCommunicationSerializer(data=payload)
        ser.is_valid(raise_exception=True)
        ser.save(created_by=request.user if request.user.is_authenticated else None)
        return Response(ser.data, status=status.HTTP_201_CREATED)


class SupplierCommunicationsView(_PartyCommunicationsView):
    party_type = 'Supplier'
    party_model = SupplierRO


class CustomerCommunicationsView(_PartyCommunicationsView):
    party_type = 'Customer'
    party_model = CustomerRO


# ─── Opening balance ────────────────────────────────────────────────────────

class _PartyOpeningBalanceView(APIView):
    party_type = ''
    party_model = None

    def _ensure_party_exists(self, pk):
        get_object_or_404(self.party_model, pk=pk)

    def get(self, request, pk: int):
        self._ensure_party_exists(pk)
        loc = get_active_location(request)
        ob = PartyOpeningBalance.objects.filter(
            party_type=self.party_type, party_id=pk,
            location_id=loc.id if loc else None,
        ).first()
        if not ob:
            return Response(None)
        return Response(PartyOpeningBalanceSerializer(ob).data)

    def put(self, request, pk: int):
        self._ensure_party_exists(pk)
        user = request.user if request.user.is_authenticated else None
        loc = get_active_location(request)
        if loc is None:
            return Response(
                {'detail': 'An active store (X-Location-Id) is required to set an opening balance.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            ob = PartyOpeningBalance.objects.filter(
                party_type=self.party_type, party_id=pk, location_id=loc.id,
            ).first()
            ser = PartyOpeningBalanceSerializer(ob, data=request.data, partial=bool(ob))
            ser.is_valid(raise_exception=True)
            ser.save(
                party_type=self.party_type,
                party_id=pk,
                location_id=loc.id,
                created_by=user if not ob else (ob.created_by if ob else None),
            )
            # (Re)post the GL counterpart so the opening figure shows in the
            # trial balance and on the party ledger card. Atomic with the save:
            # if posting fails (e.g. locked period) the OB edit rolls back too.
            # Gated on the per-party-ledger flag (the OB JE posts to a party
            # ledger, so it only applies when that model is active).
            from core.party_ledgers import party_ledgers_enabled
            if party_ledgers_enabled():
                post_opening_balance_je(ser.instance, user=user)
        return Response(ser.data)

    def delete(self, request, pk: int):
        self._ensure_party_exists(pk)
        user = request.user if request.user.is_authenticated else None
        loc = get_active_location(request)
        with transaction.atomic():
            ob = PartyOpeningBalance.objects.filter(
                party_type=self.party_type, party_id=pk,
                location_id=loc.id if loc else None,
            ).first()
            if ob is None:
                return Response(status=status.HTTP_404_NOT_FOUND)
            void_opening_balance_je(ob, user=user)
            ob.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SupplierOpeningBalanceView(_PartyOpeningBalanceView):
    party_type = 'Supplier'
    party_model = SupplierRO


class CustomerOpeningBalanceView(_PartyOpeningBalanceView):
    party_type = 'Customer'
    party_model = CustomerRO


class CommunicationDetailView(APIView):
    """Update or delete a single communication entry."""

    def patch(self, request, pk: int):
        comm = get_object_or_404(PartyCommunication, pk=pk)
        ser = PartyCommunicationSerializer(comm, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    def delete(self, request, pk: int):
        comm = get_object_or_404(PartyCommunication, pk=pk)
        comm.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

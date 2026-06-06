"""GST Grand Summary (GSTR-3B-style) — rate-wise output vs input tax.

A single consolidated view for a tax period: output tax (sales / liability)
and input tax (purchases / ITC) broken down per GST slab (0 %, 5 %, 18 %, …),
plus the net payable. Computed on demand from the inventory feed (no extra
model) so it always reflects the latest synced data.

Intra-state supplies split into CGST + SGST; inter-state into IGST. For sales
the split is taken from stored per-line tax amounts where available (B2B) and
otherwise computed as a 50:50 CGST/SGST split of the tax embedded in the
tax-inclusive POS line total. Purchases use the stored per-line CGST/SGST/IGST.
"""
import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import AccountingSettings
from core.mixins import get_active_location
from core.gst_utils import back_calculate_taxable
from inventory_reader.models import (
    POSOrderRO, B2BSalesOrderRO, PurchaseOrderRO,
)

D0 = Decimal('0.00')
CENT = Decimal('0.01')
# Slabs the report always shows, even when zero, per the client template.
ALWAYS_SHOW_RATES = (Decimal('0'), Decimal('5'), Decimal('18'))


def _q(v):
    return Decimal(str(v or 0))


def _money(v):
    return v.quantize(CENT, rounding=ROUND_HALF_UP)


def _period_range(period: str):
    year, month = map(int, period.split('-'))
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    return start, end


def _blank_slab():
    return {'taxable': D0, 'cgst': D0, 'sgst': D0, 'igst': D0}


def compute_grand_summary(period: str, location_id):
    start, end = _period_range(period)
    settings = AccountingSettings.get_settings()

    output = defaultdict(_blank_slab)   # rate(Decimal) -> slab
    inp = defaultdict(_blank_slab)

    # ---- OUTPUT: POS sales (tax-inclusive line totals) ----
    pos_qs = POSOrderRO.objects.filter(
        status__in=['confirmed', 'completed'],
        sale_date__date__gte=start, sale_date__date__lte=end,
    )
    if location_id:
        pos_qs = pos_qs.filter(location_id=location_id)
    for order in pos_qs.prefetch_related('lines'):
        for line in order.lines.all():
            rate = _q(line.tax_percent)
            total = _q(line.line_total)
            taxable = back_calculate_taxable(total, rate)
            tax = total - taxable
            half = _money(tax / 2)
            s = output[rate]
            s['taxable'] += taxable
            s['cgst'] += half
            s['sgst'] += tax - half

    # ---- OUTPUT: B2B sales (tax-exclusive; stored per-line split) ----
    b2b_qs = B2BSalesOrderRO.objects.filter(
        status__in=['confirmed', 'delivered', 'invoiced'],
        sale_date__gte=start, sale_date__lte=end,
    )
    if location_id:
        b2b_qs = b2b_qs.filter(location_id=location_id)
    for order in b2b_qs.prefetch_related('lines'):
        for line in order.lines.all():
            rate = _q(line.tax_percent)
            qty = _q(line.quantity)
            taxable = qty * _q(line.unit_price) - _q(line.discount_amount)
            s = output[rate]
            s['taxable'] += taxable
            s['cgst'] += _q(line.cgst_amount)
            s['sgst'] += _q(line.sgst_amount)
            s['igst'] += _q(line.igst_amount)

    # ---- INPUT (ITC): purchases (stored per-line split) ----
    po_qs = PurchaseOrderRO.objects.filter(
        state__in=['confirmed', 'done', 'approved'],
        bill_date__gte=start, bill_date__lte=end,
    )
    if location_id:
        po_qs = po_qs.filter(location_id=location_id)
    for po in po_qs.prefetch_related('lines'):
        for line in po.lines.all():
            rate = _q(line.tax_percent)
            units = _q(line.quantity) + _q(line.free_qty)
            taxable = units * _q(line.purchase_rate) * (Decimal('100') - _q(line.discount_percent)) / Decimal('100')
            s = inp[rate]
            s['taxable'] += taxable
            s['cgst'] += _q(line.cgst_amount)
            s['sgst'] += _q(line.sgst_amount)
            s['igst'] += _q(line.igst_amount)

    rates = sorted(set(output) | set(inp) | set(ALWAYS_SHOW_RATES))

    def serialise(slab):
        tax = slab['cgst'] + slab['sgst'] + slab['igst']
        return {
            'taxable': str(_money(slab['taxable'])),
            'cgst': str(_money(slab['cgst'])),
            'sgst': str(_money(slab['sgst'])),
            'igst': str(_money(slab['igst'])),
            'total_tax': str(_money(tax)),
        }

    slabs = []
    out_tot = _blank_slab()
    in_tot = _blank_slab()
    for rate in rates:
        o = output.get(rate, _blank_slab())
        i = inp.get(rate, _blank_slab())
        for k in ('taxable', 'cgst', 'sgst', 'igst'):
            out_tot[k] += o[k]
            in_tot[k] += i[k]
        slabs.append({
            'rate': str(rate.quantize(Decimal('0.01')).normalize()) if rate else '0',
            'output': serialise(o),
            'input': serialise(i),
        })

    out_tax = out_tot['cgst'] + out_tot['sgst'] + out_tot['igst']
    in_tax = in_tot['cgst'] + in_tot['sgst'] + in_tot['igst']
    net_cgst = out_tot['cgst'] - in_tot['cgst']
    net_sgst = out_tot['sgst'] - in_tot['sgst']
    net_igst = out_tot['igst'] - in_tot['igst']

    return {
        'period': period,
        'return_type': 'GSTR-3B',
        'business_name': settings.company_name,
        'gstin': settings.gstin or '',
        'location_id': location_id,
        'slabs': slabs,
        'output_totals': serialise(out_tot),
        'input_totals': serialise(in_tot),
        'net': {
            'total_liability': str(_money(out_tax)),
            'total_itc': str(_money(in_tax)),
            'net_cgst': str(_money(net_cgst)),
            'net_sgst': str(_money(net_sgst)),
            'net_igst': str(_money(net_igst)),
            'net_payable': str(_money(max(D0, net_cgst) + max(D0, net_sgst) + max(D0, net_igst))),
            'itc_carry_forward': str(_money(max(D0, -net_cgst) + max(D0, -net_sgst) + max(D0, -net_igst))),
            'late_fee': '0.00',
            'interest': '0.00',
        },
    }


class GSTGrandSummaryView(APIView):
    """GET /api/gst/grand-summary/?period=YYYY-MM — rate-wise GST summary."""

    def get(self, request):
        period = request.query_params.get('period') or date.today().strftime('%Y-%m')
        location = get_active_location(request)
        location_id = location.id if location else None
        data = compute_grand_summary(period, location_id)
        return Response(data)

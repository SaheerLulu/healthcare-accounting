"""
Live GST register builders (FRS register screens).

GSTR1Entry snapshots are one row per DOCUMENT with a blended "effective rate"
for multi-rate invoices, so they cannot back the rate-wise registers the FRS
(and the GSTR-1 portal tables) require. These builders re-read the inventory
documents and emit RATE-WISE rows — one row per (document, GST rate) with the
common invoice details repeated — mirroring GSTR1Generator's per-line
arithmetic (back-calculation from tax-inclusive POS/return lines, per-line
half-split for intra-state) so register totals agree with the generated
GSTR-1 and the auto-posted journal entries.

All builders accept location_id=None for the consolidated all-stores view;
the filer identity (own GSTIN/state — decides intra vs inter state) is
resolved per document location via LocationTaxProfile.

The _fetch_* helpers exist so tests can stub the unmanaged inventory_reader
querysets (those tables don't exist in the SQLite test DB).
"""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Q

from core.models import LocationTaxProfile
from core.gst_utils import (
    back_calculate_taxable, compute_tax_split, detect_supply_type,
    state_name_to_code,
)

TWO_PLACES = Decimal('0.01')


def split_period(period):
    """Validate and split 'YYYY-MM' → (year, month). Raises ValueError."""
    year, month = map(int, str(period).split('-'))
    if not (1 <= month <= 12):
        raise ValueError('month out of range')
    return year, month


def period_date_range(period):
    """'YYYY-MM' → (first_day, last_day) of that month."""
    year, month = split_period(period)
    return date(year, month, 1), _month_end(year, month)


def _month_end(year, month):
    from datetime import timedelta
    if month == 12:
        return date(year, 12, 31)
    return date(year, month + 1, 1) - timedelta(days=1)


def _dec(value):
    return Decimal(str(value or 0))


def _q2(value):
    return _dec(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def _rate(value):
    return _dec(value).quantize(TWO_PLACES)


class _FilerCache:
    """LocationTaxProfile.resolve() once per location touched by a register."""

    def __init__(self):
        self._by_loc = {}

    def get(self, location_id):
        if location_id not in self._by_loc:
            self._by_loc[location_id] = LocationTaxProfile.resolve(location_id)
        return self._by_loc[location_id]


def _accumulate_inclusive_line(bucket, line_total, tax_percent, supply_type):
    """Per-line arithmetic for tax-INCLUSIVE lines (POS sales, sales returns),
    identical to GSTR1Generator: back-calc taxable, then per-line half-split."""
    line_total = _dec(line_total)
    taxable = back_calculate_taxable(line_total, tax_percent)
    tax = line_total - taxable
    bucket['taxable'] += taxable
    if supply_type == 'inter_state':
        bucket['igst'] += tax
    else:
        half = (tax / Decimal('2')).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
        bucket['cgst'] += half
        bucket['sgst'] += tax - half


def _new_bucket():
    return {
        'taxable': Decimal('0.00'), 'cgst': Decimal('0.00'),
        'sgst': Decimal('0.00'), 'igst': Decimal('0.00'),
    }


def _finalize_bucket(bucket):
    return {k: _q2(v) for k, v in bucket.items()}


# ─── Query helpers (patched in tests — inventory tables are absent there) ───

def _fetch_pos_orders(year, month, location_id=None):
    from inventory_reader.models import POSOrderRO
    qs = POSOrderRO.objects.filter(
        sale_date__year=year, sale_date__month=month,
        status__in=['confirmed', 'completed'],
    ).prefetch_related('lines__product')
    if location_id:
        qs = qs.filter(location_id=location_id)
    return list(qs)


def _fetch_pos_customers(customer_ids):
    from inventory_reader.models import CustomerRO
    try:
        return CustomerRO.objects.in_bulk(list(customer_ids)) if customer_ids else {}
    except Exception:
        return {}


def _fetch_b2b_orders(year, month, location_id=None):
    from inventory_reader.models import B2BSalesOrderRO
    qs = B2BSalesOrderRO.objects.filter(
        sale_date__year=year, sale_date__month=month,
        status__in=['confirmed', 'delivered', 'invoiced'],
        source_indent_id__isnull=True,
    ).select_related('customer').prefetch_related('lines')
    if location_id:
        qs = qs.filter(location_id=location_id)
    return list(qs)


def _fetch_sales_returns(year, month, location_id=None):
    from inventory_reader.models import SalesReturnRO
    qs = SalesReturnRO.objects.filter(
        return_date__year=year, return_date__month=month,
        status__in=['confirmed', 'completed'],
    ).select_related('customer', 'original_order', 'original_b2b_order'
                     ).prefetch_related('lines')
    if location_id:
        qs = qs.filter(location_id=location_id)
    return list(qs)


def _fetch_purchases(start_date, end_date, location_id=None):
    from inventory_reader.models import PurchaseOrderRO
    qs = PurchaseOrderRO.objects.filter(
        state__in=['confirmed', 'done', 'approved'],
    ).exclude(
        # Indent-origin transfer GRNs are same-GSTIN stock relocations — no
        # supplier invoice, no ITC (same rule as GSTR2BGenerator).
        transfer_kind__in=PurchaseOrderRO.TRANSFER_KINDS,
    ).filter(
        Q(bill_date__gte=start_date, bill_date__lte=end_date) |
        Q(bill_date__isnull=True,
          created_at__date__gte=start_date, created_at__date__lte=end_date)
    ).select_related('supplier').prefetch_related('lines')
    if location_id:
        qs = qs.filter(location_id=location_id)
    return list(qs)


# ─── B2B register (GSTR-1 Table 4) ───────────────────────────────────────

def build_b2b_register(period, location_id=None):
    """Invoice-and-rate-wise register of outward supplies to registered
    buyers: one row per (invoice, GST rate), invoice header details repeated
    on every row (portal Table 4 shape)."""
    year, month = split_period(period)
    filers = _FilerCache()
    rows = []

    def _emit(order_key, gstin, party_name, invoice_no, invoice_date,
              invoice_value, pos_code, supply_type, per_rate, source, loc_id):
        for rate in sorted(per_rate):
            agg = _finalize_bucket(per_rate[rate])
            rows.append({
                'gstin': gstin,
                'party_name': party_name,
                'invoice_no': invoice_no,
                'invoice_date': invoice_date,
                'invoice_value': _q2(invoice_value),
                'place_of_supply': pos_code,
                'supply_type': supply_type,
                'rate': rate,
                'taxable_value': agg['taxable'],
                'cgst': agg['cgst'],
                'sgst': agg['sgst'],
                'igst': agg['igst'],
                'source': source,
                'location_id': loc_id,
                '_doc': order_key,
            })

    # B2B sales orders to registered buyers
    for order in _fetch_b2b_orders(year, month, location_id):
        customer = order.customer
        gstin = (customer.gst_no or '') if customer else ''
        if not gstin:
            continue  # unregistered → B2C summary, not this register
        biz = filers.get(order.location_id)
        state_code = state_name_to_code(customer.state or '') if customer else ''
        supply_type = detect_supply_type(biz.gstin, gstin, biz.state_code, state_code)

        per_rate = {}
        for line in order.lines.all():
            line_tax = (_dec(line.cgst_amount) + _dec(line.sgst_amount)
                        + _dec(line.igst_amount))
            taxable = _dec(line.line_total) - line_tax
            bucket = per_rate.setdefault(_rate(line.tax_percent), _new_bucket())
            bucket['taxable'] += taxable
            if supply_type == 'inter_state':
                bucket['igst'] += line_tax
            else:
                half = (line_tax / Decimal('2')).quantize(
                    TWO_PLACES, rounding=ROUND_HALF_UP)
                bucket['cgst'] += half
                bucket['sgst'] += line_tax - half

        inv_date = order.sale_date or (order.created_at.date() if order.created_at else None)
        _emit(('b2b', order.id), gstin,
              customer.customer_name if customer else '',
              order.invoice_no or f'B2B-{order.id}', inv_date,
              order.total_amount, gstin[:2], supply_type, per_rate,
              'b2b', order.location_id)

    # POS sales where the buyer's GSTIN was captured (counter B2B)
    pos_orders = _fetch_pos_orders(year, month, location_id)
    customers = _fetch_pos_customers({p.customer_id for p in pos_orders if p.customer_id})
    for pos in pos_orders:
        customer = customers.get(pos.customer_id) if pos.customer_id else None
        gstin = (customer.gst_no or '') if customer else ''
        if not gstin:
            continue
        biz = filers.get(pos.location_id)
        state_code = state_name_to_code(customer.state or '') if customer else ''
        supply_type = detect_supply_type(biz.gstin, gstin, biz.state_code, state_code)

        per_rate = {}
        for line in pos.lines.all():
            bucket = per_rate.setdefault(_rate(line.tax_percent), _new_bucket())
            _accumulate_inclusive_line(bucket, line.line_total,
                                       line.tax_percent, supply_type)

        inv_date = pos.sale_date.date() if hasattr(pos.sale_date, 'date') else pos.sale_date
        _emit(('pos', pos.id), gstin,
              customer.customer_name if customer else '',
              pos.invoice_no or f'POS-{pos.id}', inv_date,
              pos.total_amount, gstin[:2], supply_type, per_rate,
              'pos', pos.location_id)

    rows.sort(key=lambda r: (r['invoice_date'] or date.min, r['invoice_no'], r['rate']))
    invoice_count = len({r.pop('_doc') for r in rows}) if rows else 0
    totals = sum_tax_rows(rows)
    return {'rows': rows, 'totals': totals, 'invoice_count': invoice_count}


# ─── B2C summary (GSTR-1 Table 7 — B2C Others) ───────────────────────────

def build_b2c_summary(period, location_id=None):
    """Rate-wise consolidated summary of unregistered-buyer supplies, grouped
    by (place of supply, rate) and netted against unregistered credit notes —
    the GSTR-1 Table 7 shape. B2C-Large invoices (inter-state above the
    date-aware threshold) belong in Table 5 and are excluded; their count is
    returned in `b2cl_excluded`."""
    from .services import b2cl_threshold

    year, month = split_period(period)
    filers = _FilerCache()
    buckets = {}
    b2cl_excluded = 0

    def _bucket(pos_code, rate, supply_type):
        key = (pos_code, rate, supply_type)
        if key not in buckets:
            buckets[key] = _new_bucket()
        return buckets[key]

    # POS sales without a buyer GSTIN
    pos_orders = _fetch_pos_orders(year, month, location_id)
    customers = _fetch_pos_customers({p.customer_id for p in pos_orders if p.customer_id})
    for pos in pos_orders:
        customer = customers.get(pos.customer_id) if pos.customer_id else None
        gstin = (customer.gst_no or '') if customer else ''
        if gstin:
            continue  # registered → B2B register
        biz = filers.get(pos.location_id)
        state_code = state_name_to_code(customer.state or '') if customer else ''
        supply_type = detect_supply_type(biz.gstin, gstin, biz.state_code, state_code)
        inv_date = pos.sale_date.date() if hasattr(pos.sale_date, 'date') else pos.sale_date
        if supply_type == 'inter_state' and _dec(pos.total_amount) > b2cl_threshold(inv_date):
            b2cl_excluded += 1
            continue
        pos_code = state_code or biz.state_code
        for line in pos.lines.all():
            _accumulate_inclusive_line(
                _bucket(pos_code, _rate(line.tax_percent), supply_type),
                line.line_total, line.tax_percent, supply_type)

    # B2B-module orders without a GSTIN (unregistered institutional buyers)
    for order in _fetch_b2b_orders(year, month, location_id):
        customer = order.customer
        gstin = (customer.gst_no or '') if customer else ''
        if gstin:
            continue
        biz = filers.get(order.location_id)
        state_code = state_name_to_code(customer.state or '') if customer else ''
        supply_type = detect_supply_type(biz.gstin, gstin, biz.state_code, state_code)
        inv_date = order.sale_date or (order.created_at.date() if order.created_at else None)
        if supply_type == 'inter_state' and _dec(order.total_amount) > b2cl_threshold(inv_date):
            b2cl_excluded += 1
            continue
        pos_code = state_code or biz.state_code
        for line in order.lines.all():
            line_tax = (_dec(line.cgst_amount) + _dec(line.sgst_amount)
                        + _dec(line.igst_amount))
            taxable = _dec(line.line_total) - line_tax
            bucket = _bucket(pos_code, _rate(line.tax_percent), supply_type)
            bucket['taxable'] += taxable
            if supply_type == 'inter_state':
                bucket['igst'] += line_tax
            else:
                half = (line_tax / Decimal('2')).quantize(
                    TWO_PLACES, rounding=ROUND_HALF_UP)
                bucket['cgst'] += half
                bucket['sgst'] += line_tax - half

    # Net off unregistered credit notes (Table 7 is reported net of B2C CNs)
    for ret in _fetch_sales_returns(year, month, location_id):
        customer = ret.customer
        if customer and getattr(customer, 'is_internal', False):
            continue
        gstin = (customer.gst_no or '') if customer else ''
        if gstin:
            continue  # registered CNs are CDNR — credit-note register
        biz = filers.get(ret.location_id)
        state_code = state_name_to_code(customer.state or '') if customer else ''
        supply_type = (
            'intra_state'
            if ret.return_type == 'pos' and not gstin and not state_code
            else detect_supply_type(biz.gstin, gstin, biz.state_code, state_code)
        )
        pos_code = state_code or biz.state_code
        for line in ret.lines.all():
            neg = _new_bucket()
            _accumulate_inclusive_line(neg, line.line_total,
                                       line.tax_percent, supply_type)
            bucket = _bucket(pos_code, _rate(line.tax_percent), supply_type)
            for k in bucket:
                bucket[k] -= neg[k]

    rows = []
    for (pos_code, rate, supply_type) in sorted(buckets):
        agg = _finalize_bucket(buckets[(pos_code, rate, supply_type)])
        if not any(agg.values()):
            continue
        rows.append({
            'place_of_supply': pos_code,
            'supply_type': supply_type,
            'rate': rate,
            'taxable_value': agg['taxable'],
            'cgst': agg['cgst'],
            'sgst': agg['sgst'],
            'igst': agg['igst'],
            'total_tax': _q2(agg['cgst'] + agg['sgst'] + agg['igst']),
        })
    rows.sort(key=lambda r: (r['rate'], r['place_of_supply']))
    return {'rows': rows, 'totals': sum_tax_rows(rows),
            'b2cl_excluded': b2cl_excluded}


# ─── Credit-note register (GSTR-1 Tables 9B CDNR / CDNUR) ────────────────

def build_credit_note_register(period, location_id=None):
    """Rate-wise register of credit notes (sales returns): one row per
    (credit note, GST rate). Amounts are positive — the note type says they
    reduce outward liability. Includes the §34(2) time-bar flag computed
    against the ORIGINAL invoice date (same rule as GSTR1Generator)."""
    year, month = split_period(period)
    filers = _FilerCache()
    rows = []

    for ret in _fetch_sales_returns(year, month, location_id):
        customer = ret.customer
        if customer and getattr(customer, 'is_internal', False):
            continue
        gstin = (customer.gst_no or '') if customer else ''
        state_code = state_name_to_code(customer.state or '') if customer else ''
        biz = filers.get(ret.location_id)
        supply_type = (
            'intra_state'
            if ret.return_type == 'pos' and not gstin and not state_code
            else detect_supply_type(biz.gstin, gstin, biz.state_code, state_code)
        )
        ret_date = ret.return_date.date() if hasattr(ret.return_date, 'date') else ret.return_date

        # Original invoice + §34(2) time bar (30 Nov of FY following supply)
        original_inv = ''
        original_inv_date = None
        if getattr(ret, 'original_b2b_order_id', None):
            try:
                original_inv = ret.original_b2b_order.invoice_no or ''
                original_inv_date = ret.original_b2b_order.sale_date
            except Exception:
                pass
        elif getattr(ret, 'original_order_id', None):
            try:
                original_inv = ret.original_order.invoice_no or ''
                src_dt = ret.original_order.sale_date
                original_inv_date = src_dt.date() if hasattr(src_dt, 'date') else src_dt
            except Exception:
                pass
        anchor = original_inv_date or ret_date
        fy_year = anchor.year if anchor.month >= 4 else anchor.year - 1
        is_time_barred = ret_date > date(fy_year + 1, 11, 30)

        per_rate = {}
        for line in ret.lines.all():
            bucket = per_rate.setdefault(_rate(line.tax_percent), _new_bucket())
            _accumulate_inclusive_line(bucket, line.line_total,
                                       line.tax_percent, supply_type)

        for rate in sorted(per_rate):
            agg = _finalize_bucket(per_rate[rate])
            rows.append({
                'gstin': gstin,
                'party_name': (customer.customer_name if customer else '') or 'Walk-in customer',
                'note_no': ret.return_no or f'RET-{ret.id}',
                'note_date': ret_date,
                'original_invoice_no': original_inv,
                'original_invoice_date': original_inv_date,
                'note_type': 'CDNR' if gstin else 'CDNUR',
                'supply_type': supply_type,
                'rate': rate,
                'taxable_value': agg['taxable'],
                'cgst': agg['cgst'],
                'sgst': agg['sgst'],
                'igst': agg['igst'],
                'total': _q2(agg['taxable'] + agg['cgst'] + agg['sgst'] + agg['igst']),
                'is_time_barred': is_time_barred,
                'reason': getattr(ret, 'reason', '') or '',
                'location_id': ret.location_id,
                '_doc': ret.id,
            })

    rows.sort(key=lambda r: (r['note_date'] or date.min, r['note_no'], r['rate']))
    note_count = len({r.pop('_doc') for r in rows}) if rows else 0
    return {'rows': rows, 'totals': sum_tax_rows(rows), 'note_count': note_count}


# ─── Purchase register ───────────────────────────────────────────────────

def build_purchase_register(start_date, end_date, location_id=None):
    """Supplier-invoice-wise purchase register over a date range, derived the
    same way as GSTR2BGenerator (line taxable = qty x rate x discount factor,
    tax re-split by the supply type derived from the supplier's GSTIN/state).
    Covers registered and unregistered suppliers; internal transfer GRNs are
    excluded. Freight/round-off charges are not part of taxable value."""
    filers = _FilerCache()
    rows = []
    registered = unregistered = 0

    for po in _fetch_purchases(start_date, end_date, location_id):
        supplier = po.supplier
        supplier_gstin = (supplier.gst_no or '') if supplier else ''
        supplier_name = (supplier.company_name if supplier
                         else f'Supplier #{po.supplier_id}')
        supplier_state = state_name_to_code(supplier.state or '') if supplier else ''
        biz = filers.get(po.location_id)
        supply_type = detect_supply_type(
            biz.gstin, supplier_gstin, biz.state_code, supplier_state)

        agg = _new_bucket()
        for line in po.lines.all():
            qty = _dec(line.quantity) + _dec(line.free_qty)
            discount_factor = (Decimal('100') - _dec(line.discount_percent)) / Decimal('100')
            line_taxable = qty * _dec(line.purchase_rate) * discount_factor
            agg['taxable'] += line_taxable
            split = compute_tax_split(line_taxable, _dec(line.tax_percent), supply_type)
            agg['cgst'] += split['cgst']
            agg['sgst'] += split['sgst']
            agg['igst'] += split['igst']

        agg = _finalize_bucket(agg)
        if supplier_gstin:
            registered += 1
        else:
            unregistered += 1
        rows.append({
            'supplier_gstin': supplier_gstin or 'Unregistered',
            'supplier_name': supplier_name,
            'registered': bool(supplier_gstin),
            'invoice_no': po.bill_no or f'PO-{po.id}',
            'invoice_date': po.bill_date or (po.created_at.date() if po.created_at else None),
            'supply_type': supply_type,
            'taxable_value': agg['taxable'],
            'cgst': agg['cgst'],
            'sgst': agg['sgst'],
            'igst': agg['igst'],
            'invoice_value': _q2(agg['taxable'] + agg['cgst'] + agg['sgst'] + agg['igst']),
            'location_id': po.location_id,
        })

    rows.sort(key=lambda r: (r['invoice_date'] or date.min, r['invoice_no']))
    totals = sum_tax_rows(rows)
    totals['invoice_value'] = str(_q2(sum(_dec(r['invoice_value']) for r in rows)))
    return {'rows': rows, 'totals': totals,
            'registered_count': registered, 'unregistered_count': unregistered}


# ─── shared totals / serialization ───────────────────────────────────────

def sum_tax_rows(rows):
    totals = {
        'taxable_value': Decimal('0.00'), 'cgst': Decimal('0.00'),
        'sgst': Decimal('0.00'), 'igst': Decimal('0.00'),
    }
    for r in rows:
        for k in totals:
            totals[k] += _dec(r.get(k))
    totals['total_tax'] = totals['cgst'] + totals['sgst'] + totals['igst']
    return {k: str(_q2(v)) for k, v in totals.items()}


def serialize_rows(rows):
    """Decimals → str, dates → ISO, for JSON responses."""
    out = []
    for r in rows:
        item = {}
        for k, v in r.items():
            if isinstance(v, Decimal):
                item[k] = str(v)
            elif isinstance(v, date):
                item[k] = v.isoformat()
            else:
                item[k] = v
        out.append(item)
    return out

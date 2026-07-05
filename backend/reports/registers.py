"""
Books-side register builders: Expense Register and Asset Register.

The Expense Register merges the two manual expense channels — direct
expenses (`expenses.Expense`, money already paid) and vendor bills
(`bills.Bill`, payable-tracked) — into one date-ordered register with the
GST/ITC columns the FRS asks for. GST on both is captured at voucher level
(tax_cgst/tax_sgst/tax_igst posted to the INPUT_* GL accounts), so rows are
per voucher with the expense heads joined into one column.

The Asset Register lists `fixed_assets.FixedAsset` rows with the input-GST
split recovered from each asset's acquisition journal entry (INPUT_CGST /
INPUT_SGST / INPUT_IGST lines — base codes 1140/1150/1160 plus their
per-store clones, same matching rule as GSTR3BGenerator).

Supplier GSTINs come from the inventory master (SupplierRO.gst_no) via
`_supplier_gstin_map`, which is defensive (and patchable in tests) because
the inventory tables live in a different, sometimes-unavailable database.
"""
from decimal import Decimal

from gst_returns.registers import _dec, _q2, serialize_rows, sum_tax_rows  # noqa: F401 (serialize_rows re-exported for views)


def _supplier_gstin_map(vendor_ids):
    """vendor_id → GSTIN from the inventory supplier master; {} on failure."""
    vendor_ids = {v for v in vendor_ids if v}
    if not vendor_ids:
        return {}
    try:
        from inventory_reader.models import SupplierRO
        return {
            s.id: (s.gst_no or '')
            for s in SupplierRO.objects.filter(id__in=vendor_ids)
        }
    except Exception:
        return {}


# ─── Expense register ─────────────────────────────────────────────────────

def build_expense_register(start_date, end_date, location_id=None):
    from bills.models import Bill
    from expenses.models import Expense

    exp_qs = Expense.objects.filter(
        status='recorded',
        expense_date__gte=start_date, expense_date__lte=end_date,
    ).select_related('paid_through_account', 'journal_entry'
                     ).prefetch_related('items__account')
    bill_qs = Bill.objects.filter(
        status__in=['open', 'partially_paid', 'paid'],
        bill_date__gte=start_date, bill_date__lte=end_date,
    ).select_related('journal_entry').prefetch_related('lines__account')
    if location_id:
        exp_qs = exp_qs.filter(location_id=location_id)
        bill_qs = bill_qs.filter(location_id=location_id)

    expenses = list(exp_qs)
    bills = list(bill_qs)
    gstin_map = _supplier_gstin_map(
        [e.vendor_id for e in expenses] + [b.vendor_id for b in bills])

    rows = []
    for e in expenses:
        heads = ', '.join(dict.fromkeys(
            i.account.account_name for i in e.items.all() if i.account_id))
        rows.append({
            'date': e.expense_date,
            'voucher_no': (e.journal_entry.entry_no if e.journal_entry_id
                           else f'EXP-{e.id}'),
            'source': 'Expense',
            'head': heads or '—',
            'party_name': e.vendor_name or '—',
            'gstin': gstin_map.get(e.vendor_id, ''),
            'taxable_value': _q2(e.subtotal),
            'cgst': _q2(e.tax_cgst),
            'sgst': _q2(e.tax_sgst),
            'igst': _q2(e.tax_igst),
            'total': _q2(e.total_amount),
            'paid_through': (e.paid_through_account.account_name
                             if e.paid_through_account_id else ''),
            'location_id': e.location_id,
        })
    for b in bills:
        heads = ', '.join(dict.fromkeys(
            l.account.account_name for l in b.lines.all() if l.account_id))
        rows.append({
            'date': b.bill_date,
            'voucher_no': b.bill_no or (b.journal_entry.entry_no
                                        if b.journal_entry_id else f'BILL-{b.id}'),
            'source': 'Bill',
            'head': heads or '—',
            'party_name': b.vendor_name or '—',
            'gstin': gstin_map.get(b.vendor_id, ''),
            'taxable_value': _q2(b.subtotal),
            'cgst': _q2(b.tax_cgst),
            'sgst': _q2(b.tax_sgst),
            'igst': _q2(b.tax_igst),
            'total': _q2(b.total_amount),
            'paid_through': '',
            'location_id': b.location_id,
        })

    rows.sort(key=lambda r: (r['date'], r['voucher_no']))
    totals = sum_tax_rows(rows)
    totals['total'] = str(_q2(sum(_dec(r['total']) for r in rows)))
    non_gst = sum(1 for r in rows
                  if _dec(r['cgst']) + _dec(r['sgst']) + _dec(r['igst']) == 0)
    return {'rows': rows, 'totals': totals,
            'voucher_count': len(rows), 'non_gst_count': non_gst}


# ─── Asset register ───────────────────────────────────────────────────────

_INPUT_GST_BASES = (('1140', 'cgst'), ('1150', 'sgst'), ('1160', 'igst'))


def _input_gst_component(account_code):
    """Map an account code to cgst/sgst/igst if it is an Input GST account
    (base code or per-store clone like '1140-MUM'); None otherwise."""
    for base, key in _INPUT_GST_BASES:
        if account_code == base or account_code.startswith(base + '-'):
            return key
    return None


def build_asset_register(start_date=None, end_date=None, location_id=None):
    """Fixed-asset register with acquisition-time ITC. Date range (optional)
    filters on acquisition_date; depreciation/NBV are computed as of
    end_date's month (or all booked depreciation when no end_date)."""
    from fixed_assets.models import FixedAsset

    qs = FixedAsset.objects.select_related(
        'asset_class', 'acquisition_journal_entry',
    ).prefetch_related('depreciation_entries',
                       'acquisition_journal_entry__lines__account')
    if start_date:
        qs = qs.filter(acquisition_date__gte=start_date)
    if end_date:
        qs = qs.filter(acquisition_date__lte=end_date)
    if location_id:
        qs = qs.filter(location_id=location_id)

    assets = list(qs.order_by('acquisition_date', 'asset_no'))
    gstin_map = _supplier_gstin_map([a.vendor_id for a in assets])
    as_of_period = end_date.strftime('%Y-%m') if end_date else None

    rows = []
    for a in assets:
        taxes = {'cgst': Decimal('0.00'), 'sgst': Decimal('0.00'),
                 'igst': Decimal('0.00')}
        if a.acquisition_journal_entry_id:
            for line in a.acquisition_journal_entry.lines.all():
                component = _input_gst_component(
                    line.account.account_code if line.account_id else '')
                if component:
                    taxes[component] += line.debit - line.credit
        accum = sum(
            (d.amount for d in a.depreciation_entries.all()
             if as_of_period is None or d.period <= as_of_period),
            Decimal('0.00'),
        )
        rows.append({
            'asset_no': a.asset_no,
            'name': a.name,
            'asset_class': a.asset_class.name if a.asset_class_id else '',
            'party_name': a.vendor_name or '—',
            'gstin': gstin_map.get(a.vendor_id, ''),
            'acquisition_date': a.acquisition_date,
            'acquisition_cost': _q2(a.acquisition_cost),
            'cgst': _q2(taxes['cgst']),
            'sgst': _q2(taxes['sgst']),
            'igst': _q2(taxes['igst']),
            'invoice_value': _q2(_dec(a.acquisition_cost) + taxes['cgst']
                                 + taxes['sgst'] + taxes['igst']),
            'accumulated_depreciation': _q2(accum),
            'net_book_value': _q2(_dec(a.acquisition_cost) - accum),
            'status': a.status,
            'location_id': a.location_id,
        })

    totals = {
        'acquisition_cost': str(_q2(sum(_dec(r['acquisition_cost']) for r in rows))),
        'cgst': str(_q2(sum(_dec(r['cgst']) for r in rows))),
        'sgst': str(_q2(sum(_dec(r['sgst']) for r in rows))),
        'igst': str(_q2(sum(_dec(r['igst']) for r in rows))),
        'accumulated_depreciation': str(_q2(sum(
            _dec(r['accumulated_depreciation']) for r in rows))),
        'net_book_value': str(_q2(sum(_dec(r['net_book_value']) for r in rows))),
    }
    return {'rows': rows, 'totals': totals, 'asset_count': len(rows)}

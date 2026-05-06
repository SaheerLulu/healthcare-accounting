"""
GST set-off computation per CGST Section 49(2)(b) read with Rule 88A.

Statutory order (post the 2019 amendment):
  1. ITC of IGST: must be **fully exhausted first**, in this order —
       a) against IGST output liability
       b) then against CGST liability
       c) then against SGST liability
  2. ITC of CGST:
       a) against CGST liability
       b) any balance against IGST liability
       (cannot be used against SGST)
  3. ITC of SGST:
       a) against SGST liability
       b) any balance against IGST liability
       (cannot be used against CGST)

The function returns:
  used      — how much of each ITC bucket was applied to which output bucket
  remaining_payable — leftover output liability that must be paid in cash
  remaining_itc     — unused ITC carried forward to next period

This is a pure function — no DB I/O — so the caller (GSTR-3B generator,
dashboard widgets) can use it freely without worrying about side effects.
"""
from decimal import Decimal


def _zero():
    return Decimal('0.00')


def compute_gst_setoff(
    *,
    itc_igst: Decimal, itc_cgst: Decimal, itc_sgst: Decimal,
    out_igst: Decimal, out_cgst: Decimal, out_sgst: Decimal,
) -> dict:
    """Apply CGST §49 set-off rules. All inputs must be non-negative Decimals."""
    # Sanitize / coerce
    def _d(x):
        return Decimal(str(x)) if not isinstance(x, Decimal) else x

    itc = {'IGST': _d(itc_igst), 'CGST': _d(itc_cgst), 'SGST': _d(itc_sgst)}
    out = {'IGST': _d(out_igst), 'CGST': _d(out_cgst), 'SGST': _d(out_sgst)}
    used = {'IGST': {'IGST': _zero(), 'CGST': _zero(), 'SGST': _zero()},
            'CGST': {'IGST': _zero(), 'CGST': _zero()},
            'SGST': {'IGST': _zero(), 'SGST': _zero()}}

    def _apply(itc_key: str, out_key: str):
        amt = min(itc[itc_key], out[out_key])
        if amt <= 0:
            return
        itc[itc_key] -= amt
        out[out_key] -= amt
        used[itc_key][out_key] = used[itc_key].get(out_key, _zero()) + amt

    # Step 1 — IGST credit, exhaust it
    _apply('IGST', 'IGST')
    _apply('IGST', 'CGST')
    _apply('IGST', 'SGST')

    # Step 2 — CGST credit
    _apply('CGST', 'CGST')
    _apply('CGST', 'IGST')

    # Step 3 — SGST credit
    _apply('SGST', 'SGST')
    _apply('SGST', 'IGST')

    return {
        'used': used,
        'remaining_payable': {
            'IGST': out['IGST'], 'CGST': out['CGST'], 'SGST': out['SGST'],
            'TOTAL': out['IGST'] + out['CGST'] + out['SGST'],
        },
        'remaining_itc': {
            'IGST': itc['IGST'], 'CGST': itc['CGST'], 'SGST': itc['SGST'],
            'TOTAL': itc['IGST'] + itc['CGST'] + itc['SGST'],
        },
    }

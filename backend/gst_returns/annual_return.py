"""
GSTR-9 Annual Return generator.

GSTR-9 must be filed by every regular GST registrant whose aggregate turnover
exceeds ₹2 Cr in a financial year. It consolidates all monthly GSTR-1 + 3B +
2B data for the FY.

This module produces the data structure for Tables 4–9 (the bulk of the
return). Tables 10–14 (amendments) and 15–19 (other info) are emitted as
empty templates that the user fills manually before filing.
"""
from datetime import date
from decimal import Decimal

from django.db.models import Sum

from .models import GSTR1Entry, GSTR2BEntry, GSTR3BSummary


def _sum(qs, *fields):
    agg = qs.aggregate(**{f: Sum(f) for f in fields})
    return {f: agg[f] or Decimal('0.00') for f in fields}


def fy_period_list(fy_start_year: int) -> list[str]:
    """All YYYY-MM periods inside an Indian FY (Apr–Mar)."""
    periods = []
    for m in range(4, 13):
        periods.append(f'{fy_start_year}-{m:02d}')
    for m in range(1, 4):
        periods.append(f'{fy_start_year + 1}-{m:02d}')
    return periods


def generate_gstr9(*, fy_start_year: int, location_id: int) -> dict:
    """Build the GSTR-9 payload for the given FY + location."""
    periods = fy_period_list(fy_start_year)

    g1 = GSTR1Entry.objects.filter(
        period__in=periods, location_id=location_id, is_active=True,
    )
    g2b = GSTR2BEntry.objects.filter(
        period__in=periods, location_id=location_id,
    )
    g3b = GSTR3BSummary.objects.filter(
        period__in=periods, location_id=location_id,
    )

    # Table 4 — Outward supplies on which tax is payable
    b2b = _sum(g1.filter(invoice_type='B2B'),
               'taxable_value', 'cgst', 'sgst', 'igst', 'cess')
    b2c_large = _sum(g1.filter(invoice_type='B2C_LARGE'),
                     'taxable_value', 'cgst', 'sgst', 'igst', 'cess')
    b2c_small = _sum(g1.filter(invoice_type='B2C_SMALL'),
                     'taxable_value', 'cgst', 'sgst', 'igst', 'cess')
    cdnr = _sum(g1.filter(invoice_type__in=('CDNR', 'CREDIT_NOTE', 'DEBIT_NOTE')),
                'taxable_value', 'cgst', 'sgst', 'igst', 'cess')

    # Table 5 — Outward, no tax (zero-rated, exempt, NIL)
    nil = _sum(g1.filter(invoice_type='NIL'), 'taxable_value')

    # Table 6 — ITC from GSTR-2B
    itc_from_2b = _sum(g2b.filter(itc_eligible=True),
                       'taxable_value', 'cgst', 'sgst', 'igst')

    # Table 9 — Tax paid (from GSTR-3B)
    tax_paid = _sum(g3b,
                    'outward_igst', 'outward_cgst', 'outward_sgst',
                    'itc_igst', 'itc_cgst', 'itc_sgst',
                    'net_payable_igst', 'net_payable_cgst', 'net_payable_sgst')

    # Aggregate turnover (used for threshold check). Credit notes are stored
    # with negative `taxable_value` in GSTR1Entry (see GSTR1Generator.generate
    # line 292), so summing them in directly is what nets them out — adding a
    # negative subtracts. The previous `- cdnr` formula subtracted again,
    # double-counting the reduction (and inflating turnover by 2× the CDN
    # value, since two negatives become a positive).
    total_turnover = (
        b2b['taxable_value'] + b2c_large['taxable_value'] +
        b2c_small['taxable_value'] + cdnr['taxable_value'] + nil['taxable_value']
    )

    return {
        'fy': f'{fy_start_year}-{str(fy_start_year + 1)[-2:]}',
        'location_id': location_id,
        'aggregate_turnover': str(total_turnover),
        'must_file_gstr_9c': total_turnover > Decimal('50000000'),  # ₹5 Cr threshold
        'table_4_outward_taxable': {
            'b2b': {k: str(v) for k, v in b2b.items()},
            'b2c_large': {k: str(v) for k, v in b2c_large.items()},
            'b2c_small': {k: str(v) for k, v in b2c_small.items()},
            'credit_debit_notes': {k: str(v) for k, v in cdnr.items()},
        },
        'table_5_outward_nil': {k: str(v) for k, v in nil.items()},
        'table_6_itc_from_2b': {k: str(v) for k, v in itc_from_2b.items()},
        'table_9_tax_paid': {k: str(v) for k, v in tax_paid.items()},
        'periods_included': periods,
        'gstr3b_filings': g3b.count(),
        'reconciliation_pending': g3b.filter(status='draft').count(),
    }


def gstr_late_fee_and_interest(*, due_date: date, payment_date: date,
                               tax_amount: Decimal,
                               return_type: str = 'gstr3b') -> dict:
    """
    Compute GST late fee and interest.

    Late fee per CGST §47:
      - GSTR-1 / GSTR-3B: ₹50/day (₹25 CGST + ₹25 SGST), max ₹5,000.
        ₹20/day for NIL returns, max ₹500.
      - GSTR-9: ₹200/day (₹100 + ₹100), max 0.25% of turnover.

    Interest per CGST §50: 18% per annum simple interest from the day after
    the due date until the date of payment, on the *tax* (not late fee).
    """
    if payment_date <= due_date:
        return {'days_late': 0, 'late_fee': '0.00', 'interest': '0.00',
                'total': '0.00'}

    days_late = (payment_date - due_date).days

    if return_type == 'gstr9':
        per_day = Decimal('200')
        cap = None  # 0.25% of turnover — caller must cap externally
    else:  # gstr1 / gstr3b
        per_day = Decimal('50') if tax_amount > 0 else Decimal('20')
        cap = Decimal('5000') if tax_amount > 0 else Decimal('500')

    late_fee = per_day * Decimal(days_late)
    if cap is not None:
        late_fee = min(late_fee, cap)

    interest = (
        tax_amount * Decimal('18') / Decimal('100') *
        Decimal(days_late) / Decimal('365')
    ).quantize(Decimal('0.01'))

    return {
        'days_late': days_late,
        'late_fee': str(late_fee.quantize(Decimal('0.01'))),
        'interest': str(interest),
        'total': str((late_fee + interest).quantize(Decimal('0.01'))),
        'rule_applied': 'CGST §47 (late fee) + §50 (18% interest)',
    }

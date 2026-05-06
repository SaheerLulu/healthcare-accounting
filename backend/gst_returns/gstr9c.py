"""
GSTR-9C — Reconciliation Statement & Certification.

Required for every taxpayer whose aggregate turnover exceeds ₹5 Cr in the
financial year. Reconciles:

  Part-A:
    Table 5  — Turnover declared in audited financial statements (FS) vs
               turnover declared in GSTR-9
    Table 7  — Taxable turnover reconciliation
    Table 9  — Tax paid reconciliation
    Table 12 — Reconciliation of Net ITC
    Table 14 — Reconciliation of ITC declared in 9 vs availed as per books
    Table 16 — Additional liability due to non-reconciliation

This module produces the data structure for those tables. Tables that
require manual auditor input (Part-A Tables 6, 8, 13; Part-B certificate)
are emitted as empty templates.
"""
from decimal import Decimal

from django.db.models import Sum

from .annual_return import generate_gstr9
from .models import GSTR1Entry, GSTR2BEntry, GSTR3BSummary


def _zero():
    return Decimal('0.00')


def generate_gstr9c(*, fy_start_year: int, location_id: int,
                    audited_turnover: Decimal = None,
                    audited_taxable_turnover: Decimal = None,
                    audited_total_tax_paid: Decimal = None,
                    audited_itc_availed: Decimal = None) -> dict:
    """
    Build the GSTR-9C payload for the given FY + location.

    The four optional `audited_*` arguments come from the audited financial
    statements — caller passes them in. We compute the books-side turnover/
    tax/ITC from posted JEs + GSTR-9 aggregates, then surface variances.

    GSTR-9C is NOT applicable when the GSTR-9 turnover < ₹5 Cr — caller
    should check `gstr9['must_file_gstr_9c']` first.
    """
    gstr9 = generate_gstr9(fy_start_year=fy_start_year, location_id=location_id)
    fy_label = gstr9['fy']

    g9_turnover = Decimal(gstr9['aggregate_turnover'])
    must_file = gstr9['must_file_gstr_9c']

    audited_turnover = (Decimal(str(audited_turnover))
                        if audited_turnover is not None else g9_turnover)
    audited_taxable = (Decimal(str(audited_taxable_turnover))
                       if audited_taxable_turnover is not None
                       else g9_turnover)
    audited_tax = (Decimal(str(audited_total_tax_paid))
                   if audited_total_tax_paid is not None else _zero())
    audited_itc = (Decimal(str(audited_itc_availed))
                   if audited_itc_availed is not None else _zero())

    # Books-side aggregates from existing GSTR data
    table_4 = gstr9['table_4_outward_taxable']
    books_taxable = (
        Decimal(table_4['b2b']['taxable_value']) +
        Decimal(table_4['b2c_large']['taxable_value']) +
        Decimal(table_4['b2c_small']['taxable_value'])
    )
    books_total_tax = sum(
        (Decimal(table_4[g][k])
         for g in ('b2b', 'b2c_large', 'b2c_small')
         for k in ('cgst', 'sgst', 'igst', 'cess')),
        _zero(),
    )
    books_itc = (
        Decimal(gstr9['table_6_itc_from_2b']['cgst']) +
        Decimal(gstr9['table_6_itc_from_2b']['sgst']) +
        Decimal(gstr9['table_6_itc_from_2b']['igst'])
    )

    # Variances
    turnover_variance = audited_turnover - g9_turnover
    taxable_variance = audited_taxable - books_taxable
    tax_variance = audited_tax - books_total_tax
    itc_variance = audited_itc - books_itc

    return {
        'fy': fy_label,
        'location_id': location_id,
        'applicable': must_file,
        'note': (
            'GSTR-9C is mandatory when aggregate turnover exceeds ₹5 Cr.'
            if must_file else
            'GSTR-9C is NOT applicable for this entity (turnover ≤ ₹5 Cr).'
        ),

        # Table 5 — Turnover reconciliation (Part-A)
        'table_5_turnover_recon': {
            'gstr9_turnover': str(g9_turnover),
            'audited_fs_turnover': str(audited_turnover),
            'unreconciled': str(turnover_variance),
            'reasons_template': [
                'Unbilled revenue at year-end',
                'Foreign exchange fluctuation',
                'Deemed supplies (Sch I)',
                'Credit notes issued after FY-end',
                'Stock transfers between branches with different GSTIN',
                'Other (specify)',
            ],
        },

        # Table 7 — Taxable turnover reconciliation
        'table_7_taxable_recon': {
            'gstr9_taxable_turnover': str(books_taxable),
            'audited_fs_taxable_turnover': str(audited_taxable),
            'unreconciled': str(taxable_variance),
        },

        # Table 9 — Tax paid reconciliation
        'table_9_tax_paid_recon': {
            'gstr9_total_tax': str(books_total_tax),
            'audited_total_tax': str(audited_tax),
            'unreconciled': str(tax_variance),
            'tax_payable_on_unreconciled': (
                str(taxable_variance * Decimal('0.18'))   # default 18%
                if taxable_variance > 0 else '0.00'
            ),
        },

        # Table 12 — Net ITC reconciliation
        'table_12_itc_recon': {
            'itc_availed_per_books': str(audited_itc),
            'itc_claimed_in_gstr9': str(books_itc),
            'unreconciled': str(itc_variance),
        },

        # Table 16 — Additional liability
        'table_16_additional_liability': {
            'tax_payable': str(max(tax_variance, _zero())),
            'interest_payable_18pct': str(
                max(tax_variance, _zero()) * Decimal('0.18')
            ),
        },

        # Templates for auditor-entered sections
        'auditor_input_required': {
            'table_6_unreconciled_turnover_reasons': [],
            'table_8_unreconciled_taxable_reasons': [],
            'table_13_unreconciled_itc_reasons': [],
            'part_b_certificate': {
                'auditor_name': '', 'auditor_membership_no': '',
                'firm_name': '', 'firm_registration_no': '',
                'place': '', 'date': '',
                'opinion': '',  # Unmodified / Qualified / Adverse / Disclaimer
            },
        },

        'gstr9_summary': gstr9,
    }

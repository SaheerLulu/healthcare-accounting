"""
GST utility functions for supply type detection and tax computation.
Replicates the parent inventory app's gst_engine logic.
"""
from decimal import Decimal, ROUND_HALF_UP


def detect_supply_type(
    business_gstin: str,
    counterparty_gstin: str,
    business_state_code: str = '',
) -> str:
    """
    Detect supply type based on state codes (first 2 chars of GSTIN).
    Returns 'intra_state' or 'inter_state'.

    Resolution order for the company side:
      1. business_gstin[:2] if a 15-char GSTIN is provided
      2. business_state_code (2-digit anchor from AccountingSettings)
    If either side cannot be resolved to 2 digits, defaults to intra_state.
    """
    business_state = ''
    if business_gstin and len(business_gstin) >= 2:
        business_state = business_gstin[:2]
    elif business_state_code and len(business_state_code) >= 2:
        business_state = business_state_code[:2]

    counterparty_state = ''
    if counterparty_gstin and len(counterparty_gstin) >= 2:
        counterparty_state = counterparty_gstin[:2]

    if not business_state or not counterparty_state:
        return 'intra_state'

    return 'intra_state' if business_state == counterparty_state else 'inter_state'


def detect_supply_type_by_state(business_state_code: str, counterparty_state_code: str) -> str:
    """Detect supply type from state codes directly (2-digit)."""
    if not business_state_code or not counterparty_state_code:
        return 'intra_state'
    return 'intra_state' if business_state_code == counterparty_state_code else 'inter_state'


def compute_tax_split(
    taxable_amount: Decimal,
    gst_rate: Decimal,
    supply_type: str,
) -> dict:
    """
    Compute CGST/SGST/IGST split based on supply type.

    For intra-state: split equally into CGST + SGST
    For inter-state: full amount as IGST

    Returns dict with cgst, sgst, igst amounts.
    """
    if gst_rate <= 0 or taxable_amount <= 0:
        return {
            'cgst': Decimal('0.00'),
            'sgst': Decimal('0.00'),
            'igst': Decimal('0.00'),
        }

    total_tax = (taxable_amount * gst_rate / Decimal('100')).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP
    )

    if supply_type == 'inter_state':
        return {
            'cgst': Decimal('0.00'),
            'sgst': Decimal('0.00'),
            'igst': total_tax,
        }
    else:
        half_tax = (total_tax / 2).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return {
            'cgst': half_tax,
            'sgst': total_tax - half_tax,  # avoid rounding mismatch
            'igst': Decimal('0.00'),
        }


def back_calculate_taxable(inclusive_amount: Decimal, gst_rate: Decimal) -> Decimal:
    """
    Back-calculate taxable base from a tax-inclusive amount (e.g., POS MRP-based sales).
    taxable = inclusive_amount * 100 / (100 + gst_rate)
    """
    if gst_rate <= 0:
        return inclusive_amount
    return (inclusive_amount * Decimal('100') / (Decimal('100') + gst_rate)).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP
    )

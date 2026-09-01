"""
GST utility functions for supply type detection and tax computation.
Replicates the parent inventory app's gst_engine logic.
"""
from decimal import Decimal, ROUND_HALF_UP


def detect_supply_type(
    business_gstin: str,
    counterparty_gstin: str,
    business_state_code: str = '',
    counterparty_state_code: str = '',
) -> str:
    """
    Detect supply type based on state codes (first 2 chars of GSTIN).
    Returns 'intra_state' or 'inter_state'.

    Resolution order for the company side:
      1. the state code the business GSTIN starts with, when it starts with a
         REAL one (see gst_state_code)
      2. business_state_code (2-digit anchor from AccountingSettings)
    Resolution order for the counterparty side:
      1. the state code the counterparty GSTIN starts with, same rule
      2. counterparty_state_code (2-digit POS code derived from the customer's
         state name, store/branch state, or shipping address)
    A value that is not a real state code carries no place-of-supply
    information, so it falls through to the next source rather than being
    treated as some unknown state. If neither side resolves, defaults to
    intra_state — callers should pass `counterparty_state_code` so that default
    only fires for true OTC walk-in sales where no place of supply is captured.
    """
    # gst_state_code (defined below, next to the state list it validates
    # against) rather than a bare [:2]: `gst_no` is free text in the inventory
    # master and is routinely a placeholder — 'UNREG', 'NA', 'URP', '-'.
    # Slicing those gave 'UN'/'NA'/'UR', which matches no real state, so an
    # intra-state purchase from an unregistered supplier was classified
    # inter-state and its whole GST posted to Input IGST.
    business_state = (gst_state_code(business_gstin)
                      or gst_state_code(business_state_code))
    counterparty_state = (gst_state_code(counterparty_gstin)
                          or gst_state_code(counterparty_state_code))

    if not business_state or not counterparty_state:
        return 'intra_state'

    return 'intra_state' if business_state == counterparty_state else 'inter_state'


# State name → 2-digit GST state code per the official GST list. Used as a
# place-of-supply fallback when a customer's GSTIN is unknown but their state
# is captured (CustomerRO.state, SupplierRO.state — both free-text).
STATE_NAME_TO_CODE = {
    'jammu and kashmir': '01', 'j&k': '01', 'jammu & kashmir': '01',
    'himachal pradesh': '02',
    'punjab': '03',
    'chandigarh': '04',
    'uttarakhand': '05', 'uttaranchal': '05',
    'haryana': '06',
    'delhi': '07', 'new delhi': '07', 'nct of delhi': '07',
    'rajasthan': '08',
    'uttar pradesh': '09',
    'bihar': '10',
    'sikkim': '11',
    'arunachal pradesh': '12',
    'nagaland': '13',
    'manipur': '14',
    'mizoram': '15',
    'tripura': '16',
    'meghalaya': '17',
    'assam': '18',
    'west bengal': '19',
    'jharkhand': '20',
    'odisha': '21', 'orissa': '21',
    'chhattisgarh': '22', 'chattisgarh': '22',
    'madhya pradesh': '23',
    'gujarat': '24',
    'daman and diu': '25', 'daman & diu': '25',
    'dadra and nagar haveli': '26', 'dadra & nagar haveli': '26',
    'dadra and nagar haveli and daman and diu': '26',
    'maharashtra': '27',
    'andhra pradesh (old)': '28',
    'karnataka': '29',
    'goa': '30',
    'lakshadweep': '31',
    'kerala': '32',
    'tamil nadu': '33', 'tamilnadu': '33',
    'puducherry': '34', 'pondicherry': '34',
    'andaman and nicobar islands': '35', 'andaman & nicobar': '35',
    'andaman and nicobar': '35',
    'telangana': '36',
    'andhra pradesh': '37',
    'ladakh': '38',
    'other territory': '97',
    'centre jurisdiction': '99',
}


# Every 2-digit code the official GST state list actually uses (01-38 plus 97
# Other Territory and 99 Centre Jurisdiction).
VALID_STATE_CODES = frozenset(STATE_NAME_TO_CODE.values())


def gst_state_code(value: str) -> str:
    """The 2-digit GST state code `value` starts with, or '' if it starts with
    none.

    Takes either a GSTIN (whose first two characters ARE its state code) or a
    bare state code. The point is the validation: `gst_no` on the inventory
    supplier/customer master is a free-text CharField that in practice holds
    placeholders as often as GSTINs — 'UNREG', 'NA', 'N/A', 'URP', '-'. A bare
    [:2] turned those into 'UN'/'NA'/'UR'/'-', none of which equals the filer's
    real code, so every such party looked like it sat in another state and its
    tax went to IGST. Nothing but a real code is place-of-supply information.
    """
    code = (value or '').strip()[:2]
    return code if code in VALID_STATE_CODES else ''


def state_name_to_code(name: str) -> str:
    """Resolve a free-text state name to its 2-digit GST code, or '' if unknown.
    Case- and whitespace-insensitive; tolerates trailing dots and the common
    state-name aliases used on tax invoices."""
    if not name:
        return ''
    key = name.strip().lower().rstrip('.')
    return STATE_NAME_TO_CODE.get(key, '')


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

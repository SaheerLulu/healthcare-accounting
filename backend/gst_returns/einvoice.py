"""
E-Invoice (IRN) generation per the official IRP (Invoice Registration Portal) spec.

IRN = SHA-256 hash of: {supplier_GSTIN}{financial_year}{document_type}{document_number}
       (concatenated, uppercased — per the IRP technical spec).

The QR code embeds: supplier GSTIN, recipient GSTIN, doc no, doc date,
total invoice value, total IGST, HSN of main item, IRN, IRN-generation date.

This module produces both deterministically. Hitting the actual IRP API
(einvapi.gst.gov.in) is out of scope here — those endpoints are gated behind
sandbox credentials per GSTIN. The local IRN match the spec, so it is valid
for *internal* reconciliation; for compliance you still need to upload to IRP.

E-invoicing is mandatory for businesses with aggregate turnover above ₹5 Cr
(threshold lowered progressively since 2020). This applies to every B2B
invoice, credit note, and debit note.
"""
import hashlib
import json
from datetime import date, datetime
from decimal import Decimal


DOC_TYPE_MAP = {
    'B2B': 'INV',
    'B2C_LARGE': 'INV',
    'B2C_SMALL': 'INV',
    'CREDIT_NOTE': 'CRN',
    'DEBIT_NOTE': 'DBN',
    'CDNR': 'CRN',
    'CDNUR': 'CRN',
}


def fy_from_date(d) -> str:
    """e.g. 2026-04-15 → '2026-27' (FY label as IRP expects)."""
    if isinstance(d, str):
        d = date.fromisoformat(d)
    if d.month >= 4:
        return f'{d.year}-{str(d.year + 1)[-2:]}'
    return f'{d.year - 1}-{str(d.year)[-2:]}'


def compute_irn(*, supplier_gstin: str, doc_no: str, doc_date,
                doc_type: str = 'INV') -> str:
    """64-char hex IRN per IRP spec."""
    fy = fy_from_date(doc_date)
    raw = f'{supplier_gstin.upper()}{fy}{doc_type.upper()}{doc_no}'
    return hashlib.sha256(raw.encode()).hexdigest()


def build_qr_payload(*, irn: str, supplier_gstin: str, recipient_gstin: str,
                     doc_no: str, doc_date, total_value: Decimal,
                     total_igst: Decimal, main_hsn: str = '') -> str:
    """JSON payload that the IRP returns and that gets encoded into the QR.

    In production, this would be a JWT signed by the IRP. For internal use
    we emit the unsigned JSON; an offline verifier should accept either.
    """
    if isinstance(doc_date, (date, datetime)):
        doc_date = doc_date.strftime('%d/%m/%Y')

    payload = {
        'data': {
            'SellerGstin': supplier_gstin.upper(),
            'BuyerGstin': (recipient_gstin or 'URP').upper(),
            'DocNo': doc_no,
            'DocDt': doc_date,
            'TotInvVal': float(total_value),
            'ItemCnt': 1,
            'MainHsnCode': main_hsn or '',
            'Irn': irn,
            'IrnDt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'TotIgstVal': float(total_igst),
        },
    }
    return json.dumps(payload, separators=(',', ':'))


def generate_irn_for_entry(entry):
    """Compute + persist IRN/QR/ack on a GSTR1Entry. Idempotent: if IRN already
    populated, returns the existing record unchanged."""
    from core.models import LocationTaxProfile

    if entry.irn:
        return entry

    if entry.invoice_type not in DOC_TYPE_MAP:
        # NIL/exempt entries don't need IRN
        return entry

    # The IRN hash embeds the supplier GSTIN, so it must be THIS store's own
    # registration, not a single company-wide one.
    supplier_gstin = LocationTaxProfile.resolve(entry.location_id).gstin
    if not supplier_gstin:
        raise ValueError(
            'Cannot generate IRN: no GSTIN configured for this store. '
            'Set the store GSTIN in the pharmacy store settings, or add an '
            'accounting override in Settings → GST Registrations.'
        )

    doc_type = DOC_TYPE_MAP[entry.invoice_type]
    irn = compute_irn(
        supplier_gstin=supplier_gstin,
        doc_no=entry.invoice_no,
        doc_date=entry.invoice_date,
        doc_type=doc_type,
    )

    entry.irn = irn
    entry.irn_date = date.today()
    # Mock ack — real IRP returns a numeric acknowledgement
    entry.ack_no = f'ACK{irn[:10]}'
    entry.ack_date = date.today()
    entry.e_invoice_status = 'generated'
    entry.save(update_fields=['irn', 'irn_date', 'ack_no', 'ack_date',
                              'e_invoice_status'])

    return entry

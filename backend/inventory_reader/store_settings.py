"""Read pharmacy per-store registration settings (GSTIN etc.).

The pharmacy/dashboard app owns each store's GSTIN in `dashboard_systemsettings`
(one row per location). Accounting treats it as the live source of truth for the
per-store GST filer identity.

These helpers are the single read point and are deliberately defensive: if the
(unmanaged, cross-app) table is unavailable — e.g. the SQLite test DB, or a
transient DB error — they return "no data" instead of raising, so GST resolution
degrades to a blank/unconfigured GSTIN rather than breaking posting or returns.
"""
from inventory_reader.models import SystemSettingsRO

_FIELDS = (
    'location_id', 'gst_number', 'store_name', 'store_address',
    'store_phone', 'store_email',
)


def get_store_gst(location_id):
    """Return the pharmacy settings row (dict) for one store, or None when the
    store has no row, no GSTIN, or the table is unavailable."""
    if not location_id:
        return None
    try:
        row = (SystemSettingsRO.objects
               .filter(location_id=location_id)
               .values(*_FIELDS).first())
    except Exception:
        return None
    if not row or not (row.get('gst_number') or '').strip():
        return None
    return row


def get_store_gst_bulk(location_ids):
    """Return {location_id: row-dict} for the given stores that have a GSTIN.

    Stores without a GSTIN — or an unavailable table — are simply absent from
    the map (never raises), so callers treat a missing key as "unconfigured"."""
    ids = [i for i in (location_ids or []) if i]
    if not ids:
        return {}
    try:
        rows = list(SystemSettingsRO.objects
                    .filter(location_id__in=ids)
                    .values(*_FIELDS))
    except Exception:
        return {}
    return {
        r['location_id']: r
        for r in rows
        if (r.get('gst_number') or '').strip()
    }

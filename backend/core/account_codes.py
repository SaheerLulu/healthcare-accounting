"""Automatic account-code allocation for new Chart-of-Accounts rows.

This chart is numbered Tally-style: one numeric band per account type, with
groups and their leaves sharing a neighbourhood. Making the user invent a code
that fits meant either a clash or a number filed nowhere near its family, so a
new account is numbered here instead — next to the family it joins.

Codes are checked free against EVERY location, not just the caller's store.
The DB only enforces uniqueness per (account_code, location_id), so two stores
COULD each hold a different "1124"; allocating globally keeps a code meaning
one thing company-wide, which is what `resolve_ledger_account` and every
exported report assume when they print a bare code.
"""
from itertools import chain

from .models import ChartOfAccount


# Inclusive numeric band per account type.
#
# REVENUE stops at 4999 even though the seed files contra-revenue (5200 Sales
# Returns, 5210) in the 5000s — that placement is legacy, and a NEW revenue
# account belongs in the 4000s with the rest. EXPENSE runs to 6999 because the
# seed already reaches 6200.
CODE_BANDS = {
    'ASSET':     (1000, 1999),
    'LIABILITY': (2000, 2999),
    'EQUITY':    (3000, 3999),
    'REVENUE':   (4000, 4999),
    'EXPENSE':   (5000, 6999),
}


def _as_int(code):
    """The integer a code represents, or None when it is not a bare number.

    Per-store clones ('1110-MUM') and per-party ledgers ('2105-S5-L1') are
    deliberately excluded: each is derived from a numeric code that already
    exists in its own right, so counting the suffixed form again would burn a
    number nothing occupies.
    """
    code = (code or '').strip()
    return int(code) if code.isdigit() else None


def next_account_code(account_type, parent=None):
    """The code a new `account_type` account under `parent` should be given.

    Anchored on the family the account joins:

      * with a parent — after the parent's own number AND after its highest
        existing child. Both halves matter: the seed hangs 54xx leaves off
        5700 Indirect Expenses, so anchoring on the children alone would
        number a new child below its group, and anchoring on the parent alone
        would collide with a group whose children run above it.
      * without a parent — after the highest code already in the band, so a
        new top-level group lands at the end rather than in the middle.

    Then walks forward to the first free number, wrapping to the bottom of the
    band to reuse a gap before declaring the band full.
    """
    band = CODE_BANDS.get(account_type)
    if band is None:
        raise ValueError(f'No account-code range is defined for {account_type!r}.')
    lo, hi = band

    taken = {n for n in (
        _as_int(c) for c in
        ChartOfAccount.objects.values_list('account_code', flat=True)
    ) if n is not None}

    parent_code = _as_int(getattr(parent, 'account_code', None))
    if parent_code is not None and lo <= parent_code <= hi:
        siblings = [n for n in (
            _as_int(c) for c in ChartOfAccount.objects
            .filter(parent=parent).values_list('account_code', flat=True)
        ) if n is not None and lo <= n <= hi]
        anchor = max([parent_code] + siblings)
    else:
        in_band = [n for n in taken if lo <= n <= hi]
        anchor = max(in_band) if in_band else lo - 1

    start = max(anchor + 1, lo)
    for candidate in chain(range(start, hi + 1), range(lo, start)):
        if candidate not in taken:
            return str(candidate)

    raise ValueError(
        f'Every code from {lo} to {hi} is in use, so a new {account_type} '
        f'account cannot be numbered automatically. Enter a code manually.'
    )

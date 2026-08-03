"""Shared sort keys, so lists of the same thing order the same way everywhere."""


def ci_key(*parts):
    """A case-insensitive sort key with a stable tail.

    Python's default string comparison is by codepoint, so every ASCII capital
    (A-Z, 0x41-0x5A) sorts before every lowercase letter (a-z, 0x61-0x7A) and
    "Zinc" lands before "amoxicillin". casefold() rather than lower() so
    non-ASCII names fold correctly too.

    Non-string parts pass through untouched, which is what keeps a numeric
    tiebreak numeric: ci_key('a', 2) < ci_key('a', 10).

    Pass the display name first, then whatever makes the order deterministic
    for equal names — a code, then an id:

        rows.sort(key=lambda r: ci_key(r['name'], r['code'], r['id']))
    """
    return tuple(p.casefold() if isinstance(p, str) else p for p in parts)

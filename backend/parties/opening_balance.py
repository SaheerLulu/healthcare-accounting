"""Post a party's opening balance to the general ledger.

A PartyOpeningBalance is the carry-forward figure for a supplier/customer when
the business starts using this system. We post a balanced JE against
3300 Opening Balance Equity so the opening figure appears in the trial balance
and on the party's own ledger card:

    Customer (debtor), amount > 0:  Dr <customer ledger>  / Cr 3300
    Supplier (creditor), amount > 0: Dr 3300              / Cr <supplier ledger>

Sign convention matches the rest of the parties feature: positive amount =
customer owes us / we owe the supplier. A negative amount flips both legs.

IMPORTANT — no double counting: the parties services layer keeps adding the
stored `amount` arithmetically to outstanding/statements, so it EXCLUDES this JE
(reference_type='PartyOpeningBalance') from its tag-based aggregation. The
GL ledger balance (which includes this JE) and the tag-based outstanding
(stored amount + non-OB tagged lines) therefore reconcile to the same number.

Idempotent: re-posting voids the prior JE first. Posted JEs are immutable, so
an existing posted OB entry is reversed (reversal_of) rather than edited.
"""
from decimal import Decimal

from django.db import transaction

OPENING_BALANCE_REFERENCE = 'PartyOpeningBalance'


def _today():
    from django.utils import timezone
    return timezone.localdate()


@transaction.atomic
def void_opening_balance_je(ob, *, user=None):
    """Reverse (if posted) or delete (if draft) the OB's linked JE. No-op if none."""
    from journals.models import JournalEntry, JournalEntryLine

    old = ob.journal_entry
    if old is None:
        return
    if old.is_posted:
        if not hasattr(old, 'reversal_entry'):
            reversal = JournalEntry.objects.create(
                date=old.date,
                narration=f'Reversal of opening balance {old.entry_no}',
                voucher_type='JOURNAL',
                reference_type=OPENING_BALANCE_REFERENCE,
                reference_id=ob.party_id,
                location_id=old.location_id,
                reversal_of=old,
                created_by=user,
            )
            for line in old.lines.all():
                JournalEntryLine.objects.create(
                    entry=reversal, account=line.account,
                    debit=line.credit, credit=line.debit,
                    narration=line.narration,
                    party_type=line.party_type, party_id=line.party_id,
                )
            reversal.post()
    else:
        old.delete()
    ob.journal_entry = None
    ob.save(update_fields=['journal_entry'])


@transaction.atomic
def post_opening_balance_je(ob, *, user=None):
    """(Re)post the GL entry for this PartyOpeningBalance. Idempotent.

    Returns the new JournalEntry (or None when amount is zero)."""
    from core.models import AccountMapping
    from core.party_ledgers import get_or_create_party_ledger
    from journals.models import JournalEntry, JournalEntryLine

    void_opening_balance_je(ob, user=user)

    amount = ob.amount or Decimal('0.00')
    if amount == 0:
        return None

    if ob.location_id is None:
        raise ValueError('Opening balance must have a location (store isolation).')

    ledger = get_or_create_party_ledger(ob.party_type, ob.party_id, location_id=ob.location_id)
    obe = AccountMapping.get_account('OPENING_BALANCE_EQUITY', location_id=ob.location_id)

    entry = JournalEntry.objects.create(
        date=ob.as_of_date,
        narration=ob.narration or f'Opening balance — {ob.party_type} #{ob.party_id}',
        voucher_type='JOURNAL',
        reference_type=OPENING_BALANCE_REFERENCE,
        reference_id=ob.party_id,
        location_id=ob.location_id,
        created_by=user,
    )

    party_tag = dict(party_type=ob.party_type, party_id=ob.party_id)
    # A positive customer (debtor) balance debits the ledger / credits OBE; a
    # positive supplier (creditor) balance is the reverse. A negative amount
    # flips the side — hence the XNOR of "is debtor" and "is positive".
    abs_amt = abs(amount)
    ledger_debits = (ob.party_type == 'Customer') == (amount > 0)
    JournalEntryLine.objects.create(
        entry=entry, account=ledger, **party_tag,
        **({'debit': abs_amt} if ledger_debits else {'credit': abs_amt}))
    JournalEntryLine.objects.create(
        entry=entry, account=obe,
        **({'credit': abs_amt} if ledger_debits else {'debit': abs_amt}))

    entry.post()
    ob.journal_entry = entry
    ob.save(update_fields=['journal_entry'])
    return entry

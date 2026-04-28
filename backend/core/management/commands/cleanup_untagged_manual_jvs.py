"""One-off cleanup for the 10 untagged manual JVs that pre-date the location/party
requirement, plus the sibling Bill / BillLine / RecurringBill / RecurringBillItem
records they were generated from.

Plan reference: §S1.3.

Steps:
  1. Reverse + delete the 10 manual untagged JVs. After this, every Bill /
     BillPayment that referenced them has journal_entry_id=NULL (SET_NULL).
  2. Re-tag the legitimate Bills (KSEB + 3 rent) and the recurring rent template
     in place: change account on lines/items from 1232 to 5420 / 5410, set
     location_id=1, replace placeholder vendor names.
  3. Re-post the 5 legitimate JVs (KSEB bill, KSEB payment, 3 rent bills) with
     location_id=1 and party_id from inventory_reader (when present).
  4. Re-link Bills + BillPayment to the new JVs.
  5. Drop account 1232 ('Current'), the misclassified expense dump.

Idempotent: bails early if no __TEST_VENDOR__ narration is found.
"""
from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from audit.utils import log_action
from bills.models import Bill, BillLine, BillPayment, RecurringBill, RecurringBillItem
from core.models import ChartOfAccount
from inventory_reader.models import SupplierRO
from journals.models import JournalEntry, JournalEntryLine


def _make_reversal(original):
    """Replicate JournalEntryViewSet.reverse_entry without an HTTP request."""
    reversal = JournalEntry.objects.create(
        date=original.date,
        narration=f"Reversal of {original.entry_no}: {original.narration}".strip(': '),
        voucher_type=original.voucher_type,
        reference_type=original.reference_type,
        reference_id=original.reference_id,
        location_id=original.location_id,
    )
    for line in original.lines.all():
        JournalEntryLine.objects.create(
            entry=reversal,
            account=line.account,
            debit=line.credit,
            credit=line.debit,
            narration=line.narration,
            party_type=line.party_type,
            party_id=line.party_id,
        )
    reversal.post()
    return reversal


def _resolve_supplier_id(name_keywords, stdout=None):
    """Return supplier id matching any of the keywords (case-insensitive substring)
    in inventory_reader.SupplierRO. Returns None and warns if no match found."""
    for kw in name_keywords:
        match = SupplierRO.objects.filter(company_name__icontains=kw).first()
        if match:
            return match.id
    if stdout:
        stdout.write(
            f"  [warn] no supplier matched {name_keywords} — line will be posted "
            f"with party_type='None'. Create the supplier in inventory and "
            f"update the JVs/Bills manually."
        )
    return None


def _create_jv(date_, narration, voucher_type, location_id, lines):
    """Create + post a JournalEntry with the given lines via ORM (bypasses serializer
    enforcement; this command runs once during data fixup)."""
    entry = JournalEntry.objects.create(
        date=date_,
        narration=narration,
        voucher_type=voucher_type,
        reference_type='Manual',
        location_id=location_id,
    )
    for line in lines:
        JournalEntryLine.objects.create(
            entry=entry,
            account=line['account'],
            debit=line.get('debit', Decimal('0.00')),
            credit=line.get('credit', Decimal('0.00')),
            narration=line.get('narration', ''),
            party_type=line.get('party_type', 'None'),
            party_id=line.get('party_id'),
        )
    entry.post()
    return entry


class Command(BaseCommand):
    help = (
        "Reverse + delete the 10 untagged manual JVs, re-tag the sibling "
        "Bills / RecurringBill that referenced 1232, re-post legitimate "
        "entries (KSEB + rent) with proper accounts/location/party, and drop "
        "account 1232."
    )

    DEFAULT_LOCATION_ID = 1

    def handle(self, *args, **options):
        # Idempotency guard.
        if not JournalEntry.objects.filter(narration__icontains='__TEST_VENDOR__').exists():
            self.stdout.write(self.style.WARNING(
                "No __TEST_VENDOR__ entries found — cleanup already ran. Exiting."
            ))
            return

        with transaction.atomic():
            self._reverse_and_delete_manual_jvs()
            kseb_supplier_id = _resolve_supplier_id(['KSEB', 'electric'], self.stdout)
            landlord_supplier_id = _resolve_supplier_id(
                ['Landlord', 'Property', 'Rent'], self.stdout,
            )
            self._retag_bills_and_recurring(kseb_supplier_id, landlord_supplier_id)
            self._repost_jvs_and_relink(kseb_supplier_id, landlord_supplier_id)
            self._drop_1232()

        self.stdout.write(self.style.SUCCESS('Cleanup complete.'))

    # ── Step 1: reverse + delete the 10 untagged manual JVs ─────────────────
    def _reverse_and_delete_manual_jvs(self):
        targets = list(JournalEntry.objects.filter(
            reference_type='Manual',
            location_id__isnull=True,
        ).order_by('id'))

        self.stdout.write(f"Reversing + deleting {len(targets)} untagged manual JVs…")
        for entry in targets:
            entry_no = entry.entry_no
            reversal = _make_reversal(entry)
            JournalEntry.objects.filter(pk__in=[entry.pk, reversal.pk]).delete()
            self.stdout.write(f"  • removed {entry_no}")

    # ── Step 2: re-tag sibling Bills + RecurringBill in place ───────────────
    def _retag_bills_and_recurring(self, kseb_supplier_id, landlord_supplier_id):
        electricity = ChartOfAccount.objects.get(account_code='5420')
        rent = ChartOfAccount.objects.get(account_code='5410')

        # KSEB bill (bill #2 — vendor_name='kseb').
        kseb_bills = Bill.objects.filter(lines__account__account_code='1232',
                                         vendor_name__iexact='kseb').distinct()
        for bill in kseb_bills:
            bill.vendor_name = 'KSEB Electricity Board'
            bill.vendor_id = kseb_supplier_id
            bill.location_id = self.DEFAULT_LOCATION_ID
            bill.save(update_fields=['vendor_name', 'vendor_id', 'location_id'])
            BillLine.objects.filter(
                bill=bill, account__account_code='1232',
            ).update(account=electricity)
            self.stdout.write(f"  · re-tagged Bill#{bill.id} (KSEB)")

        # Rent bills (vendor_name='__RENT_VENDOR__').
        rent_bills = Bill.objects.filter(vendor_name='__RENT_VENDOR__')
        for bill in rent_bills:
            bill.vendor_name = 'Landlord'
            bill.vendor_id = landlord_supplier_id
            bill.location_id = self.DEFAULT_LOCATION_ID
            bill.save(update_fields=['vendor_name', 'vendor_id', 'location_id'])
            BillLine.objects.filter(
                bill=bill, account__account_code='1232',
            ).update(account=rent)
            self.stdout.write(f"  · re-tagged Bill#{bill.id} ({bill.bill_no})")

        # Recurring rent template (profile_name='__RB_TEST__').
        rb_qs = RecurringBill.objects.filter(profile_name='__RB_TEST__')
        for rb in rb_qs:
            rb.profile_name = 'Office Rent'
            rb.vendor_name = 'Landlord'
            rb.vendor_id = landlord_supplier_id
            rb.location_id = self.DEFAULT_LOCATION_ID
            rb.save(update_fields=['profile_name', 'vendor_name', 'vendor_id', 'location_id'])
            RecurringBillItem.objects.filter(
                recurring_bill=rb, account__account_code='1232',
            ).update(account=rent)
            self.stdout.write(f"  · re-tagged RecurringBill#{rb.id} (Office Rent)")

    # ── Step 3 + 4: re-post JVs and re-link bills ───────────────────────────
    def _repost_jvs_and_relink(self, kseb_supplier_id, landlord_supplier_id):
        bank = ChartOfAccount.objects.get(account_code='1120')
        trade_pay = ChartOfAccount.objects.get(account_code='2110')
        electricity = ChartOfAccount.objects.get(account_code='5420')
        rent_acct = ChartOfAccount.objects.get(account_code='5410')

        kseb_party = (
            {'party_type': 'Supplier', 'party_id': kseb_supplier_id}
            if kseb_supplier_id else {'party_type': 'None', 'party_id': None}
        )
        landlord_party = (
            {'party_type': 'Supplier', 'party_id': landlord_supplier_id}
            if landlord_supplier_id else {'party_type': 'None', 'party_id': None}
        )

        # KSEB bill — Bill #2.
        kseb_bill = Bill.objects.filter(vendor_name='KSEB Electricity Board').first()
        if kseb_bill:
            kseb_bill_jv = _create_jv(
                date_=kseb_bill.bill_date,
                narration=f'Bill #{kseb_bill.id} — KSEB electricity',
                voucher_type='PURCHASE',
                location_id=self.DEFAULT_LOCATION_ID,
                lines=[
                    {'account': electricity, 'debit': Decimal('10000.00'), **kseb_party},
                    {'account': trade_pay,   'credit': Decimal('10000.00'), **kseb_party},
                ],
            )
            kseb_bill.journal_entry = kseb_bill_jv
            kseb_bill.save(update_fields=['journal_entry'])
            self.stdout.write(f"  + posted {kseb_bill_jv.entry_no} → Bill#{kseb_bill.id}")

            # KSEB payment — BillPayment for that bill.
            for payment in kseb_bill.payments.all():
                kseb_pay_jv = _create_jv(
                    date_=payment.date,
                    narration=f'Payment for Bill#{kseb_bill.id} — KSEB electricity',
                    voucher_type='PAYMENT',
                    location_id=self.DEFAULT_LOCATION_ID,
                    lines=[
                        {'account': trade_pay, 'debit': payment.amount, **kseb_party},
                        {'account': bank,      'credit': payment.amount},
                    ],
                )
                payment.journal_entry = kseb_pay_jv
                payment.save(update_fields=['journal_entry'])
                self.stdout.write(
                    f"  + posted {kseb_pay_jv.entry_no} → BillPayment#{payment.id}"
                )

        # Rent bills — by bill_no order so dates align Feb→Mar→Apr.
        rent_bills = Bill.objects.filter(vendor_name='Landlord').order_by('bill_date')
        for bill in rent_bills:
            jv = _create_jv(
                date_=bill.bill_date,
                narration=f'Rent — {bill.bill_date.strftime("%b %Y")} ({bill.bill_no})',
                voucher_type='PURCHASE',
                location_id=self.DEFAULT_LOCATION_ID,
                lines=[
                    {'account': rent_acct, 'debit': Decimal('20000.00'), **landlord_party},
                    {'account': trade_pay, 'credit': Decimal('20000.00'), **landlord_party},
                ],
            )
            bill.journal_entry = jv
            bill.save(update_fields=['journal_entry'])
            self.stdout.write(f"  + posted {jv.entry_no} → Bill#{bill.id} ({bill.bill_no})")

    # ── Step 5: drop account 1232 ──────────────────────────────────────────
    def _drop_1232(self):
        residual = (
            JournalEntryLine.objects.filter(account__account_code='1232').exists()
            or BillLine.objects.filter(account__account_code='1232').exists()
            or RecurringBillItem.objects.filter(account__account_code='1232').exists()
        )
        if residual:
            raise RuntimeError(
                "Refusing to drop account 1232: residual references exist on "
                "JournalEntryLine / BillLine / RecurringBillItem."
            )
        deleted, _ = ChartOfAccount.objects.filter(account_code='1232').delete()
        if deleted:
            self.stdout.write("  • dropped account 1232 'Current'")
            log_action(
                'DELETE', 'ChartOfAccount', None, '1232 Current',
                extra={'reason': 'cleanup_untagged_manual_jvs'},
            )

"""Regression test for H17: a recurring-bill profile with a constant /
non-cycling bill_no_pattern must not crash generation (IntegrityError → 500)
and abort the whole run-due batch.

The rendered bill_no is now disambiguated with the sequence when it would
collide on the (vendor_id, bill_no) unique constraint, and generate_due catches
IntegrityError as a safety net (pause the profile, keep the batch going).
"""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from bills.models import RecurringBill, RecurringBillItem
from bills.services import generate_due, generate_one
from core.models import ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings


class RecurringBillCollisionTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.rent = ChartOfAccount.objects.get(account_code='5410')

    def _profile(self, **kw):
        defaults = dict(
            profile_name='Monthly rent', vendor_id=5, vendor_name='Landlord',
            subtotal=Decimal('10000'), total_amount=Decimal('10000'),
            frequency='monthly', start_date=date(2026, 1, 1),
            next_run_date=date(2026, 1, 1), due_days=30,
            auto_approve=False, bill_no_pattern='RENT', location_id=1,
        )
        defaults.update(kw)
        rb = RecurringBill.objects.create(**defaults)
        RecurringBillItem.objects.create(
            recurring_bill=rb, account=self.rent, description='Office rent',
            amount=Decimal('10000'),
        )
        return rb

    def test_constant_pattern_disambiguates_across_cycles(self):
        rb = self._profile()
        b1 = generate_one(rb)
        rb.refresh_from_db()
        b2 = generate_one(rb)
        self.assertEqual(b1.bill_no, 'RENT')
        self.assertNotEqual(b1.bill_no, b2.bill_no)   # no collision crash
        self.assertTrue(b2.bill_no.startswith('RENT-'))

    def test_generate_due_catches_up_constant_pattern_without_crashing(self):
        # A profile several monthly cycles behind a constant pattern must
        # generate every overdue bill without an IntegrityError aborting the run.
        rb = self._profile(start_date=date(2026, 1, 1), next_run_date=date(2026, 1, 1))
        result = generate_due(today=date(2026, 3, 15))
        self.assertGreaterEqual(result['created'], 3)
        self.assertEqual(result['errors'], [])
        rb.refresh_from_db()
        self.assertEqual(rb.status, 'active')   # not paused by a crash
        # All generated bills for this vendor have distinct numbers.
        from bills.models import Bill
        nos = list(Bill.objects.filter(vendor_id=5).values_list('bill_no', flat=True))
        self.assertEqual(len(nos), len(set(nos)))

"""BillViewSet.list must return every match, not DRF's first 50.

The project sets a global DEFAULT_PAGINATION_CLASS + PAGE_SIZE 50, so the bill
list silently truncated. That is not a cosmetic paging gap: Payables and the
Bills list compute their totals, footer count and tab badges from the rows they
received and neither screen has a pager, so bill 51 onward was both invisible
and unpayable — while the sibling `counts` action calls get_queryset() directly
and so kept reporting the true total right next to the short list.

Pinned here rather than left to the frontend's shape-normaliser: the fix is a
one-line `pagination_class = None` that any later "let's paginate this again"
would quietly undo, and the failure mode is wrong money on screen, not an error.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bills.models import Bill
from core.tests.utils import make_admin, make_settings, seed_chart_and_mappings

# Comfortably past DRF's PAGE_SIZE of 50 so a regression cannot hide.
BILL_COUNT = 60
AMOUNT = Decimal('100.00')


class BillListPaginationTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.client = APIClient()
        self.client.force_authenticate(user=make_admin())
        for i in range(BILL_COUNT):
            Bill.objects.create(
                bill_no=f'V-{i:03d}', bill_date=date(2026, 4, 5),
                due_date=date(2026, 4, 5) + timedelta(days=30),
                vendor_id=1, vendor_name='Acme', total_amount=AMOUNT,
                status='open',
            )

    def test_list_returns_every_bill_in_one_response(self):
        res = self.client.get('/api/bills/bills/')
        self.assertEqual(res.status_code, 200)
        # A bare list, not a {count, next, results} envelope — this is the
        # shape frontend getBills() normalises and getAllBills() terminates on
        # (no `next`, so it stops after one request).
        self.assertIsInstance(res.data, list)
        self.assertEqual(len(res.data), BILL_COUNT)

    def test_list_total_agrees_with_the_counts_badge(self):
        # The mismatch this fix removes: `counts` never went through the
        # paginator, so the badge and the rows beneath it disagreed by 10.
        rows = self.client.get('/api/bills/bills/').data
        counts = self.client.get('/api/bills/bills/counts/').data
        self.assertEqual(counts['total'], len(rows))
        self.assertEqual(
            Decimal(counts['outstanding']),
            sum((Decimal(r['total_amount']) - Decimal(r['amount_paid'])
                 for r in rows), Decimal('0.00')),
        )

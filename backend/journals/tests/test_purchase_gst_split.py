"""An intra-state purchase must post Input CGST + Input SGST, never Input IGST.

Reported against the live data: the pharmacy app classified the bill
intra-state and charged CGST/SGST, but after Accounting -> Sync the journal
entry carried the combined tax on Input IGST alone. The supplier's `gst_no`
read 'UNREG', and the classifier took the first two characters of it as a
state code, so the supplier appeared to sit in a state called 'UN'.
"""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.services import JournalAutoGenerationService

# make_settings() anchors the company in Maharashtra (state_code '27'), and a
# store with no GSTIN of its own inherits that anchor — see
# LocationTaxProfile.resolve.
HOME_GSTIN = '27AABCT1234A1Z5'
HOME_STATE = 'Maharashtra'
AWAY_GSTIN = '32ACBFM4693E1ZD'
AWAY_STATE = 'Kerala'


def _purchase_order(*, supplier_gstin, supplier_state=''):
    """One line, ₹1000 taxable, ₹120 tax pre-split by the inventory app the
    intra-state way (₹60 CGST + ₹60 SGST) — the shape the report describes."""
    line = SimpleNamespace(
        product_id=101, quantity=100, free_qty=0,
        purchase_rate=Decimal('10.00'), discount_percent=Decimal('0'),
        cgst_amount=Decimal('60.00'), sgst_amount=Decimal('60.00'),
        igst_amount=Decimal('0'), tax_percent=Decimal('12'),
    )

    class _LinesMgr:
        def all(self):
            return [line]

    return SimpleNamespace(
        id=777, state='confirmed',
        supplier=SimpleNamespace(gst_no=supplier_gstin, state=supplier_state),
        supplier_id=13, location_id=1,
        bill_date=None, bill_no='PO-UNREG-1',
        transport_cost=Decimal('0'), other_charges=Decimal('0'),
        additional_discount=Decimal('0'),
        round_off=Decimal('0'), supply_type='intra_state',
        created_at=datetime(2026, 4, 10),
        lines=_LinesMgr(),
    )


class PurchaseGstSplitTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _post(self, po):
        with patch('journals.services.PurchaseOrderRO') as MockPO:
            (MockPO.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = po
            entry = self.svc.generate_purchase(po.id)
        self.assertIsNotNone(entry)
        return {l.account.account_code: (l.debit, l.credit)
                for l in entry.lines.all()}

    def _assert_intra(self, codes):
        self.assertIn('1140', codes, 'Input CGST (1140) must be debited')
        self.assertIn('1150', codes, 'Input SGST (1150) must be debited')
        self.assertEqual(codes['1140'][0], Decimal('60.00'))
        self.assertEqual(codes['1150'][0], Decimal('60.00'))
        self.assertNotIn('1160', codes,
                         'Input IGST (1160) must not be touched intra-state')

    def test_unregistered_supplier_placeholder_gstin_splits_cgst_sgst(self):
        """gst_no='UNREG' is not a Kerala/'UN' registration — it is no
        registration, which leaves the supplier in our own state by default."""
        self._assert_intra(self._post(_purchase_order(supplier_gstin='UNREG')))

    def test_placeholder_gstin_with_a_home_state_splits_cgst_sgst(self):
        codes = self._post(_purchase_order(
            supplier_gstin='NA', supplier_state=HOME_STATE))
        self._assert_intra(codes)

    def test_registered_same_state_supplier_splits_cgst_sgst(self):
        self._assert_intra(self._post(_purchase_order(supplier_gstin=HOME_GSTIN)))

    def test_genuinely_interstate_supplier_still_posts_igst(self):
        codes = self._post(_purchase_order(supplier_gstin=AWAY_GSTIN))
        self.assertIn('1160', codes, 'Input IGST (1160) must carry the tax')
        self.assertEqual(codes['1160'][0], Decimal('120.00'))
        self.assertNotIn('1140', codes)
        self.assertNotIn('1150', codes)

    def test_placeholder_gstin_with_an_away_state_posts_igst(self):
        """The supplier's own state is the fallback the purchase path never
        passed — the three sales generators always have."""
        codes = self._post(_purchase_order(
            supplier_gstin='UNREG', supplier_state=AWAY_STATE))
        self.assertIn('1160', codes)
        self.assertEqual(codes['1160'][0], Decimal('120.00'))
        self.assertNotIn('1140', codes)

"""Supply-type detection off a free-text GSTIN field.

`gst_no` on the inventory supplier/customer master is a 50-char free-text
column, and in live data it holds placeholders as often as GSTINs — the shared
`healthcare_inv` DB ships a supplier row literally called 'Unregistered
Supplier' with gst_no='UNREG'. detect_supply_type used to take [:2] off
whatever was there, so 'UNREG' became the "state" 'UN', which equals no real
state code — every such party was classified inter-state and its whole GST
posted to a single IGST head instead of being split CGST/SGST.
"""
from django.test import SimpleTestCase

from core.gst_utils import detect_supply_type, gst_state_code


KERALA = '32'
KERALA_GSTIN = '32ACBFM4693E1ZD'
MAHARASHTRA_GSTIN = '27AABCT1234A1Z5'


class GstStateCodeTests(SimpleTestCase):
    def test_reads_the_state_code_off_a_real_gstin(self):
        self.assertEqual(gst_state_code(KERALA_GSTIN), '32')
        self.assertEqual(gst_state_code(MAHARASHTRA_GSTIN), '27')

    def test_accepts_a_bare_state_code(self):
        self.assertEqual(gst_state_code('32'), '32')
        self.assertEqual(gst_state_code(' 07 '), '07')

    def test_placeholders_carry_no_state(self):
        for junk in ('UNREG', 'NA', 'N/A', 'URP', '-', 'None', 'unregistered'):
            self.assertEqual(gst_state_code(junk), '',
                             f'{junk!r} must not be read as a state code')

    def test_blank_and_none_are_safe(self):
        self.assertEqual(gst_state_code(''), '')
        self.assertEqual(gst_state_code(None), '')

    def test_a_two_digit_prefix_that_is_not_a_state_is_rejected(self):
        # 00 and 40-96 are not allocated; 97/99 are.
        self.assertEqual(gst_state_code('00XXXXX0000X1Z0'), '')
        self.assertEqual(gst_state_code('55XXXXX0000X1Z0'), '')
        self.assertEqual(gst_state_code('97XXXXX0000X1Z0'), '97')


class DetectSupplyTypeTests(SimpleTestCase):
    def test_same_state_gstins_are_intra(self):
        self.assertEqual(
            detect_supply_type(KERALA_GSTIN, '32AAACC1234C1ZP'), 'intra_state')

    def test_different_state_gstins_are_inter(self):
        self.assertEqual(
            detect_supply_type(KERALA_GSTIN, MAHARASHTRA_GSTIN), 'inter_state')

    def test_placeholder_counterparty_gstin_is_not_another_state(self):
        """The reported defect: an intra-state purchase from a supplier whose
        gst_no reads 'UNREG' posted its whole GST to Input IGST."""
        self.assertEqual(
            detect_supply_type(KERALA_GSTIN, 'UNREG'), 'intra_state')

    def test_placeholder_gstin_falls_through_to_the_party_state(self):
        # A junk GSTIN must not shadow the state we DO know — in either
        # direction.
        self.assertEqual(
            detect_supply_type(KERALA_GSTIN, 'UNREG',
                               counterparty_state_code='32'), 'intra_state')
        self.assertEqual(
            detect_supply_type(KERALA_GSTIN, 'UNREG',
                               counterparty_state_code='27'), 'inter_state')

    def test_placeholder_business_gstin_falls_through_to_the_store_state(self):
        # A store whose GSTIN is unset resolves state_code from the company
        # anchor — that has to survive a junk override too.
        self.assertEqual(
            detect_supply_type('NA', MAHARASHTRA_GSTIN,
                               business_state_code=KERALA), 'inter_state')
        self.assertEqual(
            detect_supply_type('NA', KERALA_GSTIN,
                               business_state_code=KERALA), 'intra_state')

    def test_neither_side_known_defaults_to_intra(self):
        self.assertEqual(detect_supply_type('', ''), 'intra_state')
        self.assertEqual(detect_supply_type('UNREG', 'UNREG'), 'intra_state')

"""Regression test for M11: the B2C-Large threshold dropped from ₹2.5L to ₹1L
for invoices issued on/after 01-Aug-2024 (Notification 12/2024-CT)."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from gst_returns.services import b2cl_threshold


class B2CLThresholdTests(TestCase):
    def test_threshold_before_cutover_is_2_5_lakh(self):
        self.assertEqual(b2cl_threshold(date(2024, 7, 31)), Decimal('250000'))

    def test_threshold_on_cutover_is_1_lakh(self):
        self.assertEqual(b2cl_threshold(date(2024, 8, 1)), Decimal('100000'))

    def test_threshold_after_cutover_is_1_lakh(self):
        self.assertEqual(b2cl_threshold(date(2026, 4, 1)), Decimal('100000'))

    def test_missing_date_falls_back_to_legacy_threshold(self):
        # Defensive: no date → don't mis-classify as B2C-Large under the lower cap.
        self.assertEqual(b2cl_threshold(None), Decimal('250000'))

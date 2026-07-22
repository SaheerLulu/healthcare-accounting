"""Sales-return credit notes must honor the operator-selected refund_method
(cash drawer vs bank) carried on the pharmacy return row. Credit-sale returns
ignore it — they always clear the customer's receivable. Blank/absent keeps
the legacy behavior (mirror the original order's payment_type)."""
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.services import JournalAutoGenerationService
from journals.tests.test_b2b_payment_modes import _b2b_return


class RefundMethodRoutingTests(TestCase):

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.svc = JournalAutoGenerationService()

    def _generate(self, ret):
        with patch('journals.services.SalesReturnRO') as MockRO, \
             patch.object(self.svc, '_product_avg_cost', return_value=Decimal('60.00')):
            (MockRO.objects.select_related.return_value
             .prefetch_related.return_value.get.return_value) = ret
            return self.svc.generate_sales_return(ret.id)

    def _lines(self, entry, code):
        return [l for l in entry.lines.all() if l.account.account_code == code]

    def test_cash_sale_refunded_via_bank_credits_bank(self):
        ret = _b2b_return(original_payment_type='Cash', rid=811)
        ret.refund_method = 'bank'
        entry = self._generate(ret)

        bank = self._lines(entry, '1120')
        self.assertEqual(len(bank), 1, 'bank refund should credit BANK once')
        self.assertEqual(bank[0].credit, Decimal('1180.00'))
        self.assertEqual(self._lines(entry, '1110'), [],
                         'operator chose bank — CASH must stay untouched')

    def test_upi_sale_refunded_via_cash_credits_cash(self):
        ret = _b2b_return(original_payment_type='UPI', rid=812)
        ret.refund_method = 'cash'
        entry = self._generate(ret)

        cash = self._lines(entry, '1110')
        self.assertEqual(len(cash), 1, 'cash refund should credit CASH once')
        self.assertEqual(cash[0].credit, Decimal('1180.00'))
        self.assertEqual(self._lines(entry, '1120'), [],
                         'operator chose cash — BANK must stay untouched')

    def test_credit_sale_return_ignores_refund_method(self):
        ret = _b2b_return(original_payment_type='Credit', rid=813)
        ret.refund_method = 'bank'
        entry = self._generate(ret)

        ar = self._lines(entry, '1130')
        self.assertEqual(len(ar), 1, 'credit-sale return must clear AR')
        self.assertEqual(ar[0].credit, Decimal('1180.00'))
        self.assertEqual(self._lines(entry, '1120'), [])
        self.assertEqual(self._lines(entry, '1110'), [])

    def test_blank_refund_method_falls_back_to_original_tender(self):
        ret = _b2b_return(original_payment_type='UPI', rid=814)
        ret.refund_method = ''
        entry = self._generate(ret)

        bank = self._lines(entry, '1120')
        self.assertEqual(len(bank), 1,
                         'blank refund_method → legacy mirror of the UPI original (BANK)')
        self.assertEqual(self._lines(entry, '1110'), [])

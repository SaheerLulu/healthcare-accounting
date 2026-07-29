"""A pharmacy-counter service bill must post as clinical income, without COGS.

The POS can now bill clinical services (consultation fees, procedures). A mixed
checkout writes two `pos_posorder` rows: a goods invoice and a service bill. They
reach accounting through the same `sync_pos` → `generate_pos_sale` path, so the
posting has to branch on `doc_type`:

* no COGS and no stock relief on the service bill — nothing was ever stocked;
* exempt clinical services credit 4320 CONSULTATION_INCOME, the same head
  reception's fee collections use, so GSTR-3B 3.1(c) exempt outward supplies picks
  them up unchanged;
* taxable services (a cosmetic procedure at 18%) credit 4330 SERVICE_INCOME instead
  — 4320 is declared GST-exempt and must not absorb a taxable supply.
"""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from core.models import AccountMapping, ChartOfAccount
from core.tests.utils import make_settings, seed_chart_and_mappings
from journals.services import JournalAutoGenerationService


class _LinesMgr:
    def __init__(self, lines):
        self._lines = lines

    def all(self):
        return self._lines


def _service_line(*, total, tax='0', taxability='exempt', sac='999312'):
    return SimpleNamespace(
        line_total=Decimal(total), tax_percent=Decimal(tax),
        product_id=None, quantity=1,
        is_service=True, taxability_class=taxability,
        sac_code=sac, service_description='Consultation',
    )


def _goods_line(*, total='1180.00', tax='18', product_id=301, qty=10):
    return SimpleNamespace(
        line_total=Decimal(total), tax_percent=Decimal(tax),
        product_id=product_id, quantity=qty,
        is_service=False, taxability_class='',
        sac_code='', service_description='',
    )


class ServiceBillPostingTests(TestCase):

    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        # 4330 is seeded by the real chart but not by the minimal test seed.
        svc_acct, _ = ChartOfAccount.objects.get_or_create(
            account_code='4330',
            defaults=dict(account_name='Sales - Procedure / Day-care',
                          account_type='REVENUE', account_subtype='Sales',
                          is_leaf=True, is_active=True),
        )
        AccountMapping.objects.get_or_create(
            key='SERVICE_INCOME', defaults={'account': svc_acct})
        cons_acct, _ = ChartOfAccount.objects.get_or_create(
            account_code='4320',
            defaults=dict(account_name='Sales - Consultation',
                          account_type='REVENUE', account_subtype='Sales',
                          is_leaf=True, is_active=True),
        )
        AccountMapping.objects.get_or_create(
            key='CONSULTATION_INCOME', defaults={'account': cons_acct})
        self.svc = JournalAutoGenerationService()

    def _make_order(self, lines, *, doc_type='service', oid=901, total=None):
        subtotal = sum((l.line_total for l in lines), Decimal('0.00'))
        return SimpleNamespace(
            id=oid, status='completed',
            invoice_no='MAINSRV2627001' if doc_type == 'service' else 'MAINB2C2627001',
            doc_type=doc_type, bill_group='grp-1',
            customer_id=None, location_id=1,
            sale_date=datetime(2026, 4, 15),
            payment_type='Cash',
            discount_amount=Decimal('0.00'),
            round_off=Decimal('0.00'),
            subtotal=subtotal,
            total_amount=total if total is not None else subtotal,
            lines=_LinesMgr(lines),
        )

    def _generate(self, order, avg_cost=Decimal('0')):
        with patch('journals.services.POSOrderRO') as MockPOS, \
             patch.object(self.svc, '_product_avg_cost', return_value=avg_cost):
            MockPOS.objects.prefetch_related.return_value.get.return_value = order
            return self.svc.generate_pos_sale(order.id)

    def _codes(self, entry):
        return {l.account.account_code: (l.debit, l.credit) for l in entry.lines.all()}

    def _assert_balanced(self, entry):
        lines = list(entry.lines.all())
        dr = sum((l.debit for l in lines), Decimal('0'))
        cr = sum((l.credit for l in lines), Decimal('0'))
        self.assertEqual(dr, cr, f'{entry.narration} must balance')

    # -- exempt -------------------------------------------------------------

    def test_exempt_service_credits_consultation_income_and_balances(self):
        entry = self._generate(self._make_order([_service_line(total='500.00')]))
        self.assertIsNotNone(entry)
        self.assertTrue(entry.is_posted)
        self._assert_balanced(entry)

        codes = self._codes(entry)
        self.assertEqual(codes['4320'][1], Decimal('500.00'))
        self.assertNotIn('4100', codes, 'clinical income must not land in POS sales')
        # Exempt: no output-tax legs at all.
        for gst in ('2110', '2120', '2130'):
            self.assertNotIn(gst, codes)

    def test_exempt_service_posts_no_cogs(self):
        # A non-zero avg cost would still produce COGS legs if the guard were
        # missing — this is the assertion that would catch that.
        entry = self._generate(self._make_order([_service_line(total='500.00')]),
                               avg_cost=Decimal('120.00'))
        codes = self._codes(entry)
        self.assertNotIn('5560', codes, 'a service has no cost of goods sold')
        self.assertNotIn('1190', codes, 'a service relieves no closing stock')

    def test_narration_names_it_a_service_bill(self):
        entry = self._generate(self._make_order([_service_line(total='500.00')]))
        self.assertIn('Service Bill', entry.narration)

    # -- taxable ------------------------------------------------------------

    def test_taxable_service_credits_its_own_head_not_the_exempt_one(self):
        # ₹590 incl. 18% -> taxable 500, tax 90 (45 CGST / 45 SGST).
        entry = self._generate(self._make_order([
            _service_line(total='590.00', tax='18', taxability='taxable',
                          sac='999315'),
        ]))
        self._assert_balanced(entry)
        codes = self._codes(entry)
        self.assertEqual(codes['4330'][1], Decimal('500.00'))
        self.assertNotIn('4320', codes,
                         '4320 is declared GST-exempt and must not hold a taxable supply')

    # -- the goods half is untouched ----------------------------------------

    def test_goods_document_is_unchanged(self):
        entry = self._generate(
            self._make_order([_goods_line()], doc_type='goods', oid=902),
            avg_cost=Decimal('40.00'),
        )
        self._assert_balanced(entry)
        codes = self._codes(entry)
        self.assertEqual(codes['4100'][1], Decimal('1000.00'))
        self.assertIn('5560', codes, 'a goods sale still relieves COGS')
        self.assertIn('POS Sale', entry.narration)

    # -- the balancing equation ---------------------------------------------

    def test_exempt_revenue_is_in_the_round_off_equation(self):
        """Regression: `diff` is computed from the credit legs. If exempt revenue
        were split out of `sales_amount` without being added back here, every
        service bill over ₹1 would post unbalanced and be swallowed by the sync
        loop — exactly the C2 defect that discounts once caused."""
        order = self._make_order([_service_line(total='500.00')])
        entry = self._generate(order)
        codes = self._codes(entry)
        # No round-off leg should be needed at all: the equation nets to zero.
        self.assertNotIn('6300', codes)
        self._assert_balanced(entry)

    def test_mixed_lines_on_one_document_split_by_taxability(self):
        """Defensive: a doc_type='service' bill holding both an exempt and a
        taxable line must credit both heads, not collapse them."""
        entry = self._generate(self._make_order([
            _service_line(total='500.00'),
            _service_line(total='590.00', tax='18', taxability='taxable'),
        ]))
        self._assert_balanced(entry)
        codes = self._codes(entry)
        self.assertEqual(codes['4320'][1], Decimal('500.00'))
        self.assertEqual(codes['4330'][1], Decimal('500.00'))

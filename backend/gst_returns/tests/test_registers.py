"""Tests for the live GST register builders (registers.py) and their API
views. The unmanaged inventory tables don't exist in the SQLite test DB, so
the _fetch_* query helpers are patched with in-memory fakes."""
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from core.tests.utils import fake_active_location, make_admin, make_settings, \
    seed_chart_and_mappings
from gst_returns.registers import (
    build_b2b_register, build_b2c_summary, build_credit_note_register,
    build_purchase_register,
)


class _Lines:
    def __init__(self, lines):
        self._lines = lines

    def all(self):
        return self._lines


def _line(**kw):
    defaults = dict(cgst_amount=Decimal('0'), sgst_amount=Decimal('0'),
                    igst_amount=Decimal('0'), line_total=Decimal('0'),
                    tax_percent=Decimal('0'), quantity=Decimal('1'),
                    free_qty=Decimal('0'), purchase_rate=Decimal('0'),
                    discount_percent=Decimal('0'))
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _customer(gstin='', state='Maharashtra', name='Acme Traders',
              internal=False):
    return SimpleNamespace(gst_no=gstin, state=state, customer_name=name,
                           is_internal=internal)


def _b2b_order(order_id=1, customer=None, lines=(), invoice_no='B2B-INV-1',
               sale_date=date(2026, 6, 10), total=Decimal('0'), loc=1):
    return SimpleNamespace(
        id=order_id, customer=customer, location_id=loc,
        invoice_no=invoice_no, sale_date=sale_date,
        created_at=datetime(2026, 6, 10, 10, 0),
        total_amount=total, lines=_Lines(list(lines)),
    )


def _pos_order(order_id=1, customer_id=None, lines=(), invoice_no='POS-0001',
               sale_date=datetime(2026, 6, 5, 12, 0), total=Decimal('0'),
               loc=1):
    return SimpleNamespace(
        id=order_id, customer_id=customer_id, location_id=loc,
        invoice_no=invoice_no, sale_date=sale_date, total_amount=total,
        lines=_Lines(list(lines)),
    )


def _sales_return(ret_id=1, customer=None, lines=(), return_no='CN-001',
                  return_date=datetime(2026, 6, 20, 11, 0),
                  return_type='pos', original_order=None,
                  original_b2b_order=None, loc=1, reason='damaged'):
    return SimpleNamespace(
        id=ret_id, customer=customer, location_id=loc, return_no=return_no,
        return_date=return_date, return_type=return_type,
        original_order=original_order,
        original_order_id=getattr(original_order, 'id', None),
        original_b2b_order=original_b2b_order,
        original_b2b_order_id=getattr(original_b2b_order, 'id', None),
        reason=reason, lines=_Lines(list(lines)),
    )


def _purchase(po_id=1, supplier=None, lines=(), bill_no='PB-100',
              bill_date=date(2026, 6, 3), loc=1):
    return SimpleNamespace(
        id=po_id, supplier=supplier,
        supplier_id=getattr(supplier, 'id', None),
        bill_no=bill_no, bill_date=bill_date,
        created_at=datetime(2026, 6, 3, 9, 0),
        location_id=loc, lines=_Lines(list(lines)),
    )


def _patch(target, value):
    return mock.patch(f'gst_returns.registers.{target}', value)


class RegisterTestBase(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()  # company GSTIN 27AABCT1234A1Z5, state 27


class B2BRegisterTests(RegisterTestBase):
    def test_multi_rate_invoice_emits_one_row_per_rate(self):
        order = _b2b_order(
            customer=_customer('27AABCA1234A1Z5'),
            invoice_no='INV-001', total=Decimal('17400'),
            lines=[
                # 18%: taxable 10000, tax 1800 (line_total is tax-inclusive)
                _line(line_total=Decimal('11800'), tax_percent=Decimal('18'),
                      cgst_amount=Decimal('900'), sgst_amount=Decimal('900')),
                # 12%: taxable 5000, tax 600
                _line(line_total=Decimal('5600'), tax_percent=Decimal('12'),
                      cgst_amount=Decimal('300'), sgst_amount=Decimal('300')),
            ])
        with _patch('_fetch_b2b_orders', lambda *a, **k: [order]), \
             _patch('_fetch_pos_orders', lambda *a, **k: []), \
             _patch('_fetch_pos_customers', lambda *a, **k: {}):
            data = build_b2b_register('2026-06', 1)

        self.assertEqual(len(data['rows']), 2)
        self.assertEqual(data['invoice_count'], 1)
        by_rate = {str(r['rate']): r for r in data['rows']}
        r18 = by_rate['18.00']
        self.assertEqual(r18['taxable_value'], Decimal('10000.00'))
        self.assertEqual(r18['cgst'], Decimal('900.00'))
        self.assertEqual(r18['sgst'], Decimal('900.00'))
        self.assertEqual(r18['igst'], Decimal('0.00'))
        # Common invoice details repeated on every rate row
        for r in data['rows']:
            self.assertEqual(r['invoice_no'], 'INV-001')
            self.assertEqual(r['invoice_value'], Decimal('17400.00'))
            self.assertEqual(r['gstin'], '27AABCA1234A1Z5')
        self.assertEqual(data['totals']['taxable_value'], '15000.00')
        self.assertEqual(data['totals']['cgst'], '1200.00')

    def test_inter_state_buyer_lands_in_igst(self):
        order = _b2b_order(
            customer=_customer('29AADCX5678B1Z2', state='Karnataka',
                               name='XYZ Enterprises'),
            total=Decimal('9440'),
            lines=[_line(line_total=Decimal('9440'),
                         tax_percent=Decimal('18'),
                         igst_amount=Decimal('1440'))])
        with _patch('_fetch_b2b_orders', lambda *a, **k: [order]), \
             _patch('_fetch_pos_orders', lambda *a, **k: []), \
             _patch('_fetch_pos_customers', lambda *a, **k: {}):
            data = build_b2b_register('2026-06', 1)
        row = data['rows'][0]
        self.assertEqual(row['supply_type'], 'inter_state')
        self.assertEqual(row['igst'], Decimal('1440.00'))
        self.assertEqual(row['cgst'], Decimal('0.00'))
        self.assertEqual(row['place_of_supply'], '29')

    def test_unregistered_orders_and_pos_gstin_capture(self):
        unreg = _b2b_order(order_id=2, customer=_customer(''),
                           total=Decimal('500'),
                           lines=[_line(line_total=Decimal('500'),
                                        tax_percent=Decimal('5'))])
        pos = _pos_order(customer_id=42, total=Decimal('1050'),
                         lines=[_line(line_total=Decimal('1050'),
                                      tax_percent=Decimal('5'))])
        customers = {42: _customer('27AABCP9999P1Z7', name='Reg Pharmacy')}
        with _patch('_fetch_b2b_orders', lambda *a, **k: [unreg]), \
             _patch('_fetch_pos_orders', lambda *a, **k: [pos]), \
             _patch('_fetch_pos_customers', lambda *a, **k: customers):
            data = build_b2b_register('2026-06', 1)
        # Unregistered B2B-module order excluded; registered POS sale included
        self.assertEqual(len(data['rows']), 1)
        row = data['rows'][0]
        self.assertEqual(row['source'], 'pos')
        # POS lines are tax-inclusive: 1050 @5% → taxable 1000, tax 50
        self.assertEqual(row['taxable_value'], Decimal('1000.00'))
        self.assertEqual(row['cgst'], Decimal('25.00'))
        self.assertEqual(row['sgst'], Decimal('25.00'))


class B2CSummaryTests(RegisterTestBase):
    def test_rate_wise_aggregation_and_return_netting(self):
        pos1 = _pos_order(order_id=1, total=Decimal('2100'), lines=[
            _line(line_total=Decimal('1050'), tax_percent=Decimal('5')),
            _line(line_total=Decimal('1120'), tax_percent=Decimal('12')),
        ])
        pos2 = _pos_order(order_id=2, total=Decimal('525'), lines=[
            _line(line_total=Decimal('525'), tax_percent=Decimal('5')),
        ])
        ret = _sales_return(lines=[
            _line(line_total=Decimal('105'), tax_percent=Decimal('5')),
        ])
        with _patch('_fetch_pos_orders', lambda *a, **k: [pos1, pos2]), \
             _patch('_fetch_pos_customers', lambda *a, **k: {}), \
             _patch('_fetch_b2b_orders', lambda *a, **k: []), \
             _patch('_fetch_sales_returns', lambda *a, **k: [ret]):
            data = build_b2c_summary('2026-06', 1)

        by_rate = {str(r['rate']): r for r in data['rows']}
        # 5%: (1000 + 500) sales − 100 return = 1400 taxable, 70 tax
        r5 = by_rate['5.00']
        self.assertEqual(r5['taxable_value'], Decimal('1400.00'))
        self.assertEqual(r5['cgst'], Decimal('35.00'))
        self.assertEqual(r5['sgst'], Decimal('35.00'))
        self.assertEqual(r5['supply_type'], 'intra_state')
        # 12%: 1000 taxable, 120 tax
        r12 = by_rate['12.00']
        self.assertEqual(r12['taxable_value'], Decimal('1000.00'))
        self.assertEqual(r12['total_tax'], Decimal('120.00'))

    def test_registered_buyers_and_b2cl_are_excluded(self):
        reg_pos = _pos_order(order_id=1, customer_id=7, total=Decimal('1050'),
                             lines=[_line(line_total=Decimal('1050'),
                                          tax_percent=Decimal('5'))])
        big_inter = _pos_order(
            order_id=2, customer_id=8, total=Decimal('150000'),
            lines=[_line(line_total=Decimal('150000'),
                         tax_percent=Decimal('12'))])
        customers = {
            7: _customer('27AABCP9999P1Z7'),           # registered → B2B
            8: _customer('', state='Karnataka'),       # inter-state large
        }
        with _patch('_fetch_pos_orders', lambda *a, **k: [reg_pos, big_inter]), \
             _patch('_fetch_pos_customers', lambda *a, **k: customers), \
             _patch('_fetch_b2b_orders', lambda *a, **k: []), \
             _patch('_fetch_sales_returns', lambda *a, **k: []):
            data = build_b2c_summary('2026-06', 1)
        self.assertEqual(data['rows'], [])
        self.assertEqual(data['b2cl_excluded'], 1)


class CreditNoteRegisterTests(RegisterTestBase):
    def test_cdnr_vs_cdnur_and_rate_rows(self):
        reg_ret = _sales_return(
            ret_id=1, return_no='CN-001',
            customer=_customer('27AABCA1234A1Z5', name='ABC Traders'),
            original_b2b_order=SimpleNamespace(
                id=11, invoice_no='INV-001', sale_date=date(2026, 6, 1)),
            lines=[
                _line(line_total=Decimal('5900'), tax_percent=Decimal('18')),
                _line(line_total=Decimal('1120'), tax_percent=Decimal('12')),
            ])
        walkin_ret = _sales_return(
            ret_id=2, return_no='CN-002', customer=None,
            lines=[_line(line_total=Decimal('210'),
                         tax_percent=Decimal('5'))])
        with _patch('_fetch_sales_returns',
                    lambda *a, **k: [reg_ret, walkin_ret]):
            data = build_credit_note_register('2026-06', 1)

        self.assertEqual(data['note_count'], 2)
        self.assertEqual(len(data['rows']), 3)  # 2 rates + 1 walk-in
        cdnr = [r for r in data['rows'] if r['note_type'] == 'CDNR']
        cdnur = [r for r in data['rows'] if r['note_type'] == 'CDNUR']
        self.assertEqual(len(cdnr), 2)
        self.assertEqual(len(cdnur), 1)
        r18 = next(r for r in cdnr if str(r['rate']) == '18.00')
        # Amounts positive in the register (sign carried by note type)
        self.assertEqual(r18['taxable_value'], Decimal('5000.00'))
        self.assertEqual(r18['cgst'], Decimal('450.00'))
        self.assertEqual(r18['original_invoice_no'], 'INV-001')
        self.assertFalse(r18['is_time_barred'])

    def test_time_bar_is_anchored_to_original_invoice_fy(self):
        stale = _sales_return(
            return_no='CN-OLD',
            return_date=datetime(2026, 6, 20, 10, 0),
            customer=_customer('27AABCA1234A1Z5'),
            original_b2b_order=SimpleNamespace(
                id=5, invoice_no='INV-OLD', sale_date=date(2024, 5, 10)),
            lines=[_line(line_total=Decimal('118'),
                         tax_percent=Decimal('18'))])
        with _patch('_fetch_sales_returns', lambda *a, **k: [stale]):
            data = build_credit_note_register('2026-06', 1)
        # FY 2024-25 supply → §34(2) deadline 30-Nov-2025 → June 2026 CN barred
        self.assertTrue(data['rows'][0]['is_time_barred'])

    def test_internal_counterparty_returns_are_skipped(self):
        internal = _sales_return(
            customer=_customer('', name='Branch 2', internal=True),
            lines=[_line(line_total=Decimal('105'),
                         tax_percent=Decimal('5'))])
        with _patch('_fetch_sales_returns', lambda *a, **k: [internal]):
            data = build_credit_note_register('2026-06', 1)
        self.assertEqual(data['rows'], [])


class PurchaseRegisterTests(RegisterTestBase):
    def test_line_derivation_and_registered_split(self):
        reg_supplier = SimpleNamespace(
            id=1, gst_no='27AABCS4321S1Z9', company_name='PQR Supplies',
            state='Maharashtra')
        unreg_supplier = SimpleNamespace(
            id=2, gst_no='', company_name='Local Vendor', state='Kerala')
        po1 = _purchase(po_id=1, supplier=reg_supplier, lines=[
            # (10 + 2 free) x 50 x 90% = 540 taxable @12% → 64.80 tax
            _line(quantity=Decimal('10'), free_qty=Decimal('2'),
                  purchase_rate=Decimal('50'),
                  discount_percent=Decimal('10'),
                  tax_percent=Decimal('12')),
        ])
        po2 = _purchase(po_id=2, supplier=unreg_supplier, bill_no='',
                        lines=[_line(quantity=Decimal('4'),
                                     purchase_rate=Decimal('100'),
                                     tax_percent=Decimal('0'))])
        with _patch('_fetch_purchases', lambda *a, **k: [po1, po2]):
            data = build_purchase_register(date(2026, 6, 1),
                                           date(2026, 6, 30), 1)

        self.assertEqual(data['registered_count'], 1)
        self.assertEqual(data['unregistered_count'], 1)
        reg_row = next(r for r in data['rows'] if r['registered'])
        self.assertEqual(reg_row['taxable_value'], Decimal('540.00'))
        self.assertEqual(reg_row['cgst'], Decimal('32.40'))
        self.assertEqual(reg_row['sgst'], Decimal('32.40'))
        self.assertEqual(reg_row['invoice_value'], Decimal('604.80'))
        unreg_row = next(r for r in data['rows'] if not r['registered'])
        self.assertEqual(unreg_row['supplier_gstin'], 'Unregistered')
        self.assertEqual(unreg_row['invoice_no'], 'PO-2')
        self.assertEqual(data['totals']['taxable_value'], '940.00')


class RegisterViewTests(RegisterTestBase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=make_admin())

    def test_period_validation(self):
        with fake_active_location(all_access=True):
            for url in ('/api/gst/reports/b2b-register/',
                        '/api/gst/reports/b2c-summary/',
                        '/api/gst/reports/credit-notes/',
                        '/api/gst/working-papers/'):
                self.assertEqual(self.client.get(url).status_code, 400)
                self.assertEqual(
                    self.client.get(url, {'period': 'junk'}).status_code, 400)

    def test_json_and_csv_shapes(self):
        with fake_active_location(all_access=True), mock.patch.multiple(
            'gst_returns.registers',
            _fetch_pos_orders=lambda *a, **k: [],
            _fetch_pos_customers=lambda *a, **k: {},
            _fetch_b2b_orders=lambda *a, **k: [],
            _fetch_sales_returns=lambda *a, **k: [],
        ):
            res = self.client.get('/api/gst/reports/b2b-register/',
                                  {'period': '2026-06'},
                                  HTTP_X_LOCATION_ID='1')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.data['rows'], [])
            self.assertIn('totals', res.data)

            csv_res = self.client.get(
                '/api/gst/reports/credit-notes/',
                {'period': '2026-06', 'export': 'csv'},
                HTTP_X_LOCATION_ID='1')
            self.assertEqual(csv_res.status_code, 200)
            self.assertEqual(csv_res['Content-Type'], 'text/csv')
            self.assertIn('Credit_Note_Register_2026-06.csv',
                          csv_res['Content-Disposition'])

    def test_working_papers_returns_xlsx(self):
        with fake_active_location(all_access=True), mock.patch.multiple(
            'gst_returns.registers',
            _fetch_pos_orders=lambda *a, **k: [],
            _fetch_pos_customers=lambda *a, **k: {},
            _fetch_b2b_orders=lambda *a, **k: [],
            _fetch_sales_returns=lambda *a, **k: [],
            _fetch_purchases=lambda *a, **k: [],
        ), mock.patch('gst_returns.services.build_doc_summary',
                      lambda *a, **k: []):
            res = self.client.get('/api/gst/working-papers/',
                                  {'period': '2026-06'},
                                  HTTP_X_LOCATION_ID='1')
        self.assertEqual(res.status_code, 200)
        self.assertIn('spreadsheetml', res['Content-Type'])
        self.assertIn('GST_Working_Papers_2026-06', res['Content-Disposition'])

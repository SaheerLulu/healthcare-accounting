"""Tests for the books-side registers: Expense Register and Asset Register
(real managed models), plus the Purchase Register endpoint (stubbed
inventory fetcher) and the export formats."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from bills.models import Bill, BillLine
from core.models import ChartOfAccount
from core.tests.utils import fake_active_location, make_admin, \
    make_journal_entry, make_settings, seed_chart_and_mappings
from expenses.models import Expense, ExpenseItem
from fixed_assets.models import AssetClass, DepreciationEntry, FixedAsset
from reports.registers import build_asset_register, build_expense_register


class RegisterTestBase(TestCase):
    def setUp(self):
        self.coa = seed_chart_and_mappings()
        make_settings()


class ExpenseRegisterTests(RegisterTestBase):
    def _make_expense(self, status='recorded', loc=1, **kw):
        defaults = dict(
            expense_date=date(2026, 6, 5),
            paid_through_account=self.coa['1110'],
            vendor_name='Property Owner', vendor_id=7,
            subtotal=Decimal('20000'), tax_cgst=Decimal('1800'),
            tax_sgst=Decimal('1800'), tax_igst=Decimal('0'),
            total_amount=Decimal('23600'), status=status, location_id=loc,
        )
        defaults.update(kw)
        e = Expense.objects.create(**defaults)
        ExpenseItem.objects.create(expense=e, account=self.coa['5410'],
                                   amount=defaults['subtotal'])
        return e

    def _make_bill(self, status='open', loc=1, **kw):
        defaults = dict(
            bill_no='TC-778', bill_date=date(2026, 6, 10),
            vendor_name='Tech Consultants', vendor_id=8,
            subtotal=Decimal('15000'), tax_cgst=Decimal('0'),
            tax_sgst=Decimal('0'), tax_igst=Decimal('2700'),
            total_amount=Decimal('17700'), status=status, location_id=loc,
        )
        defaults.update(kw)
        b = Bill.objects.create(**defaults)
        BillLine.objects.create(bill=b, account=self.coa['5420'],
                                amount=defaults['subtotal'])
        return b

    def test_merges_expenses_and_bills_with_gst_columns(self):
        self._make_expense()
        self._make_bill()
        self._make_expense(status='draft')            # excluded
        self._make_bill(status='cancelled', bill_no='X')  # excluded

        gstin_map = {7: '32AAAJP1234K1Z5', 8: '32AACTC5678M1Z9'}
        with mock.patch('reports.registers._supplier_gstin_map',
                        lambda ids: gstin_map):
            data = build_expense_register(date(2026, 6, 1),
                                          date(2026, 6, 30), 1)

        self.assertEqual(data['voucher_count'], 2)
        exp_row = next(r for r in data['rows'] if r['source'] == 'Expense')
        bill_row = next(r for r in data['rows'] if r['source'] == 'Bill')
        self.assertEqual(exp_row['head'], 'Rent Expense')
        self.assertEqual(exp_row['gstin'], '32AAAJP1234K1Z5')
        self.assertEqual(exp_row['cgst'], Decimal('1800.00'))
        self.assertEqual(exp_row['paid_through'],
                         self.coa['1110'].account_name)
        self.assertEqual(bill_row['voucher_no'], 'TC-778')
        self.assertEqual(bill_row['igst'], Decimal('2700.00'))
        self.assertEqual(data['totals']['taxable_value'], '35000.00')
        self.assertEqual(data['totals']['total'], '41300.00')

    def test_location_and_date_scoping(self):
        self._make_expense()
        self._make_expense(loc=2)                              # other store
        self._make_expense(expense_date=date(2026, 5, 20))     # out of range
        with mock.patch('reports.registers._supplier_gstin_map',
                        lambda ids: {}):
            data = build_expense_register(date(2026, 6, 1),
                                          date(2026, 6, 30), 1)
        self.assertEqual(data['voucher_count'], 1)

    def test_non_gst_vouchers_are_counted(self):
        self._make_expense(vendor_name='Staff', subtotal=Decimal('50000'),
                           tax_cgst=Decimal('0'), tax_sgst=Decimal('0'),
                           total_amount=Decimal('50000'))
        with mock.patch('reports.registers._supplier_gstin_map',
                        lambda ids: {}):
            data = build_expense_register(date(2026, 6, 1),
                                          date(2026, 6, 30), 1)
        self.assertEqual(data['non_gst_count'], 1)


class AssetRegisterTests(RegisterTestBase):
    def setUp(self):
        super().setUp()
        self.asset_class = AssetClass.objects.create(
            code='COMP', name='Computers', useful_life_years=3,
            asset_account=self.coa['1190'],
            accum_dep_account=self.coa['3300'],
            dep_expense_account=self.coa['5560'],
        )

    def _make_asset(self, **kw):
        je = make_journal_entry(
            d=date(2026, 5, 1),
            lines=[
                (self.coa['1190'], Decimal('60000'), Decimal('0')),
                (self.coa['1160'], Decimal('10800'), Decimal('0')),
                (self.coa['1120'], Decimal('0'), Decimal('70800')),
            ])
        defaults = dict(
            asset_no='AST-001', name='Dell Latitude',
            asset_class=self.asset_class, location_id=1,
            vendor_name='Dell India', vendor_id=9,
            acquisition_date=date(2026, 5, 1),
            acquisition_cost=Decimal('60000'),
            acquisition_journal_entry=je,
        )
        defaults.update(kw)
        return FixedAsset.objects.create(**defaults)

    def test_itc_split_from_acquisition_je_and_nbv(self):
        asset = self._make_asset()
        DepreciationEntry.objects.create(fixed_asset=asset, period='2026-05',
                                         amount=Decimal('1000'), method='SLM')
        DepreciationEntry.objects.create(fixed_asset=asset, period='2026-07',
                                         amount=Decimal('1000'), method='SLM')
        with mock.patch('reports.registers._supplier_gstin_map',
                        lambda ids: {9: '27AABCD9012N1Z3'}):
            data = build_asset_register(date(2026, 4, 1),
                                        date(2026, 6, 30), 1)
        self.assertEqual(data['asset_count'], 1)
        row = data['rows'][0]
        self.assertEqual(row['igst'], Decimal('10800.00'))
        self.assertEqual(row['cgst'], Decimal('0.00'))
        self.assertEqual(row['invoice_value'], Decimal('70800.00'))
        self.assertEqual(row['gstin'], '27AABCD9012N1Z3')
        # Depreciation only up to the end date's month (2026-06)
        self.assertEqual(row['accumulated_depreciation'], Decimal('1000.00'))
        self.assertEqual(row['net_book_value'], Decimal('59000.00'))

    def test_date_range_filters_acquisitions(self):
        self._make_asset()
        with mock.patch('reports.registers._supplier_gstin_map',
                        lambda ids: {}):
            data = build_asset_register(date(2026, 6, 1), None, 1)
        self.assertEqual(data['asset_count'], 0)


class RegisterEndpointTests(RegisterTestBase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=make_admin())

    def test_expense_register_endpoint_json_and_exports(self):
        with fake_active_location(all_access=True):
            res = self.client.get(
                '/api/reports/expense-register/',
                {'start_date': '2026-06-01', 'end_date': '2026-06-30'},
                HTTP_X_LOCATION_ID='1')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.data['rows'], [])

            csv_res = self.client.get(
                '/api/reports/expense-register/',
                {'start_date': '2026-06-01', 'end_date': '2026-06-30',
                 'export': 'csv'},
                HTTP_X_LOCATION_ID='1')
            self.assertEqual(csv_res['Content-Type'], 'text/csv')

            xlsx_res = self.client.get(
                '/api/reports/expense-register/',
                {'start_date': '2026-06-01', 'end_date': '2026-06-30',
                 'export': 'xlsx'},
                HTTP_X_LOCATION_ID='1')
            self.assertIn('spreadsheetml', xlsx_res['Content-Type'])

    def test_bad_dates_return_400(self):
        with fake_active_location(all_access=True):
            res = self.client.get('/api/reports/expense-register/',
                                  {'start_date': 'junk'})
            self.assertEqual(res.status_code, 400)
            res = self.client.get(
                '/api/reports/asset-register/',
                {'start_date': '2026-06-30', 'end_date': '2026-06-01'})
            self.assertEqual(res.status_code, 400)

    def test_purchase_register_endpoint(self):
        supplier = SimpleNamespace(id=1, gst_no='27AABCS4321S1Z9',
                                   company_name='PQR Supplies',
                                   state='Maharashtra')
        po = SimpleNamespace(
            id=1, supplier=supplier, supplier_id=1, bill_no='PB-1',
            bill_date=date(2026, 6, 3), created_at=None, location_id=1,
            lines=SimpleNamespace(all=lambda: [SimpleNamespace(
                quantity=Decimal('10'), free_qty=Decimal('0'),
                purchase_rate=Decimal('100'),
                discount_percent=Decimal('0'),
                tax_percent=Decimal('12'))]),
        )
        with fake_active_location(all_access=True), \
             mock.patch('gst_returns.registers._fetch_purchases',
                        lambda *a, **k: [po]):
            res = self.client.get(
                '/api/reports/purchase-register/',
                {'start_date': '2026-06-01', 'end_date': '2026-06-30'},
                HTTP_X_LOCATION_ID='1')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['registered_count'], 1)
        row = res.data['rows'][0]
        self.assertEqual(row['taxable_value'], '1000.00')
        self.assertEqual(row['cgst'], '60.00')
        self.assertEqual(row['invoice_value'], '1120.00')

    def test_regular_user_without_header_is_refused(self):
        from core.tests.utils import make_user
        client = APIClient()
        client.force_authenticate(user=make_user())
        with fake_active_location(all_access=False):
            res = client.get('/api/reports/expense-register/')
        self.assertEqual(res.status_code, 403)

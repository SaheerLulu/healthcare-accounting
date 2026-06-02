"""Tests for payroll: salary computation, JV posting, payslip PDF, bank file."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.tests.utils import make_settings, seed_chart_and_mappings
from payroll.models import Employee, PayrollRun, SalaryStructure
from payroll.services import (
    PayrollService, generate_bank_disbursement_file, generate_payslip_pdf,
)


class SalaryComputationTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()

    def _employee_with_structure(self, **structure_kw):
        emp = Employee.objects.create(
            employee_code='E001', name='Alice', date_of_joining=date(2025, 1, 1),
            location_id=1, bank_account_no='12345', bank_ifsc='HDFC0000001',
            pan='ABCDE1234F',
        )
        defaults = dict(
            employee=emp, basic_salary=Decimal('30000'), hra=Decimal('15000'),
            conveyance=Decimal('1600'), medical=Decimal('1250'),
            special_allowance=Decimal('5000'),
            pf_employee_pct=Decimal('12'), pf_employer_pct=Decimal('12'),
            esi_employee_pct=Decimal('0.75'), esi_employer_pct=Decimal('3.25'),
            professional_tax=Decimal('200'),
            effective_from=date(2025, 1, 1), is_active=True,
        )
        defaults.update(structure_kw)
        SalaryStructure.objects.create(**defaults)
        return emp

    def test_salary_calculation(self):
        emp = self._employee_with_structure()
        svc = PayrollService()
        struct = emp.salary_structures.first()
        calc = svc.calculate_salary(emp, struct)

        self.assertEqual(calc['gross_salary'], Decimal('52850'))
        # PF on basic capped at the ₹15,000 EPF ceiling: 12% × 15,000 = 1,800
        # (basic is 30,000, but the statutory ceiling applies).
        self.assertEqual(calc['pf_employee'], Decimal('1800.00'))
        # net = gross - PF emp - ESI emp - PT
        self.assertEqual(calc['net_salary'],
                         Decimal('52850') - Decimal('1800') -
                         Decimal('396.38') - Decimal('200'))

    def test_pf_below_ceiling_is_not_capped(self):
        # basic 10,000 < the 15,000 ceiling → PF = 12% × 10,000 = 1,200 (no cap).
        emp = self._employee_with_structure(basic_salary=Decimal('10000'))
        svc = PayrollService()
        calc = svc.calculate_salary(emp, emp.salary_structures.first())
        self.assertEqual(calc['pf_employee'], Decimal('1200.00'))

    def test_process_payroll_creates_run_and_je(self):
        self._employee_with_structure()
        svc = PayrollService()
        runs = svc.process_payroll('2026-04', location_id=1)
        self.assertEqual(len(runs), 1)
        run = runs[0]
        self.assertEqual(run.status, 'processed')
        self.assertIsNotNone(run.journal_entry)
        self.assertTrue(run.journal_entry.is_posted)

    def test_process_payroll_skips_existing_run(self):
        self._employee_with_structure()
        svc = PayrollService()
        svc.process_payroll('2026-04', location_id=1)
        runs2 = svc.process_payroll('2026-04', location_id=1)
        self.assertEqual(len(runs2), 0)

    def test_mark_paid_creates_payment_je(self):
        self._employee_with_structure()
        svc = PayrollService()
        run = svc.process_payroll('2026-04', location_id=1)[0]
        run = svc.mark_paid(run.id)
        self.assertEqual(run.status, 'paid')


class PayslipPDFTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        emp = Employee.objects.create(
            employee_code='E001', name='Alice', date_of_joining=date(2025, 1, 1),
            location_id=1, bank_account_no='12345', bank_ifsc='HDFC0000001',
        )
        SalaryStructure.objects.create(
            employee=emp, basic_salary=Decimal('30000'), hra=Decimal('15000'),
            conveyance=Decimal('1600'), medical=Decimal('1250'),
            special_allowance=Decimal('5000'),
            effective_from=date(2025, 1, 1), is_active=True,
        )
        PayrollService().process_payroll('2026-04', location_id=1)

    def test_payslip_pdf_returns_bytes(self):
        run = PayrollRun.objects.first()
        pdf = generate_payslip_pdf(run)
        self.assertTrue(pdf.startswith(b'%PDF'))

    def test_disbursement_csv_lists_employees(self):
        out = generate_bank_disbursement_file('2026-04', file_format='csv')
        self.assertIn('Alice', out)
        self.assertIn('HDFC0000001', out)

    def test_disbursement_fixed_width(self):
        out = generate_bank_disbursement_file('2026-04', file_format='fixed')
        self.assertIn('Alice', out)
        # net salary in paise should be present as 15-digit number
        self.assertRegex(out, r'\d{15}')

    def test_disbursement_unknown_format_raises(self):
        with self.assertRaises(ValueError):
            generate_bank_disbursement_file('2026-04', file_format='xml')

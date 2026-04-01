from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction

from .models import Employee, SalaryStructure, PayrollRun
from journals.models import JournalEntry, JournalEntryLine
from core.models import AccountMapping


class PayrollService:
    def __init__(self):
        self._mappings = AccountMapping.get_all_mappings()

    def _acct(self, key):
        if key in self._mappings:
            return self._mappings[key]
        return AccountMapping.get_account(key)

    def calculate_salary(self, employee, structure):
        """Calculate salary components from a SalaryStructure."""
        gross = structure.gross_salary

        pf_employee = (structure.basic_salary * structure.pf_employee_pct / 100).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)
        pf_employer = (structure.basic_salary * structure.pf_employer_pct / 100).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)
        esi_employee = (gross * structure.esi_employee_pct / 100).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)
        esi_employer = (gross * structure.esi_employer_pct / 100).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)
        professional_tax = structure.professional_tax

        total_deductions = pf_employee + esi_employee + professional_tax
        net_salary = gross - total_deductions

        return {
            'gross_salary': gross,
            'basic': structure.basic_salary,
            'hra': structure.hra,
            'conveyance': structure.conveyance,
            'medical': structure.medical,
            'special_allowance': structure.special_allowance,
            'pf_employee': pf_employee,
            'pf_employer': pf_employer,
            'esi_employee': esi_employee,
            'esi_employer': esi_employer,
            'professional_tax': professional_tax,
            'tds': Decimal('0'),
            'net_salary': net_salary,
        }

    @transaction.atomic
    def process_payroll(self, period, location_id=None):
        """Process payroll for all active employees for a given period."""
        employees = Employee.objects.filter(is_active=True)
        if location_id:
            employees = employees.filter(location_id=location_id)

        created = []
        for emp in employees:
            # Skip if already processed
            if PayrollRun.objects.filter(period=period, employee=emp).exists():
                continue

            structure = SalaryStructure.objects.filter(
                employee=emp, is_active=True, effective_from__lte=period + '-28'
            ).first()
            if not structure:
                continue

            calc = self.calculate_salary(emp, structure)

            # Create journal entry
            entry = JournalEntry.objects.create(
                date=period + '-28',  # Last working day approximation
                narration=f'Salary for {period} - {emp.name}',
                voucher_type='JOURNAL',
                reference_type='Manual',
                location_id=location_id or emp.location_id,
            )

            # Debit: Salary Expense (gross + employer contributions)
            salary_expense = calc['gross_salary'] + calc['pf_employer'] + calc['esi_employer']
            JournalEntryLine.objects.create(
                entry=entry,
                account=self._acct('SALARY_EXPENSE'),
                debit=salary_expense,
            )

            # Credit: Net salary payable (to bank/cash)
            JournalEntryLine.objects.create(
                entry=entry,
                account=self._acct('NET_SALARY_PAYABLE'),
                credit=calc['net_salary'],
            )

            # Credit: PF payable (employee + employer)
            pf_total = calc['pf_employee'] + calc['pf_employer']
            if pf_total > 0:
                JournalEntryLine.objects.create(
                    entry=entry,
                    account=self._acct('PF_PAYABLE'),
                    credit=pf_total,
                )

            # Credit: ESI payable (employee + employer)
            esi_total = calc['esi_employee'] + calc['esi_employer']
            if esi_total > 0:
                JournalEntryLine.objects.create(
                    entry=entry,
                    account=self._acct('ESI_PAYABLE'),
                    credit=esi_total,
                )

            # Credit: Professional Tax payable
            if calc['professional_tax'] > 0:
                JournalEntryLine.objects.create(
                    entry=entry,
                    account=self._acct('PT_PAYABLE'),
                    credit=calc['professional_tax'],
                )

            entry.post()

            run = PayrollRun.objects.create(
                period=period,
                employee=emp,
                journal_entry=entry,
                status='processed',
                location_id=location_id or emp.location_id,
                **calc,
            )
            created.append(run)

        return created

    @transaction.atomic
    def mark_paid(self, payroll_run_id):
        """Mark a payroll run as paid and generate payment journal entry."""
        run = PayrollRun.objects.get(id=payroll_run_id)
        if run.status == 'paid':
            raise ValueError('Already paid')

        # Generate payment entry: Debit Net Salary Payable, Credit Bank
        entry = JournalEntry.objects.create(
            date=run.period + '-28',
            narration=f'Salary payment for {run.period} - {run.employee.name}',
            voucher_type='PAYMENT',
            reference_type='Manual',
            location_id=run.location_id,
        )

        JournalEntryLine.objects.create(
            entry=entry,
            account=self._acct('NET_SALARY_PAYABLE'),
            debit=run.net_salary,
        )
        JournalEntryLine.objects.create(
            entry=entry,
            account=self._acct('BANK'),
            credit=run.net_salary,
        )

        entry.post()
        run.status = 'paid'
        run.save()
        return run

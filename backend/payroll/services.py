import io
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


def generate_payslip_pdf(run: PayrollRun) -> bytes:
    """Single-employee payslip PDF for one PayrollRun."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                    TableStyle)

    from core.models import AccountingSettings
    settings = AccountingSettings.get_settings()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=24, bottomMargin=24,
                            leftMargin=24, rightMargin=24)
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph(f"<b>{settings.company_name or 'Company'}</b>", styles['Title']))
    story.append(Paragraph(f"Salary slip for the month of {run.period}", styles['Heading3']))
    story.append(Spacer(1, 8))
    emp = run.employee
    story.append(Paragraph(
        f"<b>Employee:</b> {emp.name} ({emp.employee_code})<br/>"
        f"<b>PAN:</b> {emp.pan or '-'}<br/>"
        f"<b>Bank A/c:</b> {emp.bank_account_no or '-'} &nbsp;&nbsp; <b>IFSC:</b> {emp.bank_ifsc or '-'}",
        styles['Normal']))
    story.append(Spacer(1, 12))

    earn_data = [['Earnings', 'Amount (INR)']]
    earn_data += [
        ['Basic', f'{run.basic:.2f}'],
        ['HRA', f'{run.hra:.2f}'],
        ['Conveyance', f'{run.conveyance:.2f}'],
        ['Medical', f'{run.medical:.2f}'],
        ['Special Allowance', f'{run.special_allowance:.2f}'],
        ['Gross', f'{run.gross_salary:.2f}'],
    ]
    ded_data = [['Deductions', 'Amount (INR)']]
    ded_data += [
        ['PF (Employee)', f'{run.pf_employee:.2f}'],
        ['ESI (Employee)', f'{run.esi_employee:.2f}'],
        ['Professional Tax', f'{run.professional_tax:.2f}'],
        ['TDS', f'{run.tds:.2f}'],
        ['Total Deductions',
         f'{(run.pf_employee + run.esi_employee + run.professional_tax + run.tds):.2f}'],
    ]

    def styled(data):
        t = Table(data, colWidths=[200, 120])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e5e7eb')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.25, colors.grey),
            ('ALIGN', (1, 1), (1, -1), 'RIGHT'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
        ]))
        return t

    earn_tbl = styled(earn_data)
    ded_tbl = styled(ded_data)
    story.append(Table([[earn_tbl, ded_tbl]], colWidths=[330, 330], hAlign='LEFT'))
    story.append(Spacer(1, 14))

    story.append(Paragraph(
        f"<b>Net Salary:</b> INR {run.net_salary:.2f}",
        styles['Heading3']))
    story.append(Spacer(1, 24))
    story.append(Paragraph(
        '— This is a system-generated payslip and does not require a signature. —',
        styles['Italic']))

    doc.build(story)
    pdf = buf.getvalue()
    buf.close()
    return pdf


def generate_epfo_ecr_file(period: str, location_id: int = None) -> str:
    """
    EPFO ECR (Electronic Challan-cum-Return) file.

    EPFO requires a fixed-column text file for each month with one line per
    employee carrying UAN, name, gross, EPF wages, EPS wages, EPF
    contribution, EPS contribution, EDLI contribution, NCP days, refund.

    Format (per EPFO ECR v2.0): pipe-delimited, no header.
    Columns:
      1. UAN (12 digits)
      2. Member Name (up to 85 chars)
      3. Gross Wages
      4. EPF Wages (capped at ₹15,000 statutory ceiling, unless voluntary)
      5. EPS Wages (capped at ₹15,000)
      6. EDLI Wages (capped at ₹15,000)
      7. EPF Contribution (employee 12% of EPF wages)
      8. EPS Contribution (employer 8.33% of EPS wages, max ₹1,250)
      9. EPF Employer Share (employer 3.67% of EPF wages = 12% - 8.33%)
     10. NCP Days (Non-Contributory Period — typically 0)
     11. Refund of Advances (typically 0)
    """
    runs = PayrollRun.objects.filter(period=period, status__in=('processed', 'paid'))
    if location_id:
        runs = runs.filter(location_id=location_id)
    runs = runs.select_related('employee').order_by('employee__employee_code')

    EPF_CEILING = Decimal('15000')
    lines = []
    for run in runs:
        emp = run.employee
        uan = (getattr(emp, 'uan', '') or '').strip() or '0' * 12
        name = (emp.name or '').upper().replace('|', ' ')[:85]
        epf_wages = min(run.basic, EPF_CEILING)
        eps_wages = min(run.basic, EPF_CEILING)
        edli_wages = epf_wages
        # EPS = 8.33% of eps_wages, capped at ₹1,250
        eps_contrib = min(
            (eps_wages * Decimal('8.33') / Decimal('100')).quantize(Decimal('1')),
            Decimal('1250'),
        )
        # Employer EPF share = total employer (12%) - EPS (8.33%) = 3.67%
        employer_total = (epf_wages * Decimal('12') / Decimal('100')).quantize(Decimal('1'))
        employer_epf_share = employer_total - eps_contrib

        lines.append('#~#'.join([
            uan, name,
            str(int(run.gross_salary)),
            str(int(epf_wages)),
            str(int(eps_wages)),
            str(int(edli_wages)),
            str(int(run.pf_employee)),
            str(int(eps_contrib)),
            str(int(employer_epf_share)),
            '0', '0',
        ]))
    return '\n'.join(lines) + '\n'


def generate_esi_contribution_file(period: str, location_id: int = None) -> str:
    """
    ESIC contribution upload file (CSV).

    Required columns per ESIC online return:
      Insurance Number (IP), Name, Number of Days, Total Wages, Reason Code, Last Working Day
    """
    import io
    import csv

    runs = PayrollRun.objects.filter(period=period, status__in=('processed', 'paid'))
    if location_id:
        runs = runs.filter(location_id=location_id)
    runs = runs.select_related('employee').order_by('employee__employee_code')

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(['IP Number', 'IP Name', 'No of Days', 'Total Monthly Wages',
                'Reason Code', 'Last Working Day'])
    for r in runs:
        emp = r.employee
        # Reason code blank when employee continues; '2' = ceased to be employee
        reason = '2' if emp.date_of_leaving else ''
        last_day = emp.date_of_leaving.isoformat() if emp.date_of_leaving else ''
        w.writerow([
            getattr(emp, 'esi_number', ''),
            emp.name,
            30,  # default 30 days; should account for LOP in production
            str(r.gross_salary),
            reason, last_day,
        ])
    return out.getvalue()


def generate_bank_disbursement_file(period: str, location_id: int = None,
                                    file_format: str = 'csv') -> str:
    """
    Bulk salary credit file. `csv` is the most universally accepted format
    (HDFC/ICICI/SBI corporate-net all accept "amount/account/IFSC/name" CSVs).
    """
    runs = PayrollRun.objects.filter(period=period, status__in=('processed', 'paid'))
    if location_id:
        runs = runs.filter(location_id=location_id)
    runs = runs.select_related('employee').order_by('employee__employee_code')

    if file_format == 'csv':
        import csv
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(['Sr. No.', 'Beneficiary Name', 'Account No.', 'IFSC',
                    'Amount (INR)', 'Pay Date', 'Reference'])
        for i, r in enumerate(runs, start=1):
            emp = r.employee
            w.writerow([
                i, emp.name, emp.bank_account_no or '', emp.bank_ifsc or '',
                f'{r.net_salary:.2f}', f'{period}-28', f'SAL-{period}-{emp.employee_code}',
            ])
        return out.getvalue()

    # Fixed-width fallback (NEFT/RTGS-style)
    if file_format == 'fixed':
        lines = []
        for r in runs:
            emp = r.employee
            lines.append(
                f'{(emp.name or "")[:40]:40}'
                f'{(emp.bank_account_no or "")[:20]:20}'
                f'{(emp.bank_ifsc or "")[:11]:11}'
                f'{int(r.net_salary * 100):015d}'  # paise
                f'{period}-28'
            )
        return '\n'.join(lines) + '\n'

    raise ValueError(f'Unsupported file_format: {file_format}')

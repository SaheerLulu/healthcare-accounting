from django.db import models
from decimal import Decimal


class Employee(models.Model):
    employee_code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=255)
    pan = models.CharField(max_length=10, blank=True)
    bank_account_no = models.CharField(max_length=30, blank=True)
    bank_ifsc = models.CharField(max_length=11, blank=True)
    date_of_joining = models.DateField()
    date_of_leaving = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    location_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['employee_code']

    def __str__(self):
        return f"{self.employee_code} - {self.name}"


class SalaryStructure(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='salary_structures')
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    hra = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    conveyance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    medical = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    special_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    pf_employee_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('12.00'),
                                          help_text='Employee PF contribution %')
    pf_employer_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('12.00'),
                                          help_text='Employer PF contribution %')
    esi_employee_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    esi_employer_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    professional_tax = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    effective_from = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-effective_from']

    def __str__(self):
        return f"Structure for {self.employee} from {self.effective_from}"

    @property
    def gross_salary(self):
        return self.basic_salary + self.hra + self.conveyance + self.medical + self.special_allowance


class PayrollRun(models.Model):
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('processed', 'Processed'),
        ('paid', 'Paid'),
    ]

    period = models.CharField(max_length=7, help_text='YYYY-MM')
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='payroll_runs')
    gross_salary = models.DecimalField(max_digits=12, decimal_places=2)
    basic = models.DecimalField(max_digits=12, decimal_places=2)
    hra = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    conveyance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    medical = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    special_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    pf_employee = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    pf_employer = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    esi_employee = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    esi_employer = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    professional_tax = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tds = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    net_salary = models.DecimalField(max_digits=12, decimal_places=2)
    journal_entry = models.ForeignKey(
        'journals.JournalEntry', on_delete=models.SET_NULL, null=True, blank=True
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    location_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['period', 'employee']
        ordering = ['-period', 'employee__name']

    def __str__(self):
        return f"Payroll {self.period} - {self.employee.name}"

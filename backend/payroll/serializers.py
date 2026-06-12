from rest_framework import serializers
from .models import Employee, SalaryStructure, PayrollRun


class EmployeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        # Explicit list (not '__all__') so newly added model fields never
        # become writable by accident on this writable viewset.
        fields = [
            'id', 'employee_code', 'name', 'pan',
            'bank_account_no', 'bank_ifsc',
            'date_of_joining', 'date_of_leaving', 'is_active',
            'location_id', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class SalaryStructureSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    gross_salary = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = SalaryStructure
        fields = [
            'id', 'employee', 'employee_name',
            'basic_salary', 'hra', 'conveyance', 'medical', 'special_allowance',
            'gross_salary',
            'pf_employee_pct', 'pf_employer_pct',
            'esi_employee_pct', 'esi_employer_pct',
            'professional_tax',
            'effective_from', 'is_active', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class PayrollRunSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_code', read_only=True)
    journal_entry_no = serializers.CharField(source='journal_entry.entry_no', read_only=True, default=None)

    class Meta:
        model = PayrollRun
        fields = [
            'id', 'period', 'employee', 'employee_name', 'employee_code',
            'gross_salary', 'basic', 'hra', 'conveyance', 'medical',
            'special_allowance',
            'pf_employee', 'pf_employer', 'esi_employee', 'esi_employer',
            'professional_tax', 'tds', 'net_salary',
            'journal_entry', 'journal_entry_no', 'status',
            'location_id', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

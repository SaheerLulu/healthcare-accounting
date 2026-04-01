from rest_framework import serializers
from .models import Employee, SalaryStructure, PayrollRun


class EmployeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']


class SalaryStructureSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    gross_salary = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = SalaryStructure
        fields = '__all__'
        read_only_fields = ['id', 'created_at']


class PayrollRunSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_code', read_only=True)
    journal_entry_no = serializers.CharField(source='journal_entry.entry_no', read_only=True, default=None)

    class Meta:
        model = PayrollRun
        fields = '__all__'
        read_only_fields = ['id', 'created_at']

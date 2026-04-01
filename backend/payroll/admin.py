from django.contrib import admin
from .models import Employee, SalaryStructure, PayrollRun

admin.site.register(Employee)
admin.site.register(SalaryStructure)
admin.site.register(PayrollRun)

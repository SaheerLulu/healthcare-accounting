import re

from rest_framework import serializers

from .models import Budget


class BudgetSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source='account.account_code', read_only=True)
    account_name = serializers.CharField(source='account.account_name', read_only=True)

    # Must match what services._period_dates() can parse — anything else
    # crashes the variance report at read time (L8).
    PERIOD_FORMATS = {
        'monthly': (r'\d{4}-(0[1-9]|1[0-2])', 'YYYY-MM (e.g. 2026-04)'),
        'quarterly': (r'\d{4}-Q[1-4]', 'YYYY-Qn (e.g. 2026-Q1)'),
        'annual': (r'\d{4}(-\d{2})?', "YYYY or FY label YYYY-YY (e.g. 2026 or 2026-27)"),
    }

    class Meta:
        model = Budget
        fields = ['id', 'period_kind', 'period', 'account', 'account_code',
                  'account_name', 'cost_center', 'location_id', 'amount', 'notes',
                  'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, data):
        kind = data.get(
            'period_kind',
            self.instance.period_kind if self.instance else 'monthly')
        period = data.get(
            'period', self.instance.period if self.instance else '')
        pattern, example = self.PERIOD_FORMATS[kind]
        if not re.fullmatch(pattern, period or ''):
            raise serializers.ValidationError({
                'period': f'A {kind} budget period must be {example}.',
            })
        if kind == 'annual' and '-' in (period or ''):
            start, suffix = period.split('-', 1)
            if int(suffix) != (int(start) + 1) % 100:
                raise serializers.ValidationError({
                    'period': f'FY label should be '
                              f'{start}-{(int(start) + 1) % 100:02d}.',
                })
        return data

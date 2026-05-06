from rest_framework import serializers

from .models import Budget


class BudgetSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source='account.account_code', read_only=True)
    account_name = serializers.CharField(source='account.account_name', read_only=True)

    class Meta:
        model = Budget
        fields = ['id', 'period_kind', 'period', 'account', 'account_code',
                  'account_name', 'cost_center', 'location_id', 'amount', 'notes',
                  'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

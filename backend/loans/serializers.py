from rest_framework import serializers

from .models import EMISchedule, Loan


class EMIScheduleSerializer(serializers.ModelSerializer):
    total_emi = serializers.SerializerMethodField()
    entry_no = serializers.CharField(source='journal_entry.entry_no',
                                     read_only=True, default=None)

    class Meta:
        model = EMISchedule
        fields = ['id', 'loan', 'installment_no', 'due_date',
                  'principal', 'interest', 'total_emi', 'balance_principal',
                  'status', 'paid_date', 'journal_entry', 'entry_no']
        read_only_fields = ['id', 'total_emi', 'journal_entry']

    def get_total_emi(self, obj):
        return str(obj.total_emi)


class LoanSerializer(serializers.ModelSerializer):
    outstanding_principal = serializers.SerializerMethodField()
    disbursement_entry_no = serializers.CharField(
        source='disbursement_journal_entry.entry_no', read_only=True, default=None,
    )
    liability_account_code = serializers.CharField(
        source='liability_account.account_code', read_only=True,
    )
    interest_expense_account_code = serializers.CharField(
        source='interest_expense_account.account_code', read_only=True,
    )

    class Meta:
        model = Loan
        fields = [
            'id', 'loan_no', 'lender_name', 'lender_id', 'loan_type',
            'principal_amount', 'interest_rate_pct', 'tenure_months',
            'start_date', 'end_date', 'emi_day', 'emi_amount',
            'location_id', 'notes', 'status',
            'liability_account', 'liability_account_code',
            'interest_expense_account', 'interest_expense_account_code',
            'disbursement_journal_entry', 'disbursement_entry_no',
            'outstanding_principal',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'emi_amount', 'end_date', 'status',
                            'disbursement_journal_entry',
                            'created_at', 'updated_at']

    def validate_liability_account(self, account):
        # The disbursement credits this account and every EMI's principal debits
        # it. The UI used free-text GL-ID inputs, so a transposed/wrong id booked
        # loan principal into a revenue/expense account for the life of the loan.
        if account.account_type != 'LIABILITY':
            raise serializers.ValidationError(
                f'Loan liability account must be a LIABILITY account, not {account.account_type}.'
            )
        if not account.is_leaf:
            raise serializers.ValidationError('Loan liability account must be a leaf account.')
        return account

    def validate_interest_expense_account(self, account):
        if account.account_type != 'EXPENSE':
            raise serializers.ValidationError(
                f'Interest expense account must be an EXPENSE account, not {account.account_type}.'
            )
        if not account.is_leaf:
            raise serializers.ValidationError('Interest expense account must be a leaf account.')
        return account

    def get_outstanding_principal(self, obj):
        return str(obj.outstanding_principal)

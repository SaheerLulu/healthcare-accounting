from rest_framework import serializers
from .models import BankAccount, BankTransaction


class BankAccountSerializer(serializers.ModelSerializer):
    chart_account_code = serializers.CharField(source='chart_account.account_code', read_only=True)
    chart_account_name = serializers.CharField(source='chart_account.account_name', read_only=True)
    book_balance = serializers.SerializerMethodField()
    statement_balance = serializers.SerializerMethodField()
    unmatched_count = serializers.SerializerMethodField()

    class Meta:
        model = BankAccount
        fields = [
            'id', 'name', 'account_type', 'bank_name', 'account_number', 'ifsc',
            'currency', 'chart_account', 'chart_account_code', 'chart_account_name',
            'opening_balance', 'opening_date', 'is_active', 'notes', 'location_id',
            'book_balance', 'statement_balance', 'unmatched_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'chart_account_code', 'chart_account_name',
            'book_balance', 'statement_balance', 'unmatched_count',
            'created_at', 'updated_at',
        ]

    def get_book_balance(self, obj):
        from . import services
        return str(services.book_balance(obj))

    def get_statement_balance(self, obj):
        from . import services
        return str(services.statement_balance(obj))

    def get_unmatched_count(self, obj):
        return obj.transactions.filter(status='unmatched').count()


class BankTransactionSerializer(serializers.ModelSerializer):
    matched_entry_no = serializers.CharField(source='matched_journal_entry.entry_no',
                                             read_only=True, default=None)
    matched_entry_voucher = serializers.CharField(source='matched_journal_entry.voucher_type',
                                                  read_only=True, default=None)
    matched_entry_narration = serializers.CharField(source='matched_journal_entry.narration',
                                                    read_only=True, default=None)
    abs_amount = serializers.SerializerMethodField()
    direction = serializers.CharField(read_only=True)
    bank_account_name = serializers.CharField(source='bank_account.name', read_only=True)

    class Meta:
        model = BankTransaction
        fields = [
            'id', 'bank_account', 'bank_account_name', 'date', 'value_date',
            'description', 'reference', 'amount', 'abs_amount', 'direction',
            'running_balance', 'status', 'source',
            'matched_journal_entry', 'matched_entry_no', 'matched_entry_voucher',
            'matched_entry_narration', 'notes',
            'imported_at', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'bank_account_name', 'matched_journal_entry', 'matched_entry_no',
            'matched_entry_voucher', 'matched_entry_narration', 'status', 'direction',
            'abs_amount', 'imported_at', 'created_at', 'updated_at',
        ]

    def get_abs_amount(self, obj):
        return str(obj.abs_amount)


class CategorizePayloadSerializer(serializers.Serializer):
    account_id = serializers.IntegerField()
    party_type = serializers.ChoiceField(choices=['Customer', 'Supplier', ''], required=False, allow_blank=True, default='')
    party_id = serializers.IntegerField(required=False, allow_null=True)
    narration = serializers.CharField(required=False, allow_blank=True, default='')


class MatchPayloadSerializer(serializers.Serializer):
    journal_entry_id = serializers.IntegerField()

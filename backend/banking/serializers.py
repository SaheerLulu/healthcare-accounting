from rest_framework import serializers
from .models import BankAccount, BankTransaction, Cheque, PettyCashFloat, PettyCashTransaction


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


class ChequeSerializer(serializers.ModelSerializer):
    bank_account_name = serializers.CharField(source='bank_account.name', read_only=True)
    is_pdc = serializers.BooleanField(read_only=True)
    entry_no = serializers.CharField(source='journal_entry.entry_no',
                                     read_only=True, default=None)
    bounce_entry_no = serializers.CharField(source='bounce_journal_entry.entry_no',
                                            read_only=True, default=None)

    class Meta:
        model = Cheque
        fields = [
            'id', 'cheque_no', 'kind', 'bank_account', 'bank_account_name',
            'cheque_date', 'expected_clear_date', 'amount',
            'party_type', 'party_id', 'party_name',
            'status', 'bounce_reason', 'bounce_charge', 'is_pdc',
            'journal_entry', 'entry_no',
            'bounce_journal_entry', 'bounce_entry_no',
            'bill_payment', 'notes', 'location_id',
            'created_at', 'updated_at',
        ]
        # journal_entry / bill_payment are read-only: the cheque register tracks
        # paper instruments and these links are set only by the trusted service
        # that posts the original entry. Letting an API client set journal_entry
        # allowed attaching an arbitrary unrelated posted JE and then 'bouncing'
        # the cheque to reverse books that have nothing to do with it.
        read_only_fields = ['id', 'status', 'bounce_reason', 'bounce_charge',
                            'journal_entry', 'entry_no', 'bill_payment',
                            'bounce_journal_entry', 'bounce_entry_no',
                            'created_at', 'updated_at']


class PettyCashFloatSerializer(serializers.ModelSerializer):
    chart_account_code = serializers.CharField(source='chart_account.account_code', read_only=True)
    current_balance = serializers.SerializerMethodField()
    needs_replenishment = serializers.SerializerMethodField()

    class Meta:
        model = PettyCashFloat
        fields = ['id', 'location_id', 'location_name',
                  'chart_account', 'chart_account_code',
                  'imprest_amount', 'replenishment_threshold',
                  'is_active', 'custodian_name',
                  'current_balance', 'needs_replenishment',
                  'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_current_balance(self, obj):
        from .services import petty_cash_balance
        return str(petty_cash_balance(obj))

    def get_needs_replenishment(self, obj):
        from .services import petty_cash_balance
        return petty_cash_balance(obj) < (obj.replenishment_threshold or 0)


class PettyCashTransactionSerializer(serializers.ModelSerializer):
    expense_account_code = serializers.CharField(source='expense_account.account_code', read_only=True)
    entry_no = serializers.CharField(source='journal_entry.entry_no', read_only=True, default=None)

    class Meta:
        model = PettyCashTransaction
        fields = ['id', 'float', 'date', 'kind', 'amount',
                  'expense_account', 'expense_account_code',
                  'description', 'voucher_no',
                  'journal_entry', 'entry_no', 'created_at']
        read_only_fields = ['id', 'kind', 'journal_entry', 'created_at']

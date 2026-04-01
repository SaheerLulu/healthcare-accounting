from rest_framework import serializers
from decimal import Decimal
from .models import JournalEntry, JournalEntryLine


class JournalEntryLineSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source='account.account_name', read_only=True)
    account_code = serializers.CharField(source='account.account_code', read_only=True)

    class Meta:
        model = JournalEntryLine
        fields = [
            'id',
            'entry',
            'account',
            'account_name',
            'account_code',
            'debit',
            'credit',
            'narration',
            'party_type',
            'party_id',
        ]
        read_only_fields = ['id']


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalEntryLineSerializer(many=True, read_only=True)
    created_by_name = serializers.SerializerMethodField()
    voucher_type_display = serializers.CharField(source='get_voucher_type_display', read_only=True)
    reference_type_display = serializers.CharField(source='get_reference_type_display', read_only=True)

    class Meta:
        model = JournalEntry
        fields = [
            'id',
            'entry_no',
            'date',
            'narration',
            'voucher_type',
            'voucher_type_display',
            'reference_type',
            'reference_type_display',
            'reference_id',
            'is_posted',
            'location_id',
            'created_at',
            'created_by',
            'created_by_name',
            'lines',
        ]
        read_only_fields = ['id', 'entry_no', 'created_at', 'is_posted']

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None


class JournalEntryLineCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = JournalEntryLine
        fields = [
            'account',
            'debit',
            'credit',
            'narration',
            'party_type',
            'party_id',
        ]

    def validate(self, data):
        debit = data.get('debit', 0)
        credit = data.get('credit', 0)
        if debit < 0 or credit < 0:
            raise serializers.ValidationError('Debit and Credit must be non-negative.')
        if debit > 0 and credit > 0:
            raise serializers.ValidationError('A line cannot have both debit and credit.')
        return data


class JournalEntryCreateSerializer(serializers.ModelSerializer):
    lines = JournalEntryLineCreateSerializer(many=True)

    class Meta:
        model = JournalEntry
        fields = [
            'id',
            'entry_no',
            'date',
            'narration',
            'voucher_type',
            'reference_type',
            'reference_id',
            'location_id',
            'lines',
        ]
        read_only_fields = ['id', 'entry_no']

    def validate(self, data):
        lines = data.get('lines', [])
        if not lines:
            raise serializers.ValidationError('At least one journal line is required.')

        total_debit = sum(line.get('debit', 0) for line in lines)
        total_credit = sum(line.get('credit', 0) for line in lines)
        if total_debit != total_credit:
            raise serializers.ValidationError(
                f'Journal entry is unbalanced: Debit={total_debit}, Credit={total_credit}'
            )
        return data

    def create(self, validated_data):
        lines_data = validated_data.pop('lines')
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['created_by'] = request.user

        entry = JournalEntry.objects.create(**validated_data)
        for line_data in lines_data:
            JournalEntryLine.objects.create(entry=entry, **line_data)
        return entry


# ─── Voucher Serializers ─────────────────────────────────────────────────────

class PaymentVoucherSerializer(serializers.Serializer):
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    party_id = serializers.IntegerField(required=False, allow_null=True)
    payment_mode = serializers.ChoiceField(choices=['bank', 'cash'], default='bank')
    narration = serializers.CharField(required=False, allow_blank=True, default='Payment')
    location_id = serializers.IntegerField(required=False, allow_null=True)


class ReceiptVoucherSerializer(serializers.Serializer):
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    party_id = serializers.IntegerField(required=False, allow_null=True)
    receipt_mode = serializers.ChoiceField(choices=['bank', 'cash'], default='bank')
    narration = serializers.CharField(required=False, allow_blank=True, default='Receipt')
    location_id = serializers.IntegerField(required=False, allow_null=True)


class ContraVoucherSerializer(serializers.Serializer):
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    direction = serializers.ChoiceField(choices=['bank_to_cash', 'cash_to_bank'], default='bank_to_cash')
    narration = serializers.CharField(required=False, allow_blank=True, default='Contra Entry')
    location_id = serializers.IntegerField(required=False, allow_null=True)

from rest_framework import serializers
from decimal import Decimal
from .models import (
    JournalEntry, JournalEntryLine, RecurringJournal, RecurringJournalLine,
    BillReference, VoucherTypeProfile,
)


class BillReferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillReference
        fields = [
            'id', 'line', 'kind', 'ref_no', 'ref_date',
            'amount', 'bill_id', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class JournalEntryLineSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source='account.account_name', read_only=True)
    account_code = serializers.CharField(source='account.account_code', read_only=True)
    bill_references = BillReferenceSerializer(many=True, read_only=True)

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
            'bill_references',
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
            'voucher_type_profile',
            'reference_type',
            'reference_type_display',
            'reference_id',
            'is_posted',
            'is_optional',
            'is_memorandum',
            'reversal_date',
            'auto_reversed',
            'location_id',
            'cost_center',
            'cost_centre',
            'created_at',
            'created_by',
            'created_by_name',
            'lines',
        ]
        read_only_fields = ['id', 'entry_no', 'created_at', 'is_posted', 'auto_reversed']

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
    location_id = serializers.IntegerField(required=True, allow_null=False)

    class Meta:
        model = JournalEntry
        fields = [
            'id',
            'entry_no',
            'date',
            'narration',
            'voucher_type',
            'voucher_type_profile',
            'reference_type',
            'reference_id',
            'location_id',
            'cost_center',
            'cost_centre',
            'is_optional',
            'is_memorandum',
            'reversal_date',
            'lines',
        ]
        read_only_fields = ['id', 'entry_no']

    PARTY_REQUIRED_SUBTYPES = ('Receivable', 'Payable')

    def validate(self, data):
        lines = data.get('lines', [])
        # AC WP 615: at least 2 lines (one debit, one credit).
        if len(lines) < 2:
            raise serializers.ValidationError(
                'A journal entry needs at least two lines (one debit, one credit).'
            )

        # Sum to paisa precision and compare exactly — no float drift.
        total_debit = sum((Decimal(str(l.get('debit', 0))) for l in lines), Decimal('0.00'))
        total_credit = sum((Decimal(str(l.get('credit', 0))) for l in lines), Decimal('0.00'))
        if total_debit != total_credit:
            raise serializers.ValidationError(
                f'Journal entry is unbalanced: Debit={total_debit}, Credit={total_credit}'
            )
        if total_debit == 0:
            raise serializers.ValidationError('Journal entry total cannot be zero.')

        line_errors = {}
        for idx, line in enumerate(lines):
            account = line.get('account')
            # Posting to a non-leaf account would silently fall out of the P&L
            # (which sums leaf accounts only) while still affecting the Balance
            # Sheet's net-income calc — the two reports would no longer tie.
            if account is not None and not getattr(account, 'is_leaf', True):
                line_errors[idx] = (
                    f'Cannot post to non-leaf account {account.account_code} '
                    f'{account.account_name} (line {idx + 1}). Post to a leaf account.'
                )
                continue
            subtype = getattr(account, 'account_subtype', None)
            if subtype in self.PARTY_REQUIRED_SUBTYPES:
                if not line.get('party_type') or not line.get('party_id'):
                    line_errors[idx] = (
                        f'party_type and party_id are required for '
                        f'{subtype} accounts (line {idx + 1}).'
                    )
        if line_errors:
            raise serializers.ValidationError({'lines': line_errors})

        # Period lock check — surfaces a clean 400 with the offending date.
        from core.period_lock import assert_unlocked, PeriodLockedError
        try:
            assert_unlocked(data.get('date'))
        except PeriodLockedError as exc:
            raise serializers.ValidationError({'date': str(exc)})

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

    def update(self, instance, validated_data):
        if instance.is_posted:
            raise serializers.ValidationError('Cannot edit a posted journal entry.')
        lines_data = validated_data.pop('lines', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if lines_data is not None:
            instance.lines.all().delete()
            for line_data in lines_data:
                JournalEntryLine.objects.create(entry=instance, **line_data)
        return instance


# ─── Voucher Serializers ─────────────────────────────────────────────────────

class PaymentVoucherSerializer(serializers.Serializer):
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    party_id = serializers.IntegerField(required=False, allow_null=True)
    payment_mode = serializers.ChoiceField(choices=['bank', 'cash'], default='bank')
    narration = serializers.CharField(required=False, allow_blank=True, default='Payment')
    location_id = serializers.IntegerField(required=True, allow_null=False)


class ReceiptVoucherSerializer(serializers.Serializer):
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    party_id = serializers.IntegerField(required=False, allow_null=True)
    receipt_mode = serializers.ChoiceField(choices=['bank', 'cash'], default='bank')
    narration = serializers.CharField(required=False, allow_blank=True, default='Receipt')
    location_id = serializers.IntegerField(required=True, allow_null=False)


class ContraVoucherSerializer(serializers.Serializer):
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    direction = serializers.ChoiceField(choices=['bank_to_cash', 'cash_to_bank'], default='bank_to_cash')
    narration = serializers.CharField(required=False, allow_blank=True, default='Contra Entry')
    location_id = serializers.IntegerField(required=True, allow_null=False)


# ─── Recurring journals ─────────────────────────────────────────────────────

class RecurringJournalLineReadSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source='account.account_code', read_only=True)
    account_name = serializers.CharField(source='account.account_name', read_only=True)

    class Meta:
        model = RecurringJournalLine
        fields = ['id', 'account', 'account_code', 'account_name',
                  'debit', 'credit', 'narration', 'party_type', 'party_id']


class RecurringJournalLineWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecurringJournalLine
        fields = ['account', 'debit', 'credit', 'narration', 'party_type', 'party_id']

    def validate(self, data):
        debit = data.get('debit', 0)
        credit = data.get('credit', 0)
        if debit < 0 or credit < 0:
            raise serializers.ValidationError('Debit/Credit must be non-negative.')
        if debit > 0 and credit > 0:
            raise serializers.ValidationError('A line cannot have both debit and credit.')
        return data


class RecurringJournalReadSerializer(serializers.ModelSerializer):
    lines = RecurringJournalLineReadSerializer(many=True, read_only=True)
    voucher_type_display = serializers.CharField(source='get_voucher_type_display', read_only=True)
    generated_count = serializers.SerializerMethodField()
    generated_recent = serializers.SerializerMethodField()
    total_debit = serializers.SerializerMethodField()
    total_credit = serializers.SerializerMethodField()
    is_balanced = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = RecurringJournal
        fields = [
            'id', 'profile_name', 'voucher_type', 'voucher_type_display',
            'narration_template', 'location_id',
            'frequency', 'start_date', 'end_date', 'next_run_date', 'last_run_date',
            'auto_post', 'status', 'last_error',
            'lines', 'total_debit', 'total_credit', 'is_balanced',
            'generated_count', 'generated_recent',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]
        read_only_fields = [
            'id', 'voucher_type_display', 'next_run_date', 'last_run_date',
            'status', 'last_error', 'lines',
            'total_debit', 'total_credit', 'is_balanced',
            'generated_count', 'generated_recent',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]

    def get_generated_count(self, obj):
        return JournalEntry.objects.filter(
            narration__icontains=f'recurring-journal:{obj.id}'
        ).count()

    def get_generated_recent(self, obj):
        # Lighter approach: find by voucher_type + date range + narration prefix.
        # Falls back to scanning recent entries created via this profile.
        # Since we don't currently embed a recurring_id token in narration,
        # match by profile_name as a heuristic.
        qs = JournalEntry.objects.filter(narration__icontains=obj.profile_name) \
            .order_by('-date', '-id')[:5]
        return [{
            'id': e.id, 'entry_no': e.entry_no, 'date': e.date,
            'is_posted': e.is_posted,
        } for e in qs]

    def get_total_debit(self, obj):
        return str(sum((l.debit for l in obj.lines.all()), Decimal('0.00')))

    def get_total_credit(self, obj):
        return str(sum((l.credit for l in obj.lines.all()), Decimal('0.00')))

    def get_is_balanced(self, obj):
        dr = sum((l.debit for l in obj.lines.all()), Decimal('0.00'))
        cr = sum((l.credit for l in obj.lines.all()), Decimal('0.00'))
        return dr == cr and dr > 0

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None


class RecurringJournalWriteSerializer(serializers.ModelSerializer):
    lines = RecurringJournalLineWriteSerializer(many=True)

    class Meta:
        model = RecurringJournal
        fields = [
            'id', 'profile_name', 'voucher_type', 'narration_template', 'location_id',
            'frequency', 'start_date', 'end_date', 'next_run_date',
            'auto_post', 'lines',
        ]
        read_only_fields = ['id']
        extra_kwargs = {'next_run_date': {'required': False}}

    def validate(self, data):
        lines = data.get('lines') or []
        if len(lines) < 2:
            raise serializers.ValidationError('At least two lines are required.')
        total_dr = sum(l.get('debit', 0) for l in lines)
        total_cr = sum(l.get('credit', 0) for l in lines)
        if total_dr != total_cr or total_dr == 0:
            raise serializers.ValidationError(
                f'Template must balance: Dr {total_dr} != Cr {total_cr}.'
            )
        if not data.get('next_run_date'):
            data['next_run_date'] = data['start_date']
        if data.get('end_date') and data['end_date'] < data['start_date']:
            raise serializers.ValidationError('End date cannot be before start date.')
        return data

    def create(self, validated_data):
        lines = validated_data.pop('lines')
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        rj = RecurringJournal.objects.create(**validated_data)
        for l in lines:
            RecurringJournalLine.objects.create(recurring_journal=rj, **l)
        return rj

    def update(self, instance, validated_data):
        lines = validated_data.pop('lines', None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if lines is not None:
            instance.lines.all().delete()
            for l in lines:
                RecurringJournalLine.objects.create(recurring_journal=instance, **l)
        return instance


class VoucherTypeProfileSerializer(serializers.ModelSerializer):
    base_type_display = serializers.CharField(source='get_base_type_display', read_only=True)

    class Meta:
        model = VoucherTypeProfile
        fields = [
            'id', 'name', 'base_type', 'base_type_display',
            'prefix', 'numbering_method', 'restart_yearly',
            'default_narration', 'is_active',
        ]

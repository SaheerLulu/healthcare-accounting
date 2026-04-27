from decimal import Decimal
from rest_framework import serializers
from .models import Bill, BillLine, BillPayment, BillAttachment, RecurringBill, RecurringBillItem


class BillLineReadSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source='account.account_code', read_only=True)
    account_name = serializers.CharField(source='account.account_name', read_only=True)

    class Meta:
        model = BillLine
        fields = ['id', 'account', 'account_code', 'account_name', 'description', 'amount']


class BillLineWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillLine
        fields = ['account', 'description', 'amount']


class BillPaymentSerializer(serializers.ModelSerializer):
    journal_entry_no = serializers.CharField(source='journal_entry.entry_no', read_only=True, default=None)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = BillPayment
        fields = [
            'id', 'bill', 'date', 'amount', 'mode', 'reference', 'notes',
            'journal_entry', 'journal_entry_no',
            'created_at', 'created_by', 'created_by_name',
        ]
        read_only_fields = ['id', 'bill', 'journal_entry', 'journal_entry_no',
                            'created_at', 'created_by', 'created_by_name']

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None


class BillAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = BillAttachment
        fields = [
            'id', 'bill', 'file', 'file_url', 'original_name',
            'content_type', 'size', 'uploaded_at',
            'uploaded_by', 'uploaded_by_name',
        ]
        read_only_fields = [
            'id', 'bill', 'file_url', 'original_name', 'content_type', 'size',
            'uploaded_at', 'uploaded_by', 'uploaded_by_name',
        ]
        extra_kwargs = {
            'file': {'write_only': True, 'required': True},
        }

    def get_file_url(self, obj):
        if not obj.file:
            return None
        request = self.context.get('request')
        url = obj.file.url
        return request.build_absolute_uri(url) if request else url

    def get_uploaded_by_name(self, obj):
        if obj.uploaded_by:
            return obj.uploaded_by.get_full_name() or obj.uploaded_by.username
        return None


class BillReadSerializer(serializers.ModelSerializer):
    lines = BillLineReadSerializer(many=True, read_only=True)
    payments = BillPaymentSerializer(many=True, read_only=True)
    attachments = BillAttachmentSerializer(many=True, read_only=True)
    journal_entry_no = serializers.CharField(source='journal_entry.entry_no', read_only=True, default=None)
    balance_due = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Bill
        fields = [
            'id', 'bill_no', 'bill_date', 'due_date',
            'vendor_id', 'vendor_name',
            'subtotal', 'tax_cgst', 'tax_sgst', 'tax_igst',
            'total_amount', 'amount_paid', 'balance_due',
            'status', 'notes', 'location_id',
            'journal_entry', 'journal_entry_no',
            'lines', 'payments', 'attachments',
            'created_at', 'updated_at',
            'created_by', 'created_by_name',
        ]
        read_only_fields = [
            'id', 'amount_paid', 'status', 'journal_entry', 'journal_entry_no',
            'lines', 'payments', 'attachments',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None


class BillWriteSerializer(serializers.ModelSerializer):
    lines = BillLineWriteSerializer(many=True)

    class Meta:
        model = Bill
        fields = [
            'id', 'bill_no', 'bill_date', 'due_date',
            'vendor_id', 'vendor_name',
            'subtotal', 'tax_cgst', 'tax_sgst', 'tax_igst',
            'total_amount', 'notes', 'location_id', 'lines',
        ]
        read_only_fields = ['id']

    def validate(self, data):
        lines = data.get('lines') or []
        if not lines:
            raise serializers.ValidationError('Add at least one line item.')
        for l in lines:
            if l['amount'] <= 0:
                raise serializers.ValidationError('Each line amount must be greater than zero.')
        if data.get('total_amount', 0) <= 0:
            raise serializers.ValidationError('Total amount must be greater than zero.')
        return data

    def create(self, validated_data):
        lines = validated_data.pop('lines')
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        bill = Bill.objects.create(**validated_data)
        for line in lines:
            BillLine.objects.create(bill=bill, **line)
        return bill

    def update(self, instance, validated_data):
        if instance.status not in ('draft',):
            raise serializers.ValidationError('Only draft bills can be edited.')
        lines = validated_data.pop('lines', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if lines is not None:
            instance.lines.all().delete()
            for line in lines:
                BillLine.objects.create(bill=instance, **line)
        return instance


class RecordPaymentSerializer(serializers.Serializer):
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=15, decimal_places=2,
                                      min_value=Decimal('0.01'))
    mode = serializers.ChoiceField(choices=['bank', 'cash'], default='bank')
    reference = serializers.CharField(required=False, allow_blank=True, default='')
    notes = serializers.CharField(required=False, allow_blank=True, default='')


# ─── Recurring bills ────────────────────────────────────────────────────────

class RecurringBillItemReadSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source='account.account_code', read_only=True)
    account_name = serializers.CharField(source='account.account_name', read_only=True)

    class Meta:
        model = RecurringBillItem
        fields = ['id', 'account', 'account_code', 'account_name', 'description', 'amount']


class RecurringBillItemWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecurringBillItem
        fields = ['account', 'description', 'amount']


class RecurringBillReadSerializer(serializers.ModelSerializer):
    items = RecurringBillItemReadSerializer(many=True, read_only=True)
    generated_count = serializers.SerializerMethodField()
    generated_recent = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = RecurringBill
        fields = [
            'id', 'profile_name', 'vendor_id', 'vendor_name',
            'subtotal', 'tax_cgst', 'tax_sgst', 'tax_igst', 'total_amount',
            'notes', 'location_id',
            'frequency', 'start_date', 'end_date', 'next_run_date', 'last_run_date',
            'due_days', 'auto_approve', 'bill_no_pattern',
            'status', 'last_error',
            'items', 'generated_count', 'generated_recent',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]
        read_only_fields = [
            'id', 'next_run_date', 'last_run_date', 'status', 'last_error',
            'items', 'generated_count', 'generated_recent',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]

    def get_generated_count(self, obj):
        return Bill.objects.filter(notes__contains=f'recurring:{obj.id}').count()

    def get_generated_recent(self, obj):
        qs = Bill.objects.filter(notes__contains=f'recurring:{obj.id}') \
            .order_by('-bill_date', '-id')[:5]
        return [{
            'id': b.id, 'bill_no': b.bill_no, 'bill_date': b.bill_date,
            'total_amount': str(b.total_amount), 'status': b.status,
        } for b in qs]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None


class RecurringBillWriteSerializer(serializers.ModelSerializer):
    items = RecurringBillItemWriteSerializer(many=True)

    class Meta:
        model = RecurringBill
        fields = [
            'id', 'profile_name', 'vendor_id', 'vendor_name',
            'subtotal', 'tax_cgst', 'tax_sgst', 'tax_igst', 'total_amount',
            'notes', 'location_id',
            'frequency', 'start_date', 'end_date', 'next_run_date',
            'due_days', 'auto_approve', 'bill_no_pattern',
            'items',
        ]
        read_only_fields = ['id']
        extra_kwargs = {'next_run_date': {'required': False}}

    def validate(self, data):
        items = data.get('items') or []
        if not items:
            raise serializers.ValidationError('Add at least one line item.')
        for it in items:
            if it['amount'] <= 0:
                raise serializers.ValidationError('Each line amount must be > 0.')
        if data.get('total_amount', 0) <= 0:
            raise serializers.ValidationError('Total must be > 0.')
        # default next_run_date = start_date if not provided
        if not data.get('next_run_date'):
            data['next_run_date'] = data['start_date']
        if data.get('end_date') and data['end_date'] < data['start_date']:
            raise serializers.ValidationError('End date cannot be before start date.')
        return data

    def create(self, validated_data):
        items = validated_data.pop('items')
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        rb = RecurringBill.objects.create(**validated_data)
        for it in items:
            RecurringBillItem.objects.create(recurring_bill=rb, **it)
        return rb

    def update(self, instance, validated_data):
        items = validated_data.pop('items', None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if items is not None:
            instance.items.all().delete()
            for it in items:
                RecurringBillItem.objects.create(recurring_bill=instance, **it)
        return instance

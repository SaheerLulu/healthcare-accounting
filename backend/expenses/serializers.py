from rest_framework import serializers
from .models import Expense, ExpenseItem, ExpenseAttachment


class ExpenseItemReadSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source='account.account_code', read_only=True)
    account_name = serializers.CharField(source='account.account_name', read_only=True)

    class Meta:
        model = ExpenseItem
        fields = ['id', 'account', 'account_code', 'account_name', 'description', 'amount']


class ExpenseItemWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseItem
        fields = ['account', 'description', 'amount']


class ExpenseAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseAttachment
        fields = [
            'id', 'expense', 'file', 'file_url', 'original_name',
            'content_type', 'size', 'uploaded_at',
            'uploaded_by', 'uploaded_by_name',
        ]
        read_only_fields = [
            'id', 'expense', 'file_url', 'original_name', 'content_type', 'size',
            'uploaded_at', 'uploaded_by', 'uploaded_by_name',
        ]
        extra_kwargs = {'file': {'write_only': True, 'required': True}}

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


class ExpenseReadSerializer(serializers.ModelSerializer):
    items = ExpenseItemReadSerializer(many=True, read_only=True)
    attachments = ExpenseAttachmentSerializer(many=True, read_only=True)
    journal_entry_no = serializers.CharField(source='journal_entry.entry_no', read_only=True, default=None)
    paid_through_code = serializers.CharField(source='paid_through_account.account_code', read_only=True)
    paid_through_name = serializers.CharField(source='paid_through_account.account_name', read_only=True)
    created_by_name = serializers.SerializerMethodField()
    is_itemized = serializers.SerializerMethodField()

    class Meta:
        model = Expense
        fields = [
            'id', 'expense_date', 'paid_through_account', 'paid_through_code', 'paid_through_name',
            'vendor_name', 'vendor_id', 'reference',
            'subtotal', 'tax_cgst', 'tax_sgst', 'tax_igst', 'total_amount',
            'notes', 'status',
            'journal_entry', 'journal_entry_no', 'location_id',
            'items', 'attachments', 'is_itemized',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]
        read_only_fields = [
            'id', 'status', 'journal_entry', 'journal_entry_no',
            'paid_through_code', 'paid_through_name',
            'items', 'attachments', 'is_itemized',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_is_itemized(self, obj):
        return obj.items.count() > 1


class ExpenseWriteSerializer(serializers.ModelSerializer):
    items = ExpenseItemWriteSerializer(many=True)

    class Meta:
        model = Expense
        fields = [
            'id', 'expense_date', 'paid_through_account',
            'vendor_name', 'vendor_id', 'reference',
            'subtotal', 'tax_cgst', 'tax_sgst', 'tax_igst', 'total_amount',
            'notes', 'location_id', 'items',
        ]
        read_only_fields = ['id']

    def validate(self, data):
        items = data.get('items') or []
        if not items:
            raise serializers.ValidationError('Add at least one expense line.')
        for it in items:
            if it['amount'] <= 0:
                raise serializers.ValidationError('Each line amount must be > 0.')
        if data.get('total_amount', 0) <= 0:
            raise serializers.ValidationError('Total must be > 0.')
        return data

    def create(self, validated_data):
        items = validated_data.pop('items')
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        expense = Expense.objects.create(**validated_data)
        for it in items:
            ExpenseItem.objects.create(expense=expense, **it)
        return expense

    def update(self, instance, validated_data):
        if instance.status != 'draft':
            raise serializers.ValidationError('Only draft expenses can be edited.')
        items = validated_data.pop('items', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items is not None:
            instance.items.all().delete()
            for it in items:
                ExpenseItem.objects.create(expense=instance, **it)
        return instance

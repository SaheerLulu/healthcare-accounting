from decimal import Decimal

from django.db.models import Sum
from rest_framework import serializers
from .models import TDSDeduction, TDSChallan, TDSRateConfig, TCSCollection, Form26ASEntry


class TDSRateConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = TDSRateConfig
        fields = [
            'id', 'section', 'deductee_type', 'rate', 'threshold',
            'fy_start', 'fy_end', 'is_active',
        ]


class TDSDeductionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TDSDeduction
        fields = [
            'id', 'deductee_name', 'deductee_pan', 'section',
            'nature_of_payment', 'transaction_date', 'gross_amount',
            'tds_rate', 'tds_amount', 'deductee_type', 'source_type',
            'source_id', 'status', 'challan_no', 'challan_date',
            'bsr_code', 'location_id', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate(self, data):
        """L1 — manual deductions could carry zero/negative gross, TDS larger
        than the payment itself, or absurd rates; all of it flowed straight
        into challans and 26Q."""
        def _value(field):
            if field in data:
                return data[field]
            return getattr(self.instance, field, None)

        gross = _value('gross_amount')
        tds_amount = _value('tds_amount')
        rate = _value('tds_rate')
        if gross is not None and gross <= 0:
            raise serializers.ValidationError(
                {'gross_amount': 'Gross amount must be greater than zero.'})
        if tds_amount is not None and tds_amount < 0:
            raise serializers.ValidationError(
                {'tds_amount': 'TDS amount cannot be negative.'})
        if tds_amount is not None and gross is not None and tds_amount > gross:
            raise serializers.ValidationError(
                {'tds_amount': 'TDS amount cannot exceed the gross amount.'})
        if rate is not None and not (Decimal('0') <= rate <= Decimal('100')):
            raise serializers.ValidationError(
                {'tds_rate': 'TDS rate must be between 0 and 100.'})
        return data


class TDSChallanSerializer(serializers.ModelSerializer):
    deductions = TDSDeductionSerializer(many=True, read_only=True)
    deduction_ids = serializers.PrimaryKeyRelatedField(
        many=True, queryset=TDSDeduction.objects.all(),
        source='deductions', write_only=True, required=False,
    )

    class Meta:
        model = TDSChallan
        fields = [
            'id', 'challan_no', 'bsr_code', 'deposit_date', 'period',
            'section', 'total_tds_amount', 'location_id', 'deductions',
            'deduction_ids', 'created_at',
        ]
        read_only_fields = ['created_at']

    def create(self, validated_data):
        deductions = validated_data.pop('deductions', [])
        challan = TDSChallan.objects.create(**validated_data)
        if deductions:
            self._link_deductions(challan, deductions)
        return challan

    def update(self, instance, validated_data):
        deductions = validated_data.pop('deductions', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if deductions is not None:
            self._link_deductions(instance, deductions)
        return instance

    @staticmethod
    def _link_deductions(challan, deductions):
        """Link deductions AND mark them challan_paid + stamp the challan ref,
        mirroring auto_generate_challan. Without this the deductions stayed
        'pending', so Auto-Generate would re-pick them into a SECOND challan —
        double-counting the deposited TDS. The total is recomputed from the
        linked deductions rather than trusted from the client."""
        challan.deductions.set(deductions)
        linked = challan.deductions.all()
        linked.update(
            status='challan_paid',
            challan_no=challan.challan_no,
            challan_date=challan.deposit_date,
        )
        total = linked.aggregate(t=Sum('tds_amount'))['t'] or Decimal('0.00')
        if total != challan.total_tds_amount:
            challan.total_tds_amount = total
            challan.save(update_fields=['total_tds_amount'])


class TCSCollectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TCSCollection
        fields = [
            'id', 'buyer_name', 'buyer_pan', 'buyer_id',
            'transaction_date', 'fy_label', 'invoice_no',
            'source_type', 'source_id',
            'sale_amount', 'cumulative_sales_fy', 'taxable_amount',
            'tcs_rate', 'tcs_amount',
            'status', 'challan_no', 'challan_date', 'location_id',
            'journal_entry', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'cumulative_sales_fy',
                            'taxable_amount', 'tcs_amount']


class Form26ASEntrySerializer(serializers.ModelSerializer):
    matched_entry_no = serializers.CharField(
        source='matched_journal_entry.entry_no', read_only=True, default=None,
    )

    class Meta:
        model = Form26ASEntry
        fields = ['id', 'fy_label', 'deductor_tan', 'deductor_name', 'section',
                  'period', 'transaction_date', 'booking_date',
                  'gross_amount', 'tds_amount', 'challan_no', 'challan_bsr',
                  'match_status', 'matched_journal_entry', 'matched_entry_no',
                  'notes', 'location_id', 'created_at']
        read_only_fields = ['id', 'match_status', 'matched_journal_entry',
                            'matched_entry_no', 'created_at']

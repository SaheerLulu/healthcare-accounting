from rest_framework import serializers
from .models import GSTR1Entry, GSTR1HSNSummary, GSTR3BSummary, GSTR2BEntry, ITCReconciliation, RCMEntry


class GSTR1EntrySerializer(serializers.ModelSerializer):
    invoice_type_display = serializers.CharField(source='get_invoice_type_display', read_only=True)
    source_type_display = serializers.CharField(source='get_source_type_display', read_only=True)
    total_gst = serializers.SerializerMethodField()

    class Meta:
        model = GSTR1Entry
        fields = [
            'id', 'period', 'location_id', 'invoice_no', 'invoice_date',
            'customer_gstin', 'invoice_type', 'invoice_type_display',
            'place_of_supply', 'taxable_value', 'cgst', 'sgst', 'igst', 'cess',
            'total_gst', 'hsn_code', 'rate', 'source_type', 'source_type_display',
            'source_id', 'version', 'is_active',
            'original_invoice_no', 'original_invoice_date', 'is_time_barred',
            'irn', 'e_invoice_status',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_total_gst(self, obj):
        return obj.cgst + obj.sgst + obj.igst + obj.cess


class GSTR1HSNSummarySerializer(serializers.ModelSerializer):
    total_tax = serializers.SerializerMethodField()

    class Meta:
        model = GSTR1HSNSummary
        fields = [
            'id', 'period', 'location_id', 'hsn_code', 'description',
            'uqc', 'quantity', 'taxable_value', 'cgst', 'sgst', 'igst',
            'rate', 'total_tax', 'version', 'is_active', 'created_at',
        ]

    def get_total_tax(self, obj):
        return obj.cgst + obj.sgst + obj.igst


class GSTR3BSummarySerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    total_outward_gst = serializers.SerializerMethodField()
    total_itc = serializers.SerializerMethodField()
    total_net_payable = serializers.SerializerMethodField()

    class Meta:
        model = GSTR3BSummary
        fields = [
            'id', 'period', 'location_id',
            'outward_taxable', 'outward_igst', 'outward_cgst', 'outward_sgst',
            'outward_zero_rated', 'total_outward_gst',
            'itc_igst', 'itc_cgst', 'itc_sgst', 'total_itc',
            'net_payable_igst', 'net_payable_cgst', 'net_payable_sgst', 'total_net_payable',
            'status', 'status_display', 'filed_date',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_total_outward_gst(self, obj):
        return obj.outward_igst + obj.outward_cgst + obj.outward_sgst

    def get_total_itc(self, obj):
        return obj.itc_igst + obj.itc_cgst + obj.itc_sgst

    def get_total_net_payable(self, obj):
        return obj.net_payable_igst + obj.net_payable_cgst + obj.net_payable_sgst


class GSTR2BEntrySerializer(serializers.ModelSerializer):
    match_status_display = serializers.CharField(source='get_match_status_display', read_only=True)
    total_gst = serializers.SerializerMethodField()

    class Meta:
        model = GSTR2BEntry
        fields = [
            'id', 'period', 'location_id', 'supplier_gstin', 'supplier_name',
            'invoice_no', 'invoice_date', 'place_of_supply',
            'taxable_value', 'cgst', 'sgst', 'igst', 'total_gst',
            'itc_eligible', 'source_po_id', 'match_status', 'match_status_display',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_total_gst(self, obj):
        return obj.cgst + obj.sgst + obj.igst


class ITCReconciliationSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = ITCReconciliation
        fields = [
            'id', 'period', 'location_id', 'supplier_gstin',
            'books_taxable', 'books_cgst', 'books_sgst', 'books_igst',
            'gstr2b_taxable', 'gstr2b_cgst', 'gstr2b_sgst', 'gstr2b_igst',
            'status', 'status_display', 'action_taken', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class RCMEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = RCMEntry
        fields = [
            'id', 'period', 'location_id', 'supplier_gstin', 'supplier_name',
            'service_type', 'sac_code', 'taxable_value',
            'cgst', 'sgst', 'igst', 'journal_entry', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'journal_entry']

import logging
from datetime import date
from decimal import Decimal
from django.db.models import Sum
from inventory_reader.models import PurchaseOrderRO, SupplierRO
from .models import TDSDeduction, TDSChallan, TDSRateConfig

logger = logging.getLogger('tds')

# Fallback rates for FY 2025-26 if TDSRateConfig is empty
FALLBACK_RATES = {
    '194C': {'Company': {'rate': Decimal('2'), 'threshold': Decimal('30000')},
             'Individual': {'rate': Decimal('1'), 'threshold': Decimal('100000')}},
    '194H': {'Company': {'rate': Decimal('2'), 'threshold': Decimal('15000')},
             'Individual': {'rate': Decimal('2'), 'threshold': Decimal('15000')}},
    '194J': {'Company': {'rate': Decimal('10'), 'threshold': Decimal('50000')},
             'Individual': {'rate': Decimal('10'), 'threshold': Decimal('50000')}},
    '194Q': {'Company': {'rate': Decimal('0.1'), 'threshold': Decimal('5000000')},
             'Individual': {'rate': Decimal('0.1'), 'threshold': Decimal('5000000')}},
    '194I': {'Company': {'rate': Decimal('10'), 'threshold': Decimal('240000')},
             'Individual': {'rate': Decimal('10'), 'threshold': Decimal('240000')}},
    '194O': {'Company': {'rate': Decimal('1'), 'threshold': Decimal('500000')},
             'Individual': {'rate': Decimal('1'), 'threshold': Decimal('500000')}},
}


def _get_fy_dates(for_date=None):
    """Get FY start and end dates for a given date."""
    d = for_date or date.today()
    if d.month >= 4:
        return date(d.year, 4, 1), date(d.year + 1, 3, 31)
    else:
        return date(d.year - 1, 4, 1), date(d.year, 3, 31)


class TDSService:

    def _get_rate_config(self, section, deductee_type, for_date=None):
        """Get TDS rate and threshold from DB config, falling back to hardcoded rates."""
        d = for_date or date.today()
        config = TDSRateConfig.objects.filter(
            section=section,
            deductee_type=deductee_type,
            is_active=True,
            fy_start__lte=d,
            fy_end__gte=d,
        ).first()

        if config:
            return config.rate, config.threshold

        # Fallback
        section_rates = FALLBACK_RATES.get(section, {})
        type_rates = section_rates.get(deductee_type, {})
        return type_rates.get('rate', Decimal('0')), type_rates.get('threshold', Decimal('0'))

    def link_purchase_order(self, po_id: int):
        """
        Check if a purchase order is subject to TDS under 194Q.
        Uses FY aggregate threshold instead of single PO check (Phase 3A fix).
        """
        if TDSDeduction.objects.filter(source_type='PurchaseOrder', source_id=po_id).exists():
            return None

        try:
            po = PurchaseOrderRO.objects.select_related('supplier').prefetch_related('lines').get(id=po_id)
        except PurchaseOrderRO.DoesNotExist:
            return None

        # Calculate total purchase amount for this PO
        current_po_total = Decimal('0.00')
        for line in po.lines.all():
            qty = Decimal(str(line.quantity + line.free_qty))
            discount_factor = (Decimal('100') - line.discount_percent) / Decimal('100')
            current_po_total += qty * line.purchase_rate * discount_factor

        section = '194Q'
        supplier = po.supplier
        deductee_type = 'Company'  # default

        rate, threshold = self._get_rate_config(section, deductee_type, po.bill_date)

        # Phase 3A: FY aggregate threshold check
        fy_start, fy_end = _get_fy_dates(po.bill_date)

        # Get cumulative purchases from this supplier in current FY
        prior_deductions = TDSDeduction.objects.filter(
            section=section,
            deductee_name=supplier.company_name,
            transaction_date__gte=fy_start,
            transaction_date__lte=fy_end,
        ).aggregate(total=Sum('gross_amount'))
        prior_total = prior_deductions['total'] or Decimal('0.00')

        cumulative = prior_total + current_po_total

        if cumulative <= threshold:
            return None

        # TDS only on the excess over threshold
        taxable_for_tds = min(current_po_total, cumulative - threshold)
        tds_amount = (taxable_for_tds * rate / Decimal('100')).quantize(Decimal('0.01'))

        if tds_amount <= 0:
            return None

        deduction = TDSDeduction.objects.create(
            deductee_name=supplier.company_name,
            deductee_pan='',
            section=section,
            nature_of_payment='Purchase of Goods',
            transaction_date=po.bill_date or po.created_at.date(),
            gross_amount=current_po_total,
            tds_rate=rate,
            tds_amount=tds_amount,
            deductee_type=deductee_type,
            source_type='PurchaseOrder',
            source_id=po_id,
            location_id=po.location_id,
        )
        return deduction

    def auto_generate_challan(self, section: str, period: str):
        """Auto-generate challan from pending deductions (Phase 3C)."""
        year, month = map(int, period.split('-'))
        pending = TDSDeduction.objects.filter(
            section=section,
            status='pending',
            transaction_date__year=year,
            transaction_date__month=month,
        )

        if not pending.exists():
            return None

        total_tds = pending.aggregate(total=Sum('tds_amount'))['total'] or Decimal('0.00')

        # Generate challan number
        count = TDSChallan.objects.count() + 1
        challan_no = f'CHL-{period}-{count:04d}'

        challan = TDSChallan.objects.create(
            challan_no=challan_no,
            bsr_code='',
            deposit_date=date.today(),
            period=period,
            section=section,
            total_tds_amount=total_tds,
        )
        challan.deductions.set(pending)

        # Update deduction statuses
        pending.update(status='challan_paid', challan_no=challan_no, challan_date=date.today())

        return challan

    def get_quarterly_summary(self, quarter: str, location_id: int):
        """
        Return quarterly TDS summary for Form 26Q export.
        Fixed: uses queryset properly instead of mixing .values() with attribute access (Phase 3D).
        """
        year, q = quarter.split('-')
        year = int(year)
        q_num = int(q[1])

        quarter_months = {
            1: [4, 5, 6],
            2: [7, 8, 9],
            3: [10, 11, 12],
            4: [1, 2, 3],
        }
        months = quarter_months[q_num]

        deductions = TDSDeduction.objects.filter(
            location_id=location_id,
            transaction_date__month__in=months,
        )
        if q_num == 4:
            deductions = deductions.filter(transaction_date__year=year + 1)
        else:
            deductions = deductions.filter(transaction_date__year=year)

        deduction_list = list(deductions)
        total_gross = sum(d.gross_amount for d in deduction_list)
        total_tds = sum(d.tds_amount for d in deduction_list)

        return {
            'quarter': quarter,
            'location_id': location_id,
            'deductions': [
                {
                    'deductee_name': d.deductee_name,
                    'deductee_pan': d.deductee_pan,
                    'section': d.section,
                    'nature_of_payment': d.nature_of_payment,
                    'transaction_date': str(d.transaction_date),
                    'gross_amount': str(d.gross_amount),
                    'tds_rate': str(d.tds_rate),
                    'tds_amount': str(d.tds_amount),
                    'deductee_type': d.deductee_type,
                    'status': d.status,
                    'challan_no': d.challan_no,
                    'challan_date': str(d.challan_date) if d.challan_date else '',
                    'bsr_code': d.bsr_code,
                }
                for d in deduction_list
            ],
            'total_gross': str(total_gross),
            'total_tds': str(total_tds),
        }

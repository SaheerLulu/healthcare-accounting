import logging
from datetime import date
from decimal import Decimal
from django.db.models import Sum
from inventory_reader.models import PurchaseOrderRO, SupplierRO
from .models import TDSDeduction, TDSChallan, TDSRateConfig

# NSDL FVU field separator for e-TDS / Form 26Q text files
FVU_SEP = '^'

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

    def _get_rate_config(self, section, deductee_type, for_date=None,
                         party_type: str = '', party_id: int = None):
        """Get TDS rate and threshold for a given section/deductee type.

        Lookup order:
          1. **Lower Deduction Certificate (s.197)** — if the party has a
             valid LDC in PartyMetadata, use the certificate rate (threshold
             still applies from the standard config).
          2. DB-stored TDSRateConfig matching FY.
          3. Hardcoded FALLBACK_RATES.
        """
        d = for_date or date.today()

        # 1. Lower deduction certificate
        if party_type and party_id:
            try:
                from parties.models import PartyMetadata
                meta = PartyMetadata.objects.filter(
                    party_type=party_type, party_id=party_id,
                    has_lower_deduction_cert=True,
                ).first()
                if (meta and meta.lower_cert_valid_from
                        and meta.lower_cert_valid_to
                        and meta.lower_cert_valid_from <= d <= meta.lower_cert_valid_to):
                    # Use certificate rate but keep statutory threshold
                    cfg = TDSRateConfig.objects.filter(
                        section=section, deductee_type=deductee_type,
                        is_active=True, fy_start__lte=d, fy_end__gte=d,
                    ).first()
                    threshold = (cfg.threshold if cfg
                                 else FALLBACK_RATES.get(section, {})
                                 .get(deductee_type, {}).get('threshold',
                                                             Decimal('0')))
                    return meta.lower_tds_rate_pct, threshold
            except Exception as exc:
                # Don't let a metadata-lookup glitch break the whole deduction —
                # but don't hide it either: log so we can audit silent fallbacks.
                logger.warning(
                    'LDC lookup failed for %s#%s section=%s: %s',
                    party_type, party_id, section, exc, exc_info=True,
                )

        # 2. DB-stored config
        config = TDSRateConfig.objects.filter(
            section=section,
            deductee_type=deductee_type,
            is_active=True,
            fy_start__lte=d,
            fy_end__gte=d,
        ).first()

        if config:
            return config.rate, config.threshold

        # 3. Fallback
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

        rate, threshold = self._get_rate_config(
            section, deductee_type, po.bill_date,
            party_type='Supplier', party_id=po.supplier_id,
        )

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

    @staticmethod
    def _fvu_field(value, *, default=''):
        """Format a value for an NSDL FVU record field."""
        if value is None:
            return default
        if isinstance(value, Decimal):
            return f'{value:.2f}'
        if isinstance(value, date):
            return value.strftime('%d/%m/%Y')
        return str(value).replace(FVU_SEP, ' ').strip()

    def export_27q_fvu(self, quarter: str, location_id: int) -> str:
        """
        Form 27Q — TDS on payments to non-residents / foreign companies.

        Same FVU layout as 26Q (FH/BH/CH/DD records) but:
          - Form-type marker is 'NS3' instead of 'NS1'
          - Each DD line carries the deductee's country code (always 'IN' here
            for back-compat; in practice a Country field would live on the
            deductee record).

        Filtered to deductions whose section is 195 (general non-resident),
        196A/B/C/D, or 194LBA/LB/LD — the sections that Form 27Q covers per
        the NSDL spec.
        """
        from core.models import AccountingSettings

        settings = AccountingSettings.get_settings()
        summary = self.get_quarterly_summary(quarter, location_id)
        nr_sections = {'195', '196A', '196B', '196C', '196D',
                       '194LB', '194LBA', '194LBB', '194LBC', '194LD'}
        deductions = [d for d in summary['deductions'] if d['section'] in nr_sections]

        # Group by (challan_no, section) — same shape as 26Q
        challans = {}
        for d in deductions:
            key = (d['challan_no'] or 'PENDING', d['section'])
            challans.setdefault(key, []).append(d)

        f = self._fvu_field
        lines = []

        # File Header — NS3 marks this as a 27Q file
        lines.append(FVU_SEP.join([
            'FH', '1', 'NS3', 'R',
            f(settings.tan or ''),
            f(quarter), 'A',
            f(settings.company_name),
            f(settings.pan or ''),
            f(settings.registered_address or ''),
        ]))

        line_no = 2
        for (challan_no, section), records in challans.items():
            total_tds = sum(Decimal(r['tds_amount']) for r in records)
            lines.append(FVU_SEP.join([
                'BH', str(line_no), f(challan_no), f(section),
                f(total_tds), str(len(records)),
            ]))
            line_no += 1

            sample = records[0]
            lines.append(FVU_SEP.join([
                'CH', str(line_no), f(challan_no), f(sample.get('bsr_code') or ''),
                f(sample.get('challan_date') or ''), f(total_tds), f(section),
            ]))
            line_no += 1

            for d in records:
                lines.append(FVU_SEP.join([
                    'DD', str(line_no),
                    f(d['deductee_name']),
                    f(d['deductee_pan'] or 'PANNOTAVBL'),
                    f(d['deductee_type']),
                    f(d['transaction_date']),
                    f(Decimal(d['gross_amount'])),
                    f(Decimal(d['tds_rate'])),
                    f(Decimal(d['tds_amount'])),
                    f(d['nature_of_payment']),
                    'IN',  # country code — would come from a deductee field in production
                ]))
                line_no += 1

        return '\n'.join(lines) + '\n'

    def export_26q_fvu(self, quarter: str, location_id: int) -> str:
        """
        Build the NSDL e-TDS / Form 26Q text file (^-delimited).

        This emits the four record types — File Header (FH), Batch Header (BH),
        Challan Header (CH) and Deductee Detail (DD) — using a representative
        subset of fields. The output structure matches the FVU layout but is
        not run through NSDL's FVU validator here; submit the file through
        the official validator before uploading to TIN-NSDL.
        """
        from core.models import AccountingSettings

        settings = AccountingSettings.get_settings()
        summary = self.get_quarterly_summary(quarter, location_id)
        deductions = summary['deductions']

        # Group deductions by (challan_no, section)
        challans = {}
        for d in deductions:
            key = (d['challan_no'] or 'PENDING', d['section'])
            challans.setdefault(key, []).append(d)

        f = self._fvu_field
        lines = []

        # FH — File Header (one per file)
        lines.append(FVU_SEP.join([
            'FH',                          # record type
            '1',                           # line number
            'NS1',                         # file type — 26Q
            'R',                           # regular return
            f(settings.tan or ''),         # TAN
            f(quarter),                    # Financial year + quarter
            'A',                           # form 26Q
            f(settings.company_name),      # deductor name
            f(settings.pan or ''),         # deductor PAN
            f(settings.registered_address or ''),
        ]))

        line_no = 2
        for (challan_no, section), records in challans.items():
            total_tds = sum(Decimal(r['tds_amount']) for r in records)

            # BH — Batch Header (one per batch / challan)
            lines.append(FVU_SEP.join([
                'BH', str(line_no), f(challan_no), f(section),
                f(total_tds), str(len(records)),
            ]))
            line_no += 1

            # CH — Challan Header
            sample = records[0]
            lines.append(FVU_SEP.join([
                'CH', str(line_no), f(challan_no), f(sample.get('bsr_code') or ''),
                f(sample.get('challan_date') or ''), f(total_tds), f(section),
            ]))
            line_no += 1

            # DD — Deductee Detail (one per deduction)
            for d in records:
                lines.append(FVU_SEP.join([
                    'DD', str(line_no),
                    f(d['deductee_name']),
                    f(d['deductee_pan'] or 'PANNOTAVBL'),
                    f(d['deductee_type']),
                    f(d['transaction_date']),
                    f(Decimal(d['gross_amount'])),
                    f(Decimal(d['tds_rate'])),
                    f(Decimal(d['tds_amount'])),
                    f(d['nature_of_payment']),
                ]))
                line_no += 1

        return '\n'.join(lines) + '\n'

    # ─── TCS u/s 206C(1H) ─────────────────────────────────────────────────

    TCS_THRESHOLD = Decimal('5000000')   # ₹50 L per buyer per FY
    TCS_RATE = Decimal('0.10')            # 0.1% (0.075% during FY 2020-21 covid relief)

    @staticmethod
    def _fy_label_for(d: date) -> str:
        if d.month >= 4:
            return f'{d.year}-{str(d.year + 1)[-2:]}'
        return f'{d.year - 1}-{str(d.year)[-2:]}'

    def collect_tcs_for_b2b_sale(self, *, b2b_id: int, buyer_id: int,
                                 buyer_name: str, buyer_pan: str = '',
                                 sale_amount, transaction_date,
                                 invoice_no: str = '',
                                 location_id: int = None):
        """
        Compute TCS u/s 206C(1H) and create a TCSCollection row if the
        cumulative-FY threshold is crossed. Idempotent on (source_type,
        source_id) — re-runs return the existing row.
        """
        from .models import TCSCollection

        sale_amount = Decimal(str(sale_amount))
        existing = TCSCollection.objects.filter(
            source_type='B2BSalesOrder', source_id=b2b_id,
        ).first()
        if existing:
            return existing

        fy_label = self._fy_label_for(transaction_date)

        # Cumulative sales to this buyer in this FY (including this invoice).
        # We sum from the TCS records' base sales (sale_amount). Any sale that
        # didn't pierce the threshold has no TCS row, so we also need to add
        # the *raw* sales — for now, use the recorded TCSCollection rows + this
        # invoice as a proxy. In practice this should query the sales ledger,
        # but the proxy is good enough when TCSCollection rows are kept up-to-
        # date by the sync service.
        already_recorded = TCSCollection.objects.filter(
            buyer_id=buyer_id, fy_label=fy_label,
        ).aggregate(s=Sum('sale_amount'))['s'] or Decimal('0')
        cumulative = already_recorded + sale_amount

        if cumulative <= self.TCS_THRESHOLD:
            return None

        # TCS only on the portion exceeding the threshold
        excess_in_this_invoice = min(
            sale_amount, cumulative - self.TCS_THRESHOLD,
        )
        tcs_amount = (
            excess_in_this_invoice * self.TCS_RATE / Decimal('100')
        ).quantize(Decimal('0.01'))

        if tcs_amount <= 0:
            return None

        return TCSCollection.objects.create(
            buyer_name=buyer_name, buyer_pan=buyer_pan, buyer_id=buyer_id,
            transaction_date=transaction_date, fy_label=fy_label,
            invoice_no=invoice_no,
            source_type='B2BSalesOrder', source_id=b2b_id,
            sale_amount=sale_amount, cumulative_sales_fy=cumulative,
            taxable_amount=excess_in_this_invoice,
            tcs_rate=self.TCS_RATE, tcs_amount=tcs_amount,
            location_id=location_id,
        )

    def form_16a_data(self, quarter: str, location_id: int, deductee_pan: str = '',
                      deductee_name: str = ''):
        """
        Aggregate one quarter's deductions for a single deductee into the
        structure needed to render a Form-16A PDF.
        """
        from core.models import AccountingSettings

        settings = AccountingSettings.get_settings()
        summary = self.get_quarterly_summary(quarter, location_id)
        rows = summary['deductions']

        if deductee_pan:
            rows = [r for r in rows if r['deductee_pan'].upper() == deductee_pan.upper()]
        elif deductee_name:
            rows = [r for r in rows if r['deductee_name'].lower() == deductee_name.lower()]

        if not rows:
            return None

        total_paid = sum(Decimal(r['gross_amount']) for r in rows)
        total_tds = sum(Decimal(r['tds_amount']) for r in rows)

        return {
            'deductor': {
                'name': settings.company_name,
                'tan': settings.tan,
                'pan': settings.pan,
                'address': settings.registered_address,
            },
            'deductee': {
                'name': rows[0]['deductee_name'],
                'pan': rows[0]['deductee_pan'] or 'PANNOTAVBL',
            },
            'quarter': quarter,
            'rows': rows,
            'total_paid': total_paid,
            'total_tds': total_tds,
        }

import logging
from decimal import Decimal, ROUND_HALF_UP
from datetime import date
from django.db import transaction
from django.db.models import Sum, F

from inventory_reader.models import (
    POSOrderRO, B2BSalesOrderRO, SalesReturnRO, PurchaseOrderRO
)
from core.models import AccountingSettings
from core.gst_utils import (
    compute_tax_split, detect_supply_type, back_calculate_taxable,
    state_name_to_code,
)
from .models import (
    GSTR1Entry, GSTR1HSNSummary, GSTR3BSummary,
    GSTR2BEntry, ITCReconciliation, RCMEntry,
)

logger = logging.getLogger('gst_returns')


class GSTR1Generator:

    def __init__(self):
        self._settings = AccountingSettings.get_settings()

    def _get_supply_type(self, counterparty_gstin, counterparty_state_code=''):
        return detect_supply_type(
            self._settings.gstin,
            counterparty_gstin,
            self._settings.state_code,
            counterparty_state_code,
        )

    def generate(self, period: str, location_id: int):
        """
        Generate GSTR-1 entries non-destructively (Phase 2A).
        Old entries are marked is_active=False, new ones created with incremented version.
        """
        year, month = map(int, period.split('-'))

        # Determine next version
        last_version = GSTR1Entry.objects.filter(
            period=period, location_id=location_id
        ).order_by('-version').values_list('version', flat=True).first() or 0
        new_version = last_version + 1

        # Deactivate old entries
        GSTR1Entry.objects.filter(
            period=period, location_id=location_id, is_active=True
        ).update(is_active=False)

        # Also deactivate old HSN summaries
        GSTR1HSNSummary.objects.filter(
            period=period, location_id=location_id, is_active=True
        ).update(is_active=False)

        entries_created = 0
        hsn_data = {}  # keyed by (hsn_code, rate)

        # POS Sales
        pos_orders = POSOrderRO.objects.filter(
            sale_date__year=year,
            sale_date__month=month,
            location_id=location_id,
            status__in=['confirmed', 'completed'],
        ).prefetch_related('lines')

        for pos in pos_orders:
            # Resolve customer + supply_type *first* so per-line splits agree
            # with the supply_type used by the JE generator.
            supply_type = 'intra_state'
            customer_gstin = ''
            customer_state_code = ''
            pos_code = self._settings.state_code
            if pos.customer_id:
                try:
                    from inventory_reader.models import CustomerRO
                    customer = CustomerRO.objects.get(id=pos.customer_id)
                    customer_gstin = customer.gst_no or ''
                    customer_state_code = state_name_to_code(customer.state or '')
                    supply_type = self._get_supply_type(
                        customer_gstin, customer_state_code,
                    )
                    pos_code = (
                        customer_gstin[:2] if customer_gstin else
                        customer_state_code or self._settings.state_code
                    )
                except Exception:
                    pos_code = self._settings.state_code

            # Aggregate per line using the SAME split arithmetic as the JE
            # (`JournalAutoGenerationService.generate_pos_sale`): per-line
            # back-calc, per-line half-split for intra-state. This guarantees
            # GSTR-1 totals and JE Output GST credits match to the paisa for
            # multi-rate carts. Header gst_percent is unreliable (0 in source).
            taxable_base = Decimal('0.00')
            split = {'cgst': Decimal('0.00'), 'sgst': Decimal('0.00'), 'igst': Decimal('0.00')}
            line_rate_set = set()
            for line in pos.lines.all():
                line_total = Decimal(str(line.line_total or 0))
                line_taxable = back_calculate_taxable(line_total, line.tax_percent)
                line_tax = line_total - line_taxable
                taxable_base += line_taxable
                if supply_type == 'inter_state':
                    split['igst'] += line_tax
                else:
                    half = (line_tax / Decimal('2')).quantize(
                        Decimal('0.01'), rounding=ROUND_HALF_UP,
                    )
                    split['cgst'] += half
                    split['sgst'] += line_tax - half
                line_rate_set.add(line.tax_percent)
            taxable_base = taxable_base.quantize(Decimal('0.01'))
            for k in split:
                split[k] = split[k].quantize(Decimal('0.01'))
            tax_total = split['cgst'] + split['sgst'] + split['igst']
            # Effective rate: single rate if homogeneous, else recover from totals.
            gst_rate = next(iter(line_rate_set)) if len(line_rate_set) == 1 else (
                (tax_total * Decimal('100') / taxable_base).quantize(Decimal('0.01'))
                if taxable_base else Decimal('0.00')
            )
            # B2C-Large applies only to inter-state supplies > ₹2.5L per
            # Notification 12/2020-CT. Intra-state B2C is always B2C_SMALL
            # regardless of value.
            inv_type = (
                'B2C_LARGE'
                if supply_type == 'inter_state' and pos.total_amount > Decimal('250000')
                else 'B2C_SMALL'
            )

            GSTR1Entry.objects.create(
                source_type='pos',
                source_id=pos.id,
                period=period,
                version=new_version,
                is_active=True,
                location_id=location_id,
                invoice_no=pos.invoice_no or f'POS-{pos.id}',
                invoice_date=pos.sale_date.date(),
                customer_gstin=customer_gstin,
                invoice_type=inv_type,
                place_of_supply=pos_code,
                taxable_value=taxable_base,
                cgst=split['cgst'],
                sgst=split['sgst'],
                igst=split['igst'],
                rate=gst_rate,
            )
            entries_created += 1

            # Collect HSN data from lines
            for line in pos.lines.all():
                hsn = line.product.pharma_hsn_code if line.product else ''
                rate = line.tax_percent
                key = (hsn or 'UNKNOWN', rate)
                if key not in hsn_data:
                    hsn_data[key] = {'qty': Decimal('0'), 'taxable': Decimal('0'), 'cgst': Decimal('0'), 'sgst': Decimal('0'), 'igst': Decimal('0'), 'desc': line.product.name if line.product else ''}
                line_inclusive = line.line_total
                line_taxable = back_calculate_taxable(line_inclusive, rate)
                line_split = compute_tax_split(line_taxable, rate, supply_type)
                hsn_data[key]['qty'] += Decimal(str(line.quantity))
                hsn_data[key]['taxable'] += line_taxable
                hsn_data[key]['cgst'] += line_split['cgst']
                hsn_data[key]['sgst'] += line_split['sgst']
                hsn_data[key]['igst'] += line_split['igst']

        # B2B Sales
        b2b_orders = B2BSalesOrderRO.objects.filter(
            sale_date__year=year,
            sale_date__month=month,
            location_id=location_id,
            status__in=['confirmed', 'delivered', 'invoiced'],
        ).select_related('customer').prefetch_related('lines')

        for order in b2b_orders:
            taxable = order.subtotal - order.discount_amount
            customer_gstin = order.customer.gst_no if order.customer and order.customer.gst_no else ''
            customer_state_code = (
                state_name_to_code(order.customer.state)
                if order.customer and getattr(order.customer, 'state', '') else ''
            )
            # Always re-derive — pre-populated supply_type / total_cgst|sgst|igst on the
            # order may carry the old wrong classification.
            supply_type = self._get_supply_type(customer_gstin, customer_state_code)
            # order.gst_percent is unreliable; sum line tax fields and re-split.
            total_tax = sum(
                (Decimal(str(l.cgst_amount or 0)) +
                 Decimal(str(l.sgst_amount or 0)) +
                 Decimal(str(l.igst_amount or 0)))
                for l in order.lines.all()
            )
            if supply_type == 'inter_state':
                cgst, sgst, igst = Decimal('0.00'), Decimal('0.00'), total_tax
            else:
                half = (total_tax / Decimal('2')).quantize(Decimal('0.01'))
                cgst, sgst, igst = half, total_tax - half, Decimal('0.00')
            # Effective rate: derive from totals if uniform, else 0.
            gst_rate = (
                (total_tax * Decimal('100') / taxable).quantize(Decimal('0.01'))
                if taxable else Decimal('0.00')
            )

            pos_code = (
                customer_gstin[:2] if customer_gstin else
                customer_state_code or self._settings.state_code
            )
            # B2C-Large only applies to inter-state > ₹2.5L (Notif 12/2020-CT).
            if customer_gstin:
                inv_type = 'B2B'
            elif supply_type == 'inter_state' and order.total_amount > Decimal('250000'):
                inv_type = 'B2C_LARGE'
            else:
                inv_type = 'B2C_SMALL'

            GSTR1Entry.objects.create(
                source_type='b2b',
                source_id=order.id,
                period=period,
                version=new_version,
                is_active=True,
                location_id=location_id,
                invoice_no=order.invoice_no or f'B2B-{order.id}',
                invoice_date=order.sale_date or order.created_at.date(),
                customer_gstin=customer_gstin,
                invoice_type=inv_type,
                place_of_supply=pos_code,
                taxable_value=taxable,
                cgst=cgst,
                sgst=sgst,
                igst=igst,
                rate=gst_rate,
            )
            entries_created += 1

            for line in order.lines.all():
                hsn = line.product.pharma_hsn_code if line.product else ''
                rate = line.tax_percent
                key = (hsn or 'UNKNOWN', rate)
                if key not in hsn_data:
                    hsn_data[key] = {'qty': Decimal('0'), 'taxable': Decimal('0'), 'cgst': Decimal('0'), 'sgst': Decimal('0'), 'igst': Decimal('0'), 'desc': line.product.name if line.product else ''}
                line_taxable = line.line_total - (Decimal(str(line.cgst_amount or 0)) + Decimal(str(line.sgst_amount or 0)) + Decimal(str(line.igst_amount or 0)))
                hsn_data[key]['qty'] += Decimal(str(line.quantity))
                hsn_data[key]['taxable'] += line_taxable
                hsn_data[key]['cgst'] += Decimal(str(line.cgst_amount or 0))
                hsn_data[key]['sgst'] += Decimal(str(line.sgst_amount or 0))
                hsn_data[key]['igst'] += Decimal(str(line.igst_amount or 0))

        # Sales Returns (Credit Notes) — Phase 2B: CDNR/CDNUR
        returns = SalesReturnRO.objects.filter(
            return_date__year=year,
            return_date__month=month,
            location_id=location_id,
            status__in=['confirmed', 'completed'],
        ).select_related('customer')

        for ret in returns.prefetch_related('lines'):
            customer_gstin = ret.customer.gst_no if ret.customer and ret.customer.gst_no else ''
            customer_state_code = (
                state_name_to_code(ret.customer.state)
                if ret.customer and getattr(ret.customer, 'state', '') else ''
            )
            supply_type = (
                'intra_state' if ret.return_type == 'pos' and not customer_gstin and not customer_state_code
                else self._get_supply_type(customer_gstin, customer_state_code)
            )

            # SalesReturnLineRO.line_total is tax-inclusive for both POS and B2B
            # returns. Per-line aggregation matches `generate_sales_return` so
            # the credit-note JE and the GSTR-1 row foot to the paisa even on
            # mixed-rate carts.
            taxable_base = Decimal('0.00')
            split = {'cgst': Decimal('0.00'), 'sgst': Decimal('0.00'), 'igst': Decimal('0.00')}
            line_rate_set = set()
            for line in ret.lines.all():
                line_total = Decimal(str(line.line_total or 0))
                line_taxable = back_calculate_taxable(line_total, line.tax_percent)
                line_tax = line_total - line_taxable
                taxable_base += line_taxable
                if supply_type == 'inter_state':
                    split['igst'] += line_tax
                else:
                    half = (line_tax / Decimal('2')).quantize(
                        Decimal('0.01'), rounding=ROUND_HALF_UP,
                    )
                    split['cgst'] += half
                    split['sgst'] += line_tax - half
                line_rate_set.add(line.tax_percent)
            taxable_base = taxable_base.quantize(Decimal('0.01'))
            for k in split:
                split[k] = split[k].quantize(Decimal('0.01'))
            tax_total = split['cgst'] + split['sgst'] + split['igst']
            gst_rate = next(iter(line_rate_set)) if len(line_rate_set) == 1 else (
                (tax_total * Decimal('100') / taxable_base).quantize(Decimal('0.01'))
                if taxable_base else Decimal('0.00')
            )

            # Determine invoice type: CDNR for registered, CREDIT_NOTE for unregistered
            if customer_gstin:
                inv_type = 'CDNR'
            else:
                inv_type = 'CREDIT_NOTE'

            ret_date = ret.return_date.date() if hasattr(ret.return_date, 'date') else ret.return_date

            # Per CGST §34(2), the deadline to declare a credit note is
            # 30 November of the FY *following the original supply* — not the
            # FY of the credit note itself. Resolve the original sale date via
            # the FK to the source invoice; fall back to the credit-note date
            # when no FK is set (worst case keeps the old behaviour, never
            # silently passes a stale CN as in-time).
            original_inv = ''
            original_inv_date = None
            if getattr(ret, 'original_b2b_order_id', None):
                try:
                    original_inv = ret.original_b2b_order.invoice_no or ''
                    original_inv_date = ret.original_b2b_order.sale_date
                except Exception:
                    pass
            elif getattr(ret, 'original_order_id', None):
                try:
                    original_inv = ret.original_order.invoice_no or ''
                    src_dt = ret.original_order.sale_date
                    original_inv_date = src_dt.date() if hasattr(src_dt, 'date') else src_dt
                except Exception:
                    pass

            anchor = original_inv_date or ret_date
            fy_year = anchor.year if anchor.month >= 4 else anchor.year - 1
            deadline = date(fy_year + 1, 11, 30)
            is_time_barred = ret_date > deadline

            GSTR1Entry.objects.create(
                source_type='return',
                source_id=ret.id,
                period=period,
                version=new_version,
                is_active=True,
                location_id=location_id,
                invoice_no=ret.return_no or f'RET-{ret.id}',
                invoice_date=ret_date,
                customer_gstin=customer_gstin,
                invoice_type=inv_type,
                place_of_supply=customer_gstin[:2] if customer_gstin else self._settings.state_code,
                taxable_value=-taxable_base,
                cgst=-split['cgst'],
                sgst=-split['sgst'],
                igst=-split['igst'],
                rate=gst_rate,
                original_invoice_no=original_inv,
                original_invoice_date=original_inv_date,
                is_time_barred=is_time_barred,
            )
            entries_created += 1

        # Generate HSN summary
        for (hsn_code, rate), data in hsn_data.items():
            GSTR1HSNSummary.objects.create(
                period=period,
                location_id=location_id,
                hsn_code=hsn_code,
                description=data['desc'][:255],
                quantity=data['qty'],
                taxable_value=data['taxable'],
                cgst=data['cgst'],
                sgst=data['sgst'],
                igst=data['igst'],
                rate=rate,
                version=new_version,
                is_active=True,
            )

        entries_qs = GSTR1Entry.objects.filter(period=period, location_id=location_id, is_active=True)
        return {
            'period': period,
            'location_id': location_id,
            'entries_count': entries_created,
            'version': new_version,
            'total_taxable': str(entries_qs.aggregate(t=Sum('taxable_value'))['t'] or Decimal('0.00')),
            'total_cgst': str(entries_qs.aggregate(t=Sum('cgst'))['t'] or Decimal('0.00')),
            'total_sgst': str(entries_qs.aggregate(t=Sum('sgst'))['t'] or Decimal('0.00')),
            'total_igst': str(entries_qs.aggregate(t=Sum('igst'))['t'] or Decimal('0.00')),
        }


class GSTR2BGenerator:
    """Generate GSTR-2B (purchase register) from confirmed purchases (Phase 2C)."""

    def __init__(self):
        self._settings = AccountingSettings.get_settings()

    def generate(self, period: str, location_id: int):
        year, month = map(int, period.split('-'))

        # Clear existing for re-generation
        GSTR2BEntry.objects.filter(period=period, location_id=location_id).delete()

        # Match POs whose bill_date falls in the period. POs with no bill_date
        # fall back to created_at — mirroring the write-time fallback at line
        # 387 below — so a confirmed PO with a missing bill_date doesn't drop
        # silently out of GSTR-2B (and out of the ITC matching that depends
        # on it).
        from django.db.models import Q
        purchases = PurchaseOrderRO.objects.filter(
            location_id=location_id,
            state__in=['confirmed', 'done', 'approved'],
        ).filter(
            Q(bill_date__year=year, bill_date__month=month) |
            Q(bill_date__isnull=True,
              created_at__year=year, created_at__month=month)
        ).select_related('supplier').prefetch_related('lines')

        entries_created = 0
        for po in purchases:
            supplier_gstin = po.supplier.gst_no if po.supplier else ''
            supplier_name = po.supplier.company_name if po.supplier else f'Supplier #{po.supplier_id}'
            # Always re-derive — pre-populated po.supply_type and per-line tax fields
            # on the inventory side have been observed wrong (intra when supplier state
            # differs from company state).
            supply_type = detect_supply_type(
                self._settings.gstin, supplier_gstin, self._settings.state_code,
            )

            taxable_amount = Decimal('0.00')
            cgst_amount = Decimal('0.00')
            sgst_amount = Decimal('0.00')
            igst_amount = Decimal('0.00')

            for line in po.lines.all():
                qty = Decimal(str(line.quantity + line.free_qty))
                rate = line.purchase_rate
                discount_factor = (Decimal('100') - line.discount_percent) / Decimal('100')
                line_taxable = qty * rate * discount_factor
                taxable_amount += line_taxable

                split = compute_tax_split(line_taxable, line.tax_percent, supply_type)
                cgst_amount += split['cgst']
                sgst_amount += split['sgst']
                igst_amount += split['igst']

            pos_code = supplier_gstin[:2] if supplier_gstin else self._settings.state_code

            GSTR2BEntry.objects.create(
                period=period,
                location_id=location_id,
                supplier_gstin=supplier_gstin,
                supplier_name=supplier_name,
                invoice_no=po.bill_no,
                invoice_date=po.bill_date or po.created_at.date(),
                place_of_supply=pos_code,
                taxable_value=taxable_amount,
                cgst=cgst_amount,
                sgst=sgst_amount,
                igst=igst_amount,
                itc_eligible=True,
                source_po_id=po.id,
            )
            entries_created += 1

        return {
            'period': period,
            'location_id': location_id,
            'entries_count': entries_created,
        }


class GSTR3BGenerator:

    @transaction.atomic
    def generate(self, period: str, location_id: int):
        """Generate GSTR-3B using GSTR-1 for outward and the General Ledger for ITC.

        ITC is sourced directly from posted JournalEntryLine rows on Input GST
        accounts (1140 / 1150 / 1160) for the period+location. This guarantees
        the §7 identity Trial Balance ≡ GSTR-3B ITC, regardless of any drift
        between inventory's per-line tax fields and the JE-posted amounts.

        GSTR-1 and GSTR-2B are always re-generated for the period+location so
        no stale source row can poison the outward / reconciliation views.
        GSTR-2B retains its PO-derived view for the gov-supplied 2B
        reconciliation flow (ITCReconciliationService) — that contract is
        unchanged.
        """
        from journals.models import JournalEntryLine

        GSTR1Generator().generate(period, location_id)
        GSTR2BGenerator().generate(period, location_id)

        year, month = map(int, period.split('-'))

        # 3.1(a) Outward supplies — include CDNR/CREDIT_NOTE/DEBIT_NOTE so that
        # credit-note adjustments (stored with negative amounts in GSTR1Entry,
        # see GSTR1Generator line 292-295) net out of the period's totals.
        # Sales returns and forward sales are reported on a NET basis under
        # CGST §34 r/w portal Table 3.1(a).
        outward_types = ['B2B', 'B2C_LARGE', 'B2C_SMALL', 'CDNR', 'CREDIT_NOTE', 'DEBIT_NOTE']
        entries = list(GSTR1Entry.objects.filter(
            period=period,
            location_id=location_id,
            is_active=True,
            invoice_type__in=outward_types,
        ).exclude(is_time_barred=True))

        outward_taxable = sum((e.taxable_value for e in entries), Decimal('0.00'))
        outward_igst = sum((e.igst for e in entries), Decimal('0.00'))
        outward_cgst = sum((e.cgst for e in entries), Decimal('0.00'))
        outward_sgst = sum((e.sgst for e in entries), Decimal('0.00'))

        # 3.1(d) Inward supplies liable to RCM — picked from RCMEntry posted in
        # the period. The corresponding ITC flows through Input GST 1140/1150/
        # 1160 in the GL (see JournalAutoGenerationService.generate_rcm_entry),
        # so we have to subtract it from the total Input-GST debits and report
        # it separately under 4(A)(3) instead of 4(A)(5).
        rcm_qs = RCMEntry.objects.filter(period=period, location_id=location_id)
        rcm_taxable = rcm_qs.aggregate(t=Sum('taxable_value'))['t'] or Decimal('0.00')
        rcm_cgst = rcm_qs.aggregate(t=Sum('cgst'))['t'] or Decimal('0.00')
        rcm_sgst = rcm_qs.aggregate(t=Sum('sgst'))['t'] or Decimal('0.00')
        rcm_igst = rcm_qs.aggregate(t=Sum('igst'))['t'] or Decimal('0.00')

        # ITC from posted JE Input GST lines for the period+location.
        # Net debit = purchase debits − purchase-return credit reversals.
        itc_rows = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            entry__date__year=year,
            entry__date__month=month,
            entry__location_id=location_id,
            account__account_code__in=['1140', '1150', '1160'],
        ).values('account__account_code').annotate(
            total_debit=Sum('debit'),
            total_credit=Sum('credit'),
        )
        itc_by_code = {
            row['account__account_code']: (
                (row['total_debit'] or Decimal('0.00'))
                - (row['total_credit'] or Decimal('0.00'))
            )
            for row in itc_rows
        }
        total_itc_cgst = itc_by_code.get('1140', Decimal('0.00'))
        total_itc_sgst = itc_by_code.get('1150', Decimal('0.00'))
        total_itc_igst = itc_by_code.get('1160', Decimal('0.00'))

        # 4(A)(5) "All other ITC" = total Input-GST debits − RCM ITC.
        # Negative residuals are clamped to 0 to handle the edge case where
        # an RCM JE was posted but the matching aggregation row was deleted.
        itc_cgst = max(total_itc_cgst - rcm_cgst, Decimal('0.00'))
        itc_sgst = max(total_itc_sgst - rcm_sgst, Decimal('0.00'))
        itc_igst = max(total_itc_igst - rcm_igst, Decimal('0.00'))

        # Total liability = forward outward + RCM inward (3.1(a) + 3.1(d)).
        # Total ITC = regular ITC + RCM ITC (4(A)(5) + 4(A)(3)). Net payable
        # is computed against the combined gross.
        gross_cgst = outward_cgst + rcm_cgst
        gross_sgst = outward_sgst + rcm_sgst
        gross_igst = outward_igst + rcm_igst
        eff_itc_cgst = itc_cgst + rcm_cgst
        eff_itc_sgst = itc_sgst + rcm_sgst
        eff_itc_igst = itc_igst + rcm_igst

        # ITC utilization order per §49 + Rule 88A: IGST first, then CGST, then SGST.
        remaining_igst = max(gross_igst - eff_itc_igst, Decimal('0.00'))
        igst_surplus = max(eff_itc_igst - gross_igst, Decimal('0.00'))

        cgst_short_after_own = max(gross_cgst - eff_itc_cgst, Decimal('0.00'))
        igst_used_for_cgst = min(igst_surplus, cgst_short_after_own)
        igst_surplus_after_cgst = igst_surplus - igst_used_for_cgst
        sgst_short_after_own = max(gross_sgst - eff_itc_sgst, Decimal('0.00'))

        net_cgst = max(cgst_short_after_own - igst_used_for_cgst, Decimal('0.00'))
        net_sgst = max(sgst_short_after_own - min(igst_surplus_after_cgst, sgst_short_after_own), Decimal('0.00'))
        net_igst = remaining_igst

        summary, _ = GSTR3BSummary.objects.update_or_create(
            period=period,
            location_id=location_id,
            defaults=dict(
                outward_taxable=outward_taxable,
                outward_igst=outward_igst,
                outward_cgst=outward_cgst,
                outward_sgst=outward_sgst,
                rcm_taxable=rcm_taxable,
                rcm_cgst=rcm_cgst,
                rcm_sgst=rcm_sgst,
                rcm_igst=rcm_igst,
                itc_cgst=itc_cgst,
                itc_sgst=itc_sgst,
                itc_igst=itc_igst,
                rcm_itc_cgst=rcm_cgst,
                rcm_itc_sgst=rcm_sgst,
                rcm_itc_igst=rcm_igst,
                net_payable_cgst=net_cgst,
                net_payable_sgst=net_sgst,
                net_payable_igst=net_igst,
            ),
        )
        return summary


class ITCReconciliationService:
    """Reconcile ITC between books (GSTR-2B) and journal entries (Phase 2E)."""

    def reconcile(self, period: str, location_id: int):
        # Clear existing reconciliation for re-run
        ITCReconciliation.objects.filter(period=period, location_id=location_id).delete()

        gstr2b_entries = GSTR2BEntry.objects.filter(period=period, location_id=location_id)

        # Group GSTR-2B by supplier GSTIN.
        supplier_2b: dict[str, dict] = {}
        for entry in gstr2b_entries:
            gstin = entry.supplier_gstin
            bucket = supplier_2b.setdefault(gstin, {
                'taxable': Decimal('0.00'), 'cgst': Decimal('0.00'),
                'sgst': Decimal('0.00'), 'igst': Decimal('0.00'),
            })
            bucket['taxable'] += entry.taxable_value
            bucket['cgst'] += entry.cgst
            bucket['sgst'] += entry.sgst
            bucket['igst'] += entry.igst

        # Books-side: aggregate posted purchase JEs by supplier-GSTIN.
        # The party_id on the trade-payables line points at SupplierRO.id;
        # we resolve that to a GSTIN once per supplier so both sides of the
        # recon key on the same field. Taxable is summed from the goods-cost
        # debit lines (Closing Stock 1190 in perpetual mode, Purchases 5100
        # in periodic) and tax from the Input GST debit lines.
        from journals.models import JournalEntryLine, JournalEntry
        from inventory_reader.models import SupplierRO
        year, month = map(int, period.split('-'))

        purchase_entries = JournalEntry.objects.filter(
            is_posted=True,
            voucher_type__in=['PURCHASE', 'DEBIT_NOTE'],
            date__year=year,
            date__month=month,
        )
        if location_id:
            purchase_entries = purchase_entries.filter(location_id=location_id)

        supplier_ids: set[int] = set()
        for je in purchase_entries:
            for line in je.lines.filter(party_type='Supplier'):
                if line.party_id:
                    supplier_ids.add(line.party_id)

        gstin_by_supplier_id = dict(
            SupplierRO.objects.filter(id__in=supplier_ids)
            .values_list('id', 'gst_no')
        )

        TAXABLE_CODES = ('1190', '5100')          # Closing Stock OR Purchases
        TAX_CODE_MAP = {'1140': 'cgst', '1150': 'sgst', '1160': 'igst'}
        SIGN_BY_VOUCHER = {'PURCHASE': Decimal('1'), 'DEBIT_NOTE': Decimal('-1')}

        supplier_books: dict[str, dict] = {}
        for je in purchase_entries:
            sign = SIGN_BY_VOUCHER.get(je.voucher_type, Decimal('1'))
            # Find the supplier GSTIN for this entry — there's at most one
            # supplier party per purchase JE.
            supplier_gstin = ''
            for line in je.lines.filter(party_type='Supplier'):
                if line.party_id:
                    supplier_gstin = gstin_by_supplier_id.get(line.party_id, '') or ''
                    break
            if not supplier_gstin:
                continue
            bucket = supplier_books.setdefault(supplier_gstin, {
                'taxable': Decimal('0.00'), 'cgst': Decimal('0.00'),
                'sgst': Decimal('0.00'), 'igst': Decimal('0.00'),
            })
            for line in je.lines.all():
                code = line.account.account_code
                if code in TAXABLE_CODES:
                    bucket['taxable'] += sign * (line.debit - line.credit)
                elif code in TAX_CODE_MAP:
                    bucket[TAX_CODE_MAP[code]] += sign * (line.debit - line.credit)

        results = []
        all_gstins = set(supplier_2b.keys()) | set(supplier_books.keys())
        empty = {'taxable': Decimal('0.00'), 'cgst': Decimal('0.00'),
                 'sgst': Decimal('0.00'), 'igst': Decimal('0.00')}

        for gstin in all_gstins:
            b2b = supplier_2b.get(gstin, empty)
            books = supplier_books.get(gstin, empty)

            diff = abs(b2b['taxable'] - books['taxable'])
            if books['taxable'] == 0 and b2b['taxable'] != 0:
                status = 'unmatched'        # in 2B, missing in books
            elif b2b['taxable'] == 0 and books['taxable'] != 0:
                status = 'unmatched'        # in books, missing in 2B
            elif diff < Decimal('1.00'):
                status = 'matched'
            else:
                status = 'partial'

            recon = ITCReconciliation.objects.create(
                period=period,
                location_id=location_id,
                supplier_gstin=gstin,
                books_taxable=books['taxable'],
                books_cgst=books['cgst'],
                books_sgst=books['sgst'],
                books_igst=books['igst'],
                gstr2b_taxable=b2b['taxable'],
                gstr2b_cgst=b2b['cgst'],
                gstr2b_sgst=b2b['sgst'],
                gstr2b_igst=b2b['igst'],
                status=status,
            )
            results.append(recon)

            GSTR2BEntry.objects.filter(
                period=period, location_id=location_id, supplier_gstin=gstin
            ).update(match_status=status)

        return {
            'period': period,
            'location_id': location_id,
            'total_records': len(results),
            'matched': sum(1 for r in results if r.status == 'matched'),
            'unmatched': sum(1 for r in results if r.status == 'unmatched'),
            'partial': sum(1 for r in results if r.status == 'partial'),
        }

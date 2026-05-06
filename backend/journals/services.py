import logging
from decimal import Decimal
from django.db import transaction
from inventory_reader.models import (
    PurchaseOrderRO,
    POSOrderRO,
    B2BSalesOrderRO,
    SalesReturnRO,
    PurchaseReturnRO,
)
from core.models import AccountMapping, AccountingSettings
from decimal import ROUND_HALF_UP
from core.gst_utils import compute_tax_split, detect_supply_type, back_calculate_taxable
from .models import JournalEntry, JournalEntryLine, RecurringJournal, RecurringJournalLine

logger = logging.getLogger('journals')


class JournalAutoGenerationService:

    def __init__(self):
        """Eagerly load all account mappings into a dict."""
        self._accounts = AccountMapping.get_all_mappings()
        self._settings = AccountingSettings.get_settings()

    def _acct(self, key):
        """Get account by mapping key; raise ValueError if not configured."""
        acct = self._accounts.get(key)
        if not acct:
            raise ValueError(f"Account mapping not configured for key: {key}")
        return acct

    def _entry_exists(self, reference_type, reference_id):
        return JournalEntry.objects.filter(
            reference_type=reference_type,
            reference_id=reference_id,
        ).exists()

    def _get_supply_type(self, counterparty_gstin):
        """Detect supply type using company state (from GSTIN or state_code anchor)."""
        return detect_supply_type(
            self._settings.gstin,
            counterparty_gstin,
            self._settings.state_code,
        )

    @transaction.atomic
    def generate_purchase(self, po_id):
        """Generate journal entry for a purchase order with proper IGST support."""
        if self._entry_exists('PurchaseOrder', po_id):
            return None

        po = PurchaseOrderRO.objects.select_related('supplier').prefetch_related('lines').get(id=po_id)
        if po.state not in ('confirmed', 'done', 'approved'):
            return None

        lines_data = po.lines.all()
        taxable_amount = Decimal('0.00')
        cgst_amount = Decimal('0.00')
        sgst_amount = Decimal('0.00')
        igst_amount = Decimal('0.00')

        # Always re-derive supply_type — pre-populated po.supply_type from inventory has been observed wrong.
        supply_type = self._get_supply_type(po.supplier.gst_no if po.supplier else '')

        # Pre-computed line.cgst_amount/sgst_amount/igst_amount carry the inventory's
        # (possibly wrong) classification. Sum the total tax across lines and re-split
        # per our freshly-derived supply_type.
        for line in lines_data:
            qty = Decimal(str(line.quantity + line.free_qty))
            rate = line.purchase_rate
            discount_factor = (Decimal('100') - line.discount_percent) / Decimal('100')
            line_taxable = qty * rate * discount_factor
            taxable_amount += line_taxable

        total_tax = Decimal('0.00')
        for line in lines_data:
            total_tax += (
                Decimal(str(line.cgst_amount or 0))
                + Decimal(str(line.sgst_amount or 0))
                + Decimal(str(line.igst_amount or 0))
            )
        if total_tax == Decimal('0.00'):
            # Fall back to per-line tax_percent if no pre-computed totals.
            for line in lines_data:
                qty = Decimal(str(line.quantity + line.free_qty))
                rate = line.purchase_rate
                discount_factor = (Decimal('100') - line.discount_percent) / Decimal('100')
                line_taxable = qty * rate * discount_factor
                line_tax = (line_taxable * Decimal(str(line.tax_percent or 0)) / Decimal('100')).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
                total_tax += line_tax

        if supply_type == 'inter_state':
            cgst_amount, sgst_amount, igst_amount = Decimal('0.00'), Decimal('0.00'), total_tax
        else:
            half = (total_tax / Decimal('2')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            cgst_amount, sgst_amount, igst_amount = half, total_tax - half, Decimal('0.00')

        transport = po.transport_cost or Decimal('0.00')
        other = po.other_charges or Decimal('0.00')
        total_purchases = taxable_amount + transport + other
        total_gst = cgst_amount + sgst_amount + igst_amount
        total_payable = total_purchases + total_gst + (po.round_off or Decimal('0.00'))

        entry = JournalEntry.objects.create(
            date=po.bill_date or po.created_at.date(),
            narration=f"Purchase Invoice: {po.bill_no} from Supplier ID {po.supplier_id}",
            voucher_type='PURCHASE',
            reference_type='PurchaseOrder',
            reference_id=po_id,
            location_id=po.location_id,
        )

        if total_purchases > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('PURCHASES'), debit=total_purchases)
        if cgst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_CGST'), debit=cgst_amount)
        if sgst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_SGST'), debit=sgst_amount)
        if igst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_IGST'), debit=igst_amount)
        if total_payable > 0:
            JournalEntryLine.objects.create(
                entry=entry,
                account=self._acct('TRADE_PAYABLES'),
                credit=total_payable,
                party_type='Supplier',
                party_id=po.supplier_id,
            )
        # Round-off: po.round_off was folded into total_payable; balance the JE
        # by debiting Round Off (or crediting if negative).
        round_off = po.round_off or Decimal('0.00')
        if round_off != Decimal('0.00'):
            round_off_ac = self._accounts.get('ROUND_OFF')
            if round_off_ac:
                if round_off > 0:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, debit=round_off)
                else:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, credit=abs(round_off))

        entry.post()
        return entry

    @transaction.atomic
    def generate_pos_sale(self, pos_id):
        """Generate journal entry for a POS sale.

        POS line totals are tax-inclusive (MRP-based). The order-level
        gst_percent is unreliable in the source data (always 0); per-line
        tax_percent carries the actual rate. We aggregate taxable + tax
        per line to support mixed-rate carts and emit Output GST credits.
        """
        if self._entry_exists('POSOrder', pos_id):
            return None

        pos = POSOrderRO.objects.prefetch_related('lines').get(id=pos_id)
        if pos.status not in ('confirmed', 'completed'):
            return None

        # Customer state may be set if the customer is registered/B2C-Large.
        supply_type = 'intra_state'
        if pos.customer_id:
            try:
                from inventory_reader.models import CustomerRO
                customer = CustomerRO.objects.get(id=pos.customer_id)
                if customer.gst_no:
                    supply_type = self._get_supply_type(customer.gst_no)
            except Exception:
                pass

        # Aggregate per-line: each line's line_total is tax-inclusive at line.tax_percent.
        sales_amount = Decimal('0.00')
        cgst = Decimal('0.00')
        sgst = Decimal('0.00')
        igst = Decimal('0.00')

        for line in pos.lines.all():
            line_total = Decimal(str(line.line_total or 0))
            line_taxable = back_calculate_taxable(line_total, line.tax_percent)
            line_tax = line_total - line_taxable
            sales_amount += line_taxable

            if supply_type == 'inter_state':
                igst += line_tax
            else:
                half = (line_tax / Decimal('2')).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
                cgst += half
                sgst += line_tax - half

        sales_amount = sales_amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        cgst = cgst.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        sgst = sgst.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        igst = igst.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

        total = pos.total_amount

        entry = JournalEntry.objects.create(
            date=pos.sale_date.date() if hasattr(pos.sale_date, 'date') else pos.sale_date,
            narration=f"POS Sale: {pos.invoice_no}",
            voucher_type='SALE',
            reference_type='POSOrder',
            reference_id=pos_id,
            location_id=pos.location_id,
        )

        debit_ac = self._acct('TRADE_RECEIVABLES') if pos.payment_type == 'Credit' else self._acct('CASH')

        if total > 0:
            JournalEntryLine.objects.create(entry=entry, account=debit_ac, debit=total)
        if sales_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('SALES_POS'), credit=sales_amount)
        if cgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_CGST'), credit=cgst)
        if sgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_SGST'), credit=sgst)
        if igst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_IGST'), credit=igst)

        # Round-off absorbs sub-rupee drift between debit (gross) and sum of credits.
        diff = total - (sales_amount + cgst + sgst + igst)
        if diff != Decimal('0.00') and abs(diff) < Decimal('1.00'):
            round_off_ac = self._accounts.get('ROUND_OFF')
            if round_off_ac:
                if diff > 0:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, credit=diff)
                else:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, debit=abs(diff))

        entry.post()
        return entry

    @transaction.atomic
    def generate_b2b_sale(self, b2b_id):
        """Generate journal entry for a B2B sales order with proper IGST support."""
        if self._entry_exists('B2BSalesOrder', b2b_id):
            return None

        order = B2BSalesOrderRO.objects.select_related('customer').prefetch_related('lines').get(id=b2b_id)
        if order.status not in ('confirmed', 'delivered', 'invoiced'):
            return None

        total = order.total_amount

        # B2B is tax-exclusive: subtotal is the taxable base
        taxable = order.subtotal - order.discount_amount

        # Always re-derive supply_type from the customer GSTIN against the company state.
        supply_type = self._get_supply_type(
            order.customer.gst_no if order.customer else ''
        )

        # Source line tax fields (cgst_amount/sgst_amount/igst_amount) carry the inventory's
        # classification — the magnitude is right but the bucket may be wrong. Sum the total
        # tax across lines, then re-split per the freshly-derived supply_type.
        total_tax = sum(
            (Decimal(str(l.cgst_amount or 0)) +
             Decimal(str(l.sgst_amount or 0)) +
             Decimal(str(l.igst_amount or 0)))
            for l in order.lines.all()
        )
        if supply_type == 'inter_state':
            cgst, sgst, igst = Decimal('0.00'), Decimal('0.00'), total_tax
        else:
            half = (total_tax / Decimal('2')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            cgst, sgst, igst = half, total_tax - half, Decimal('0.00')

        sales_amount = taxable

        entry = JournalEntry.objects.create(
            date=order.sale_date or order.created_at.date(),
            narration=f"B2B Sale: {order.invoice_no} to Customer ID {order.customer_id}",
            voucher_type='SALE',
            reference_type='B2BSalesOrder',
            reference_id=b2b_id,
            location_id=order.location_id,
        )

        if total > 0:
            JournalEntryLine.objects.create(
                entry=entry,
                account=self._acct('TRADE_RECEIVABLES'),
                debit=total,
                party_type='Customer',
                party_id=order.customer_id,
            )
        if sales_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('SALES_B2B'), credit=sales_amount)
        if cgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_CGST'), credit=cgst)
        if sgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_SGST'), credit=sgst)
        if igst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_IGST'), credit=igst)

        # Round-off for sub-rupee drift between debit (gross) and credits.
        diff = total - (sales_amount + cgst + sgst + igst)
        if diff != Decimal('0.00') and abs(diff) < Decimal('1.00'):
            round_off_ac = self._accounts.get('ROUND_OFF')
            if round_off_ac:
                if diff > 0:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, credit=diff)
                else:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, debit=abs(diff))

        entry.post()
        return entry

    @transaction.atomic
    def generate_sales_return(self, return_id):
        """Generate journal entry for a sales return with proper IGST support.

        SalesReturnLineRO carries the per-line tax_percent; the parent's
        gst_percent is unreliable in source data. Aggregate per line for
        mixed-rate carts and emit Output GST debit reversals.
        """
        if self._entry_exists('SalesReturn', return_id):
            return None

        ret = SalesReturnRO.objects.select_related('customer').prefetch_related('lines').get(id=return_id)
        if ret.status not in ('confirmed', 'completed'):
            return None

        if ret.return_type == 'b2b':
            supply_type = self._get_supply_type(ret.customer.gst_no if ret.customer else '')
        else:
            supply_type = 'intra_state'

        # Per-line aggregation. POS returns: line_total is tax-inclusive.
        # B2B returns: line_total is tax-exclusive (taxable amount itself).
        sales_amount = Decimal('0.00')
        cgst = Decimal('0.00')
        sgst = Decimal('0.00')
        igst = Decimal('0.00')

        # SalesReturnLineRO.line_total is tax-INCLUSIVE for both POS and B2B returns
        # (verified against live source data: line_totals sum to ret.subtotal, which
        # already includes tax — unlike B2BSalesOrderRO where subtotal is ex-tax).
        for line in ret.lines.all():
            line_total = Decimal(str(line.line_total or 0))
            line_taxable = back_calculate_taxable(line_total, line.tax_percent)
            line_tax = line_total - line_taxable
            sales_amount += line_taxable

            if supply_type == 'inter_state':
                igst += line_tax
            else:
                half = (line_tax / Decimal('2')).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
                cgst += half
                sgst += line_tax - half

        sales_amount = sales_amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        cgst = cgst.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        sgst = sgst.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        igst = igst.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

        total = ret.total_amount

        entry = JournalEntry.objects.create(
            date=ret.return_date.date() if hasattr(ret.return_date, 'date') else ret.return_date,
            narration=f"Sales Return: {ret.return_no}",
            voucher_type='CREDIT_NOTE',
            reference_type='SalesReturn',
            reference_id=return_id,
            location_id=ret.location_id,
        )

        if sales_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('SALES_RETURNS'), debit=sales_amount)
        if cgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_CGST'), debit=cgst)
        if sgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_SGST'), debit=sgst)
        if igst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_IGST'), debit=igst)

        # Credit: receivable (B2B) or cash (POS)
        credit_ac = self._acct('TRADE_RECEIVABLES') if ret.return_type == 'b2b' else self._acct('CASH')
        if total > 0:
            JournalEntryLine.objects.create(entry=entry, account=credit_ac, credit=total)

        # Round-off absorbs sub-rupee drift so the JE always balances.
        debit_total = sales_amount + cgst + sgst + igst
        diff = debit_total - total
        if diff != Decimal('0.00') and abs(diff) < Decimal('1.00'):
            round_off_ac = self._accounts.get('ROUND_OFF')
            if round_off_ac:
                # Round Off normally absorbs as a debit/credit on the side that's short.
                if diff > 0:
                    # Debits exceed credits → credit Round Off to balance.
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, credit=diff)
                else:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, debit=abs(diff))

        entry.post()
        return entry

    @transaction.atomic
    def generate_purchase_return(self, return_id):
        """Generate journal entry for a purchase return (Phase 4A)."""
        if self._entry_exists('PurchaseReturn', return_id):
            return None

        ret = PurchaseReturnRO.objects.select_related('supplier').prefetch_related('lines').get(id=return_id)
        if ret.status not in ('confirmed', 'completed', 'approved'):
            return None

        taxable_amount = Decimal('0.00')
        cgst_amount = Decimal('0.00')
        sgst_amount = Decimal('0.00')
        igst_amount = Decimal('0.00')

        supply_type = self._get_supply_type(
            ret.supplier.gst_no if ret.supplier else ''
        )

        # Same approach as generate_purchase: sum total tax from lines, then re-split
        # per our supply_type so any inventory-side miscategorization is corrected.
        lines_data = list(ret.lines.all())
        for line in lines_data:
            taxable_amount += Decimal(str(line.quantity)) * line.purchase_rate

        total_tax = sum(
            (Decimal(str(l.cgst_amount or 0)) +
             Decimal(str(l.sgst_amount or 0)) +
             Decimal(str(l.igst_amount or 0)))
            for l in lines_data
        )
        if total_tax == Decimal('0.00'):
            for line in lines_data:
                line_taxable = Decimal(str(line.quantity)) * line.purchase_rate
                line_tax = (line_taxable * Decimal(str(line.tax_percent or 0)) / Decimal('100')).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
                total_tax += line_tax

        if supply_type == 'inter_state':
            cgst_amount, sgst_amount, igst_amount = Decimal('0.00'), Decimal('0.00'), total_tax
        else:
            half = (total_tax / Decimal('2')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            cgst_amount, sgst_amount, igst_amount = half, total_tax - half, Decimal('0.00')

        total_return = taxable_amount + cgst_amount + sgst_amount + igst_amount

        entry = JournalEntry.objects.create(
            date=ret.return_date,
            narration=f"Purchase Return: {ret.return_no} to Supplier ID {ret.supplier_id}",
            voucher_type='DEBIT_NOTE',
            reference_type='PurchaseReturn',
            reference_id=return_id,
            location_id=ret.location_id,
        )

        # Debit: Trade Payables (reduce liability)
        if total_return > 0:
            JournalEntryLine.objects.create(
                entry=entry,
                account=self._acct('TRADE_PAYABLES'),
                debit=total_return,
                party_type='Supplier',
                party_id=ret.supplier_id,
            )
        # Credit: Purchase Returns (contra-expense)
        purchase_returns_ac = self._accounts.get('PURCHASE_RETURNS')
        if purchase_returns_ac and taxable_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=purchase_returns_ac, credit=taxable_amount)
        # Credit: Reverse ITC
        if cgst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_CGST'), credit=cgst_amount)
        if sgst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_SGST'), credit=sgst_amount)
        if igst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_IGST'), credit=igst_amount)

        entry.post()
        return entry

    @transaction.atomic
    def generate_rcm_entry(self, rcm_data):
        """Generate journal entry for RCM (Phase 2F).
        rcm_data: dict with supplier_name, service_type, taxable_value, gst_rate, supply_type, etc.
        """
        supply_type = rcm_data.get('supply_type', 'intra_state')
        taxable = Decimal(str(rcm_data['taxable_value']))
        gst_rate = Decimal(str(rcm_data['gst_rate']))

        split = compute_tax_split(taxable, gst_rate, supply_type)

        entry = JournalEntry.objects.create(
            date=rcm_data['date'],
            narration=f"RCM: {rcm_data['service_type']} from {rcm_data['supplier_name']}",
            voucher_type='JOURNAL',
            reference_type='RCM',
            location_id=rcm_data.get('location_id'),
        )

        # Debit: Input GST (claimable ITC on RCM)
        if split['cgst'] > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_CGST'), debit=split['cgst'])
        if split['sgst'] > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_SGST'), debit=split['sgst'])
        if split['igst'] > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_IGST'), debit=split['igst'])

        # Credit: RCM GST Liability
        rcm_ac = self._accounts.get('RCM_LIABILITY')
        total_gst = split['cgst'] + split['sgst'] + split['igst']
        if rcm_ac and total_gst > 0:
            JournalEntryLine.objects.create(entry=entry, account=rcm_ac, credit=total_gst)

        entry.post()
        return entry

    @transaction.atomic
    def generate_payment(self, data):
        """Generate payment journal entry (Phase 4C). Manual trigger."""
        entry = JournalEntry.objects.create(
            date=data['date'],
            narration=data.get('narration', 'Payment'),
            voucher_type='PAYMENT',
            reference_type='Manual',
            location_id=data.get('location_id'),
        )

        amount = Decimal(str(data['amount']))
        payment_mode = data.get('payment_mode', 'bank')

        # Debit: Trade Payables
        JournalEntryLine.objects.create(
            entry=entry,
            account=self._acct('TRADE_PAYABLES'),
            debit=amount,
            party_type='Supplier',
            party_id=data.get('party_id'),
        )
        # Credit: Bank or Cash
        credit_ac = self._acct('BANK') if payment_mode == 'bank' else self._acct('CASH')
        JournalEntryLine.objects.create(entry=entry, account=credit_ac, credit=amount)

        entry.post()
        return entry

    @transaction.atomic
    def generate_receipt(self, data):
        """Generate receipt journal entry (Phase 4C). Manual trigger."""
        entry = JournalEntry.objects.create(
            date=data['date'],
            narration=data.get('narration', 'Receipt'),
            voucher_type='RECEIPT',
            reference_type='Manual',
            location_id=data.get('location_id'),
        )

        amount = Decimal(str(data['amount']))
        receipt_mode = data.get('receipt_mode', 'bank')

        # Debit: Bank or Cash
        debit_ac = self._acct('BANK') if receipt_mode == 'bank' else self._acct('CASH')
        JournalEntryLine.objects.create(entry=entry, account=debit_ac, debit=amount)
        # Credit: Trade Receivables
        JournalEntryLine.objects.create(
            entry=entry,
            account=self._acct('TRADE_RECEIVABLES'),
            credit=amount,
            party_type='Customer',
            party_id=data.get('party_id'),
        )

        entry.post()
        return entry

    @transaction.atomic
    def post_inventory_adjustment(self, *, date, location_id, value: Decimal,
                                  adjustment_type: str = 'shrinkage',
                                  itc_to_reverse: Decimal = Decimal('0.00'),
                                  narration: str = '', user=None):
        """
        Inventory adjustment for shrinkage / damage / count variance.

        Books:
            Dr Inventory Loss (P&L)         value
            Dr Input GST (reversal)         itc_to_reverse  ← per CGST §17(5)(h)
                Cr Closing Stock (Asset)        value
                Cr Input GST                    itc_to_reverse

        Wait — re-reading §17(5)(h): for goods lost/stolen/destroyed/written-off,
        ITC originally claimed must be REVERSED (i.e., Dr Inventory Loss /
        Cr Input GST), and the GST becomes part of the loss. So the correct
        entry is:
            Dr Inventory Loss               (value + itc_to_reverse)
                Cr Closing Stock                value
                Cr Input GST                    itc_to_reverse

        `adjustment_type` determines the loss-account mapping (shrinkage vs damage).
        """
        value = Decimal(str(value))
        itc = Decimal(str(itc_to_reverse))
        if value <= 0:
            raise ValueError('Adjustment value must be positive.')

        loss_acct = self._acct('INVENTORY_LOSS')
        stock_acct = self._acct('CLOSING_STOCK')

        je = JournalEntry.objects.create(
            date=date,
            narration=(narration or
                       f'Inventory {adjustment_type} adjustment'),
            voucher_type='JOURNAL', reference_type='Manual',
            location_id=location_id, created_by=user,
        )
        JournalEntryLine.objects.create(entry=je, account=loss_acct,
                                        debit=value + itc)
        JournalEntryLine.objects.create(entry=je, account=stock_acct,
                                        credit=value)
        if itc > 0:
            # Reverse from CGST/SGST/IGST mix — caller should split by type.
            # Simpler default: reverse from CGST + SGST 50:50.
            half = (itc / 2).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            JournalEntryLine.objects.create(entry=je,
                                            account=self._acct('INPUT_CGST'),
                                            credit=half)
            JournalEntryLine.objects.create(entry=je,
                                            account=self._acct('INPUT_SGST'),
                                            credit=itc - half)
        je.post()
        return je

    @transaction.atomic
    def post_drug_expiry_writeoff(self, *, date, location_id,
                                  value_at_cost: Decimal,
                                  itc_to_reverse: Decimal = Decimal('0.00'),
                                  narration: str = '', user=None):
        """Pharmacy-specific: expired drugs are destroyed → §17(5)(h) ITC reversal.

        Same balance-sheet impact as inventory adjustment but lands in the
        Expiry Loss P&L line so management can see expiry separately from
        general shrinkage.
        """
        value = Decimal(str(value_at_cost))
        itc = Decimal(str(itc_to_reverse))
        if value <= 0:
            raise ValueError('Write-off value must be positive.')

        je = JournalEntry.objects.create(
            date=date,
            narration=narration or 'Expired drug stock write-off',
            voucher_type='JOURNAL', reference_type='Manual',
            location_id=location_id, created_by=user,
        )
        JournalEntryLine.objects.create(entry=je,
                                        account=self._acct('EXPIRY_LOSS'),
                                        debit=value + itc)
        JournalEntryLine.objects.create(entry=je,
                                        account=self._acct('CLOSING_STOCK'),
                                        credit=value)
        if itc > 0:
            half = (itc / 2).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            JournalEntryLine.objects.create(entry=je,
                                            account=self._acct('INPUT_CGST'),
                                            credit=half)
            JournalEntryLine.objects.create(entry=je,
                                            account=self._acct('INPUT_SGST'),
                                            credit=itc - half)
        je.post()
        return je

    @transaction.atomic
    def post_closing_stock_adjustment(self, *, date, value: Decimal,
                                      location_id: int = None,
                                      narration: str = '', user=None):
        """
        Period-end closing-stock JV — the entry that the periodic-inventory
        system needs to make the balance sheet correct.

        Mechanics:
          1. Caller passes the *target* balance for Closing Stock — typically
             from a physical count (or from `reports.StockValuationView`).
          2. Service computes existing balance and posts only the *delta*.
          3. Counter-leg goes to Purchases — increasing Closing Stock reduces
             Purchases (and therefore boosts net profit by the same amount),
             keeping the equation Assets = Liabilities + Equity in balance.

        Books:
          delta > 0 (more stock on hand than already booked):
              Dr Closing Stock          delta
                  Cr Purchases (5100)       delta   [reverses over-expensing]

          delta < 0 (less on hand — e.g. shrinkage caught at count):
              Dr Purchases              |delta|
                  Cr Closing Stock          |delta|

        Idempotent at the *value* level — re-call with same target → no-op.
        """
        target = Decimal(str(value))
        if target < 0:
            raise ValueError('Closing-stock value cannot be negative.')

        closing_stock = self._acct('CLOSING_STOCK')
        purchases = self._acct('PURCHASES')

        # Existing balance on Closing Stock up to `date`
        from django.db.models import Sum
        agg = JournalEntryLine.objects.filter(
            account=closing_stock, entry__is_posted=True, entry__date__lte=date,
        )
        if location_id is not None:
            agg = agg.filter(entry__location_id=location_id)
        agg = agg.aggregate(d=Sum('debit'), c=Sum('credit'))
        existing = (agg['d'] or Decimal('0')) - (agg['c'] or Decimal('0'))

        delta = target - existing
        if abs(delta) < Decimal('0.01'):
            return None  # already at target — no JV needed

        je = JournalEntry.objects.create(
            date=date,
            narration=(narration or
                       f'Closing stock adjustment as of {date} '
                       f'(target ₹{target}, existing ₹{existing})'),
            voucher_type='JOURNAL', reference_type='Manual',
            location_id=location_id, created_by=user,
        )
        if delta > 0:
            JournalEntryLine.objects.create(entry=je, account=closing_stock,
                                            debit=delta)
            JournalEntryLine.objects.create(entry=je, account=purchases,
                                            credit=delta)
        else:
            JournalEntryLine.objects.create(entry=je, account=purchases,
                                            debit=-delta)
            JournalEntryLine.objects.create(entry=je, account=closing_stock,
                                            credit=-delta)
        je.post()
        return je

    @transaction.atomic
    def post_stock_transfer(self, *, date, value: Decimal,
                            from_location_id: int, to_location_id: int,
                            narration: str = '', user=None):
        """
        Inter-branch stock transfer. Two entries to keep each location's
        books square:

        At source location:
            Dr Stock-in-Transit
                Cr Closing Stock (source)
        At destination location:
            Dr Closing Stock (destination)
                Cr Stock-in-Transit

        We post these as ONE pair of JEs so the in-transit account nets to
        zero across the consolidated entity.
        """
        value = Decimal(str(value))
        if value <= 0:
            raise ValueError('Transfer value must be positive.')
        if from_location_id == to_location_id:
            raise ValueError('Source and destination locations must differ.')

        transit = self._acct('STOCK_TRANSFER_TRANSIT')
        stock = self._acct('CLOSING_STOCK')

        out_je = JournalEntry.objects.create(
            date=date,
            narration=(narration or
                       f'Stock transfer OUT to location {to_location_id}'),
            voucher_type='JOURNAL', reference_type='Manual',
            location_id=from_location_id, created_by=user,
        )
        JournalEntryLine.objects.create(entry=out_je, account=transit, debit=value)
        JournalEntryLine.objects.create(entry=out_je, account=stock, credit=value)
        out_je.post()

        in_je = JournalEntry.objects.create(
            date=date,
            narration=(narration or
                       f'Stock transfer IN from location {from_location_id}'),
            voucher_type='JOURNAL', reference_type='Manual',
            location_id=to_location_id, created_by=user,
        )
        JournalEntryLine.objects.create(entry=in_je, account=stock, debit=value)
        JournalEntryLine.objects.create(entry=in_je, account=transit, credit=value)
        in_je.post()

        return {'out_entry': out_je, 'in_entry': in_je}

    @transaction.atomic
    def generate_contra(self, data):
        """Generate contra journal entry (Phase 4C). Manual trigger."""
        entry = JournalEntry.objects.create(
            date=data['date'],
            narration=data.get('narration', 'Contra Entry'),
            voucher_type='CONTRA',
            reference_type='Manual',
            location_id=data.get('location_id'),
        )

        amount = Decimal(str(data['amount']))
        direction = data.get('direction', 'bank_to_cash')  # or 'cash_to_bank'

        if direction == 'bank_to_cash':
            JournalEntryLine.objects.create(entry=entry, account=self._acct('CASH'), debit=amount)
            JournalEntryLine.objects.create(entry=entry, account=self._acct('BANK'), credit=amount)
        else:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('BANK'), debit=amount)
            JournalEntryLine.objects.create(entry=entry, account=self._acct('CASH'), credit=amount)

        entry.post()
        return entry


# ─── Recurring journal entries ──────────────────────────────────────────────

from calendar import monthrange


def _add_months(d, n):
    from datetime import date as date_cls
    month = d.month - 1 + n
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date_cls(year, month, day)


def advance_journal_date(d, frequency):
    from datetime import timedelta
    if frequency == 'daily':
        return d + timedelta(days=1)
    if frequency == 'weekly':
        return d + timedelta(days=7)
    if frequency == 'monthly':
        return _add_months(d, 1)
    if frequency == 'quarterly':
        return _add_months(d, 3)
    if frequency == 'yearly':
        return _add_months(d, 12)
    raise ValueError(f'Unknown frequency: {frequency}')


def _format_narration(template, d):
    if not template:
        return ''
    return (template
            .replace('{YYYY-MM}', d.strftime('%Y-%m'))
            .replace('{YYYY}', d.strftime('%Y'))
            .replace('{MM}', d.strftime('%m'))
            .replace('{DD}', d.strftime('%d'))
            .replace('{MON}', d.strftime('%b').upper()))


@transaction.atomic
def generate_one_recurring_journal(rj: RecurringJournal, *, user=None) -> JournalEntry:
    """Create a single JournalEntry from this recurring template at rj.next_run_date."""
    from django.core.exceptions import ValidationError
    if rj.status != 'active':
        raise ValidationError(f'Recurring journal is {rj.status}, not active.')
    lines = list(rj.lines.all())
    if not lines:
        raise ValidationError('Add at least one line to the recurring journal template.')
    total_dr = sum((l.debit for l in lines), Decimal('0.00'))
    total_cr = sum((l.credit for l in lines), Decimal('0.00'))
    if total_dr != total_cr or total_dr == 0:
        raise ValidationError(f'Template is unbalanced: Dr {total_dr} ≠ Cr {total_cr}.')

    entry_date = rj.next_run_date
    narration = _format_narration(rj.narration_template, entry_date) or rj.profile_name

    entry = JournalEntry.objects.create(
        date=entry_date,
        narration=narration,
        voucher_type=rj.voucher_type,
        reference_type='Manual',
        location_id=rj.location_id,
        created_by=user,
    )
    for tl in lines:
        JournalEntryLine.objects.create(
            entry=entry, account=tl.account,
            debit=tl.debit, credit=tl.credit,
            narration=tl.narration,
            party_type=tl.party_type, party_id=tl.party_id,
        )
    if rj.auto_post:
        try:
            entry.post()
        except Exception as e:
            rj.last_error = str(e)
        else:
            rj.last_error = ''
    else:
        rj.last_error = ''

    rj.last_run_date = entry_date
    rj.next_run_date = advance_journal_date(entry_date, rj.frequency)
    if rj.end_date and rj.next_run_date > rj.end_date:
        rj.status = 'stopped'
    rj.save()
    return entry


def generate_due_recurring_journals(*, today=None, user=None) -> dict:
    from datetime import date as date_cls
    from django.core.exceptions import ValidationError
    today = today or date_cls.today()
    created = []
    errors = []
    profiles = list(RecurringJournal.objects.filter(status='active', next_run_date__lte=today))
    for rj in profiles:
        guard = 0
        while rj.status == 'active' and rj.next_run_date <= today and guard < 60:
            try:
                e = generate_one_recurring_journal(rj, user=user)
                created.append({'recurring_id': rj.id, 'entry_id': e.id, 'entry_no': e.entry_no})
            except ValidationError as exc:
                msg = exc.messages[0] if hasattr(exc, 'messages') else str(exc)
                errors.append({'recurring_id': rj.id, 'error': msg})
                rj.last_error = msg
                rj.status = 'paused'
                rj.save(update_fields=['last_error', 'status', 'updated_at'])
                break
            guard += 1
    return {'created': len(created), 'created_details': created, 'errors': errors,
            'today': today.isoformat()}

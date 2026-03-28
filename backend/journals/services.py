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
from core.gst_utils import compute_tax_split, detect_supply_type, back_calculate_taxable
from .models import JournalEntry, JournalEntryLine

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
        """Detect supply type using company GSTIN and counterparty GSTIN."""
        return detect_supply_type(self._settings.gstin, counterparty_gstin)

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

        supply_type = po.supply_type or self._get_supply_type(po.supplier.gst_no if po.supplier else '')

        for line in lines_data:
            qty = Decimal(str(line.quantity + line.free_qty))
            rate = line.purchase_rate
            discount_factor = (Decimal('100') - line.discount_percent) / Decimal('100')
            line_taxable = qty * rate * discount_factor
            taxable_amount += line_taxable

            # Use pre-computed line-level tax if available, otherwise compute
            if line.cgst_amount or line.sgst_amount or line.igst_amount:
                cgst_amount += Decimal(str(line.cgst_amount or 0))
                sgst_amount += Decimal(str(line.sgst_amount or 0))
                igst_amount += Decimal(str(line.igst_amount or 0))
            else:
                split = compute_tax_split(line_taxable, line.tax_percent, supply_type)
                cgst_amount += split['cgst']
                sgst_amount += split['sgst']
                igst_amount += split['igst']

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

        entry.post()
        return entry

    @transaction.atomic
    def generate_pos_sale(self, pos_id):
        """Generate journal entry for a POS sale. POS prices are tax-inclusive (MRP-based)."""
        if self._entry_exists('POSOrder', pos_id):
            return None

        pos = POSOrderRO.objects.get(id=pos_id)
        if pos.status not in ('confirmed', 'completed'):
            return None

        total = pos.total_amount
        gst_rate = pos.gst_percent

        # POS is tax-inclusive: back-calculate the taxable base
        inclusive_amount = pos.subtotal - pos.discount_amount
        taxable_base = back_calculate_taxable(inclusive_amount, gst_rate)

        # POS defaults to intra-state; could be inter-state for B2C-Large via customer state
        supply_type = 'intra_state'
        if pos.customer_id:
            try:
                from inventory_reader.models import CustomerRO
                customer = CustomerRO.objects.get(id=pos.customer_id)
                if customer.gst_no:
                    supply_type = self._get_supply_type(customer.gst_no)
            except Exception:
                pass

        split = compute_tax_split(taxable_base, gst_rate, supply_type)
        cgst = split['cgst']
        sgst = split['sgst']
        igst = split['igst']
        sales_amount = taxable_base

        entry = JournalEntry.objects.create(
            date=pos.sale_date.date() if hasattr(pos.sale_date, 'date') else pos.sale_date,
            narration=f"POS Sale: {pos.invoice_no}",
            voucher_type='SALE',
            reference_type='POSOrder',
            reference_id=pos_id,
            location_id=pos.location_id,
        )

        # Debit: Cash or Receivables
        if pos.payment_type == 'Credit':
            debit_ac = self._acct('TRADE_RECEIVABLES')
        else:
            debit_ac = self._acct('CASH')

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

        # Handle rounding difference
        credit_total = sales_amount + cgst + sgst + igst
        diff = total - credit_total
        if abs(diff) > Decimal('0.00') and abs(diff) < Decimal('1.00'):
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

        order = B2BSalesOrderRO.objects.select_related('customer').get(id=b2b_id)
        if order.status not in ('confirmed', 'delivered', 'invoiced'):
            return None

        total = order.total_amount

        # B2B is tax-exclusive: subtotal is the taxable base
        taxable = order.subtotal - order.discount_amount
        gst_rate = order.gst_percent

        # Use pre-computed supply type / tax splits if available
        supply_type = order.supply_type or self._get_supply_type(
            order.customer.gst_no if order.customer else ''
        )

        if order.total_cgst or order.total_sgst or order.total_igst:
            cgst = Decimal(str(order.total_cgst or 0))
            sgst = Decimal(str(order.total_sgst or 0))
            igst = Decimal(str(order.total_igst or 0))
        else:
            split = compute_tax_split(taxable, gst_rate, supply_type)
            cgst = split['cgst']
            sgst = split['sgst']
            igst = split['igst']

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

        entry.post()
        return entry

    @transaction.atomic
    def generate_sales_return(self, return_id):
        """Generate journal entry for a sales return with proper IGST support."""
        if self._entry_exists('SalesReturn', return_id):
            return None

        ret = SalesReturnRO.objects.select_related('customer').get(id=return_id)
        if ret.status not in ('confirmed', 'completed'):
            return None

        total = ret.total_amount
        gst_rate = ret.gst_percent

        if ret.return_type == 'pos':
            # POS returns are tax-inclusive
            inclusive_amount = ret.subtotal - ret.discount_amount
            taxable_base = back_calculate_taxable(inclusive_amount, gst_rate)
            supply_type = 'intra_state'
        else:
            # B2B returns are tax-exclusive
            taxable_base = ret.subtotal - ret.discount_amount
            supply_type = self._get_supply_type(ret.customer.gst_no if ret.customer else '')

        split = compute_tax_split(taxable_base, gst_rate, supply_type)
        cgst = split['cgst']
        sgst = split['sgst']
        igst = split['igst']
        sales_amount = taxable_base

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

        supply_type = ret.supply_type or self._get_supply_type(
            ret.supplier.gst_no if ret.supplier else ''
        )

        for line in ret.lines.all():
            line_taxable = Decimal(str(line.quantity)) * line.purchase_rate
            taxable_amount += line_taxable

            if line.cgst_amount or line.sgst_amount or line.igst_amount:
                cgst_amount += Decimal(str(line.cgst_amount or 0))
                sgst_amount += Decimal(str(line.sgst_amount or 0))
                igst_amount += Decimal(str(line.igst_amount or 0))
            else:
                split = compute_tax_split(line_taxable, line.tax_percent, supply_type)
                cgst_amount += split['cgst']
                sgst_amount += split['sgst']
                igst_amount += split['igst']

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

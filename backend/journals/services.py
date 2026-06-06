import logging
from decimal import Decimal
from django.db import transaction
from django.db.models import Sum
from inventory_reader.models import (
    PurchaseOrderRO,
    PurchaseOrderLineRO,
    POSOrderRO,
    B2BSalesOrderRO,
    SalesReturnRO,
    PurchaseReturnRO,
    OpeningStockRO,
    OpeningStockLineRO,
    StockMovementRO,
    PettyCashTxnRO,
)
from core.models import AccountMapping, AccountingSettings
from core.party_ledgers import resolve_party_account
from decimal import ROUND_HALF_UP
from core.gst_utils import (
    compute_tax_split, detect_supply_type, back_calculate_taxable,
    state_name_to_code,
)
from .models import JournalEntry, JournalEntryLine, RecurringJournal, RecurringJournalLine

logger = logging.getLogger('journals')


class JournalAutoGenerationService:

    def __init__(self):
        """Initialise per-instance caches; mappings are resolved lazily per
        (key, location_id) so per-store overrides take effect without a
        service restart. See [[per-location-coa]]."""
        self._settings = AccountingSettings.get_settings()
        # (key, location_id_or_None) → ChartOfAccount
        self._acct_cache = {}
        # Legacy: callers that haven't been threaded through with location
        # still hit this dict (NULL-location defaults only).
        self._accounts = AccountMapping.get_all_mappings()

    def _acct(self, key, location_id=None):
        """Get the ChartOfAccount mapped to `key`, preferring the row scoped
        to `location_id` and falling back to the NULL-location default.
        Raises ValueError when no mapping exists at either scope."""
        cache_key = (key, location_id)
        cached = self._acct_cache.get(cache_key)
        if cached is not None:
            return cached
        # AccountMapping.get_account handles the fallback ordering.
        acct = AccountMapping.get_account(key, location_id=location_id)
        self._acct_cache[cache_key] = acct
        return acct

    def _acct_or_none(self, key, location_id=None):
        """Non-raising variant of _acct for optional mappings (ROUND_OFF,
        COGS, CLOSING_STOCK fallbacks). Returns None if no mapping exists
        at either the per-location or NULL scope."""
        try:
            return self._acct(key, location_id)
        except ValueError:
            return None

    def _sale_settlement(self, payment_type, customer_id, loc):
        """Debit account + party tag for the customer side of a sale (shared by
        POS and B2B). A CREDIT sale to a named customer hits that customer's own
        ledger and is party-tagged so AR aging is accurate; cash / walk-in (or a
        credit sale with no customer) hits Cash / the generic control, untagged
        (a tag on a settled line would inflate AR aging)."""
        if payment_type == 'Credit':
            account = resolve_party_account(
                'Customer', customer_id, self._acct('TRADE_RECEIVABLES', loc))
            tag = dict(party_type='Customer', party_id=customer_id) if customer_id else {}
        else:
            account = self._acct('CASH', loc)
            tag = {}
        return account, tag

    def _entry_exists(self, reference_type, reference_id):
        return JournalEntry.objects.filter(
            reference_type=reference_type,
            reference_id=reference_id,
        ).exists()

    def _get_supply_type(self, counterparty_gstin, counterparty_state_code=''):
        """Detect supply type from the company state anchor and the counterparty.

        Falls back to the counterparty's 2-digit state code when their GSTIN is
        blank, so a no-GSTIN customer in another state is still classified
        inter-state — EXACTLY as GSTR1Generator does. Without this fallback the
        journal posted CGST+SGST (default intra) while the filed GSTR-1/3B showed
        IGST, so the GL tax head silently diverged from the return.
        """
        return detect_supply_type(
            self._settings.gstin,
            counterparty_gstin,
            self._settings.state_code,
            counterparty_state_code,
        )

    @staticmethod
    def _counterparty_state_code(party):
        """2-digit GST place-of-supply code from a customer/supplier RO's
        free-text state, or '' when the party or state is unknown."""
        if party is None:
            return ''
        return state_name_to_code(getattr(party, 'state', '') or '')

    def _product_avg_cost(self, product_id, location_id=None):
        """Quantity-weighted average cost per unit, in ₹.

        Weighs each receipt by the units it brought in and mirrors the exact
        value `generate_purchase` capitalises into 1190 Closing Stock — i.e.
        ``(quantity + free_qty) × purchase_rate × (1 − discount%)`` over
        ``(quantity + free_qty)`` units — so relieving COGS at this cost drains
        1190 back to zero once every received unit (free goods included) is sold.

        Opening-stock seeding is folded in at its own rate, so a product that
        was only ever seeded via Opening Stock (never purchased through a PO)
        still costs out correctly instead of relieving zero. Scoped to
        `location_id` when given so store A's sale uses store A's cost basis.

        Returns 0 only when the product has neither purchase nor opening-stock
        history at that scope. (A plain ``Avg('purchase_rate')`` — the prior
        implementation — ignored quantity, free goods, discount and location,
        overstating COGS up to tens of × on uneven lot sizes.)
        """
        from django.db.models import Sum, F, DecimalField, ExpressionWrapper

        money = DecimalField(max_digits=20, decimal_places=6)

        # Purchase receipts: value net of trade discount, weighted by units in.
        po_qs = PurchaseOrderLineRO.objects.filter(product_id=product_id)
        if location_id is not None:
            po_qs = po_qs.filter(purchase_order__location_id=location_id)
        po_value = ExpressionWrapper(
            (F('quantity') + F('free_qty')) * F('purchase_rate')
            * (Decimal('100') - F('discount_percent')) / Decimal('100'),
            output_field=money,
        )
        po_units = ExpressionWrapper(
            F('quantity') + F('free_qty'), output_field=money,
        )
        po = po_qs.aggregate(cost=Sum(po_value), qty=Sum(po_units))

        # Opening stock: rate × quantity (no free goods / discount on this path).
        os_qs = OpeningStockLineRO.objects.filter(product_id=product_id)
        if location_id is not None:
            os_qs = os_qs.filter(opening_stock__location_id=location_id)
        os_value = ExpressionWrapper(F('quantity') * F('purchase_rate'), output_field=money)
        os = os_qs.aggregate(cost=Sum(os_value), qty=Sum('quantity'))

        total_cost = Decimal(str(po['cost'] or 0)) + Decimal(str(os['cost'] or 0))
        total_qty = Decimal(str(po['qty'] or 0)) + Decimal(str(os['qty'] or 0))
        if total_qty <= 0:
            return Decimal('0')
        return (total_cost / total_qty).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)

    def _post_cogs(self, *, entry, lines):
        """Post Dr COGS / Cr Closing Stock for every line in a sale at avg cost.

        `lines` is an iterable of objects exposing `.product_id` and `.quantity`.
        Resolves COGS and Closing Stock at the entry's location so a sale at
        store A relieves store A's stock account, not a shared one.
        Returns the total COGS posted (or zero when no costed lines exist).
        """
        loc = entry.location_id
        cogs_acct = self._acct_or_none('COGS', loc)
        stock_acct = self._acct_or_none('CLOSING_STOCK', loc)
        if not cogs_acct or not stock_acct:
            return Decimal('0')
        total = Decimal('0')
        for line in lines:
            qty = Decimal(str(getattr(line, 'quantity', 0) or 0))
            if qty <= 0:
                continue
            cost = self._product_avg_cost(line.product_id, loc)
            value = (qty * cost).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            if value <= 0:
                continue
            total += value
        if total > 0:
            JournalEntryLine.objects.create(
                entry=entry, account=cogs_acct, debit=total,
                narration='COGS',
            )
            JournalEntryLine.objects.create(
                entry=entry, account=stock_acct, credit=total,
                narration='Stock relieved',
            )
        return total

    @transaction.atomic
    def generate_opening_stock(self, opening_stock_id):
        """Convert an inventory-side OpeningStock batch into a balanced JV.

        Books `Dr 1190 Closing Stock / Cr 3300 Opening Balance Equity` for
        the sum of (qty × purchase_rate) across all lines in the batch.
        Idempotent via reference_type='OpeningStock' so re-running sync
        won't double-post.
        """
        if self._entry_exists('OpeningStock', opening_stock_id):
            return None

        os_header = OpeningStockRO.objects.select_related('location').get(
            id=opening_stock_id,
        )
        lines = list(os_header.lines.all())

        total_value = Decimal('0.00')
        for line in lines:
            qty = Decimal(str(line.quantity or 0))
            rate = Decimal(str(line.purchase_rate or 0))
            total_value += (qty * rate).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

        if total_value <= 0:
            # Nothing to book — empty batch or all zero-value lines.
            return None

        entry_date = os_header.opening_date or os_header.created_at.date()
        loc = os_header.location_id
        entry = JournalEntry.objects.create(
            date=entry_date,
            narration=f'Opening Stock #{opening_stock_id} ({os_header.location.name})',
            voucher_type='JOURNAL',
            reference_type='OpeningStock',
            reference_id=opening_stock_id,
            location_id=loc,
        )
        JournalEntryLine.objects.create(
            entry=entry, account=self._acct('CLOSING_STOCK', loc),
            debit=total_value,
            narration='Opening stock — bring inventory onto the books',
        )
        JournalEntryLine.objects.create(
            entry=entry, account=self._acct('OPENING_BALANCE_EQUITY', loc),
            credit=total_value,
            narration='Opening balance equity',
        )
        entry.post()
        return entry

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

        loc = po.location_id
        entry = JournalEntry.objects.create(
            date=po.bill_date or po.created_at.date(),
            narration=f"Purchase Invoice: {po.bill_no} from Supplier ID {po.supplier_id}",
            voucher_type='PURCHASE',
            reference_type='PurchaseOrder',
            reference_id=po_id,
            location_id=loc,
        )

        if total_purchases > 0:
            JournalEntryLine.objects.create(
                entry=entry, account=self._acct('CLOSING_STOCK', loc), debit=total_purchases,
            )
        if cgst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_CGST', loc), debit=cgst_amount)
        if sgst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_SGST', loc), debit=sgst_amount)
        if igst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_IGST', loc), debit=igst_amount)
        if total_payable > 0:
            JournalEntryLine.objects.create(
                entry=entry,
                account=resolve_party_account(
                    'Supplier', po.supplier_id, self._acct('TRADE_PAYABLES', loc)),
                credit=total_payable,
                party_type='Supplier',
                party_id=po.supplier_id,
            )
        # Round-off: po.round_off was folded into total_payable; balance the JE
        # by debiting Round Off (or crediting if negative).
        round_off = po.round_off or Decimal('0.00')
        if round_off != Decimal('0.00'):
            round_off_ac = self._acct_or_none('ROUND_OFF', loc)
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

        # Resolve supply type from the customer's GSTIN, falling back to their
        # state — so an inter-state walk-in with no GSTIN still posts IGST and
        # the GL agrees with GSTR-1. No customer at all → intra (true OTC).
        supply_type = 'intra_state'
        if pos.customer_id:
            try:
                from inventory_reader.models import CustomerRO
                customer = CustomerRO.objects.get(id=pos.customer_id)
                supply_type = self._get_supply_type(
                    customer.gst_no, self._counterparty_state_code(customer))
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
        order_discount = Decimal(str(pos.discount_amount or 0))

        loc = pos.location_id
        entry = JournalEntry.objects.create(
            date=pos.sale_date.date() if hasattr(pos.sale_date, 'date') else pos.sale_date,
            narration=f"POS Sale: {pos.invoice_no}",
            voucher_type='SALE',
            reference_type='POSOrder',
            reference_id=pos_id,
            location_id=loc,
        )

        debit_ac, ar_party = self._sale_settlement(pos.payment_type, pos.customer_id, loc)
        if total > 0:
            JournalEntryLine.objects.create(
                entry=entry, account=debit_ac, debit=total, **ar_party)
        if sales_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('SALES_POS', loc), credit=sales_amount)
        if cgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_CGST', loc), credit=cgst)
        if sgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_SGST', loc), credit=sgst)
        if igst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_IGST', loc), credit=igst)

        # Order-level discount. Sales + Output GST are booked at the full
        # pre-discount line value, but the customer settles `total` (net of the
        # bill-level discount). Book the gap to Discount Allowed so the entry
        # balances while reported sales/output-tax stay gross. Without this leg
        # a discount > ₹1 left the JE unbalanced beyond the round-off band, so
        # entry.post() raised and the sync loop silently swallowed the whole
        # sale — revenue, output GST and COGS all vanished from the books.
        discount_posted = Decimal('0.00')
        if order_discount > 0:
            disc_ac = (self._acct_or_none('DISCOUNT_ALLOWED', loc)
                       or self._acct_or_none('ROUND_OFF', loc))
            if disc_ac:
                JournalEntryLine.objects.create(
                    entry=entry, account=disc_ac, debit=order_discount,
                    narration='Order-level discount',
                )
                discount_posted = order_discount

        # Round-off absorbs the remaining sub-rupee drift.
        diff = (total + discount_posted) - (sales_amount + cgst + sgst + igst)
        if diff != Decimal('0.00') and abs(diff) < Decimal('1.00'):
            round_off_ac = self._acct_or_none('ROUND_OFF', loc)
            if round_off_ac:
                if diff > 0:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, credit=diff)
                else:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, debit=abs(diff))

        # Relieve stock and post COGS in the same JE (perpetual inventory).
        self._post_cogs(entry=entry, lines=pos.lines.all())

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

        # Always re-derive supply_type from the customer GSTIN (state fallback)
        # against the company state, matching GSTR-1.
        supply_type = self._get_supply_type(
            order.customer.gst_no if order.customer else '',
            self._counterparty_state_code(order.customer if order.customer else None),
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

        loc = order.location_id
        entry = JournalEntry.objects.create(
            date=order.sale_date or order.created_at.date(),
            narration=f"B2B Sale: {order.invoice_no} to Customer ID {order.customer_id}",
            voucher_type='SALE',
            reference_type='B2BSalesOrder',
            reference_id=b2b_id,
            location_id=loc,
        )

        if total > 0:
            debit_ac, ar_party = self._sale_settlement(order.payment_type, order.customer_id, loc)
            JournalEntryLine.objects.create(
                entry=entry, account=debit_ac, debit=total, **ar_party)
        if sales_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('SALES_B2B', loc), credit=sales_amount)
        if cgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_CGST', loc), credit=cgst)
        if sgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_SGST', loc), credit=sgst)
        if igst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_IGST', loc), credit=igst)

        # Round-off for sub-rupee drift between debit (gross) and credits.
        diff = total - (sales_amount + cgst + sgst + igst)
        if diff != Decimal('0.00') and abs(diff) < Decimal('1.00'):
            round_off_ac = self._acct_or_none('ROUND_OFF', loc)
            if round_off_ac:
                if diff > 0:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, credit=diff)
                else:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, debit=abs(diff))

        # Relieve stock and post COGS in the same JE (perpetual inventory).
        self._post_cogs(entry=entry, lines=order.lines.all())

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

        # Mirror the original sale's classification (GSTIN, then state fallback)
        # so the credit-note reversal hits the same tax head GSTR-1 reports.
        supply_type = self._get_supply_type(
            ret.customer.gst_no if ret.customer else '',
            self._counterparty_state_code(ret.customer),
        )

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

        loc = ret.location_id
        entry = JournalEntry.objects.create(
            date=ret.return_date.date() if hasattr(ret.return_date, 'date') else ret.return_date,
            narration=f"Sales Return: {ret.return_no}",
            voucher_type='CREDIT_NOTE',
            reference_type='SalesReturn',
            reference_id=return_id,
            location_id=loc,
        )

        if sales_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('SALES_RETURNS', loc), debit=sales_amount)
        if cgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_CGST', loc), debit=cgst)
        if sgst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_SGST', loc), debit=sgst)
        if igst > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('OUTPUT_IGST', loc), debit=igst)

        # Credit side mirrors the original sale's settlement account:
        #   - POS returns always settle in cash (POS is cash-only in this app).
        #   - B2B returns where the original sale was Credit reverse the receivable.
        #   - B2B returns where the original sale was Cash/Bank/Card etc. refund cash.
        # Tagging party_type='Customer' on receivable returns keeps AR aging accurate
        # (reports/views.py:545 scopes aging to account_subtype='Receivable').
        if ret.return_type == 'b2b':
            orig = ret.original_b2b_order
            if orig and orig.payment_type == 'Credit':
                if total > 0:
                    JournalEntryLine.objects.create(
                        entry=entry,
                        account=resolve_party_account(
                            'Customer', ret.customer_id,
                            self._acct('TRADE_RECEIVABLES', loc)),
                        credit=total,
                        party_type='Customer',
                        party_id=ret.customer_id,
                    )
            else:
                if total > 0:
                    JournalEntryLine.objects.create(
                        entry=entry, account=self._acct('CASH', loc), credit=total,
                    )
        else:
            if total > 0:
                JournalEntryLine.objects.create(
                    entry=entry, account=self._acct('CASH', loc), credit=total,
                )

        # Round-off absorbs sub-rupee drift so the JE always balances.
        debit_total = sales_amount + cgst + sgst + igst
        diff = debit_total - total
        if diff != Decimal('0.00') and abs(diff) < Decimal('1.00'):
            round_off_ac = self._acct_or_none('ROUND_OFF', loc)
            if round_off_ac:
                # Round Off normally absorbs as a debit/credit on the side that's short.
                if diff > 0:
                    # Debits exceed credits → credit Round Off to balance.
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, credit=diff)
                else:
                    JournalEntryLine.objects.create(entry=entry, account=round_off_ac, debit=abs(diff))

        # Stock comes back in, reverse the COGS that was posted at sale time.
        cogs_acct = self._acct_or_none('COGS', loc)
        stock_acct = self._acct_or_none('CLOSING_STOCK', loc)
        if cogs_acct and stock_acct:
            cogs_total = Decimal('0')
            for line in ret.lines.all():
                qty = Decimal(str(getattr(line, 'quantity', 0) or 0))
                if qty <= 0:
                    continue
                cost = self._product_avg_cost(line.product_id, loc)
                value = (qty * cost).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                if value > 0:
                    cogs_total += value
            if cogs_total > 0:
                JournalEntryLine.objects.create(
                    entry=entry, account=stock_acct, debit=cogs_total,
                    narration='Stock returned',
                )
                JournalEntryLine.objects.create(
                    entry=entry, account=cogs_acct, credit=cogs_total,
                    narration='COGS reversed',
                )

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

        loc = ret.location_id
        entry = JournalEntry.objects.create(
            date=ret.return_date,
            narration=f"Purchase Return: {ret.return_no} to Supplier ID {ret.supplier_id}",
            voucher_type='DEBIT_NOTE',
            reference_type='PurchaseReturn',
            reference_id=return_id,
            location_id=loc,
        )

        # Debit: Trade Payables (reduce liability)
        if total_return > 0:
            JournalEntryLine.objects.create(
                entry=entry,
                account=resolve_party_account(
                    'Supplier', ret.supplier_id, self._acct('TRADE_PAYABLES', loc)),
                debit=total_return,
                party_type='Supplier',
                party_id=ret.supplier_id,
            )
        # Credit: Closing Stock directly — perpetual inventory never debited
        # Purchases on the original purchase, so we don't credit Purchase
        # Returns now either; the stock just goes back out.
        if taxable_amount > 0:
            JournalEntryLine.objects.create(
                entry=entry, account=self._acct('CLOSING_STOCK', loc), credit=taxable_amount,
            )
        # Credit: Reverse ITC
        if cgst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_CGST', loc), credit=cgst_amount)
        if sgst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_SGST', loc), credit=sgst_amount)
        if igst_amount > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_IGST', loc), credit=igst_amount)

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

        loc = rcm_data.get('location_id')
        entry = JournalEntry.objects.create(
            date=rcm_data['date'],
            narration=f"RCM: {rcm_data['service_type']} from {rcm_data['supplier_name']}",
            voucher_type='JOURNAL',
            reference_type='RCM',
            location_id=loc,
        )

        # Debit: Input GST (claimable ITC on RCM)
        if split['cgst'] > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_CGST', loc), debit=split['cgst'])
        if split['sgst'] > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_SGST', loc), debit=split['sgst'])
        if split['igst'] > 0:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('INPUT_IGST', loc), debit=split['igst'])

        # Credit: RCM GST Liability
        rcm_ac = self._acct_or_none('RCM_LIABILITY', loc)
        total_gst = split['cgst'] + split['sgst'] + split['igst']
        if rcm_ac and total_gst > 0:
            JournalEntryLine.objects.create(entry=entry, account=rcm_ac, credit=total_gst)

        entry.post()
        return entry

    @transaction.atomic
    def generate_payment(self, data):
        """Generate payment journal entry (Phase 4C). Manual trigger."""
        loc = data.get('location_id')
        entry = JournalEntry.objects.create(
            date=data['date'],
            narration=data.get('narration', 'Payment'),
            voucher_type='PAYMENT',
            reference_type='Manual',
            location_id=loc,
        )

        amount = Decimal(str(data['amount']))
        payment_mode = data.get('payment_mode', 'bank')

        # Debit: Trade Payables (the supplier's own ledger when linked)
        supplier_id = data.get('party_id')
        JournalEntryLine.objects.create(
            entry=entry,
            account=resolve_party_account(
                'Supplier', supplier_id, self._acct('TRADE_PAYABLES', loc)),
            debit=amount,
            party_type='Supplier',
            party_id=supplier_id,
        )
        # Credit: Bank or Cash. When payment_mode='bank' the caller can
        # name a specific Bank-subtype ChartOfAccount via bank_account_id;
        # otherwise we fall back to the BANK mapping.
        if payment_mode == 'bank':
            bank_id = data.get('bank_account_id')
            if bank_id:
                from core.models import ChartOfAccount
                credit_ac = ChartOfAccount.objects.get(pk=bank_id)
            else:
                credit_ac = self._acct('BANK', loc)
        else:
            credit_ac = self._acct('CASH', loc)
        JournalEntryLine.objects.create(entry=entry, account=credit_ac, credit=amount)

        entry.post()
        return entry

    @transaction.atomic
    def _customer_open_ar(self, customer_id):
        """Sum (debit − credit) on receivable accounts for this customer.
        Positive = customer owes us; zero/negative = nothing outstanding."""
        if not customer_id:
            return Decimal('0.00')
        agg = JournalEntryLine.objects.filter(
            entry__is_posted=True,
            party_type='Customer', party_id=customer_id,
            account__account_subtype='Receivable',
        ).aggregate(d=Sum('debit'), c=Sum('credit'))
        return (agg['d'] or Decimal('0')) - (agg['c'] or Decimal('0'))

    def generate_receipt(self, data):
        """Generate receipt journal entry (Phase 4C). Manual trigger.

        Rejects receipts that exceed the customer's open AR balance so
        cash-paid B2B sales (which don't create AR) don't get a stray
        receipt voucher that drives the customer into negative AR.
        Pass `skip_ar_check=True` in `data` for advance receipts where
        the AR is intentionally created by the receipt itself.
        """
        amount = Decimal(str(data['amount']))
        party_id = data.get('party_id')

        if party_id and not data.get('skip_ar_check'):
            open_ar = self._customer_open_ar(party_id)
            if amount > open_ar + Decimal('0.005'):
                raise ValueError(
                    f'Receipt ₹{amount} exceeds customer\'s open receivable of '
                    f'₹{open_ar}. If this is an advance (no invoice yet), retry '
                    f'with skip_ar_check=true.'
                )

        loc = data.get('location_id')
        entry = JournalEntry.objects.create(
            date=data['date'],
            narration=data.get('narration', 'Receipt'),
            voucher_type='RECEIPT',
            reference_type='Manual',
            location_id=loc,
        )

        receipt_mode = data.get('receipt_mode', 'bank')

        # Debit: Bank or Cash
        debit_ac = self._acct('BANK', loc) if receipt_mode == 'bank' else self._acct('CASH', loc)
        JournalEntryLine.objects.create(entry=entry, account=debit_ac, debit=amount)
        # Credit: Trade Receivables (the customer's own ledger when linked)
        JournalEntryLine.objects.create(
            entry=entry,
            account=resolve_party_account(
                'Customer', party_id, self._acct('TRADE_RECEIVABLES', loc)),
            credit=amount,
            party_type='Customer',
            party_id=party_id,
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

        loss_acct = self._acct('INVENTORY_LOSS', location_id)
        stock_acct = self._acct('CLOSING_STOCK', location_id)

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
                                            account=self._acct('INPUT_CGST', location_id),
                                            credit=half)
            JournalEntryLine.objects.create(entry=je,
                                            account=self._acct('INPUT_SGST', location_id),
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
                                        account=self._acct('EXPIRY_LOSS', location_id),
                                        debit=value + itc)
        JournalEntryLine.objects.create(entry=je,
                                        account=self._acct('CLOSING_STOCK', location_id),
                                        credit=value)
        if itc > 0:
            half = (itc / 2).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            JournalEntryLine.objects.create(entry=je,
                                            account=self._acct('INPUT_CGST', location_id),
                                            credit=half)
            JournalEntryLine.objects.create(entry=je,
                                            account=self._acct('INPUT_SGST', location_id),
                                            credit=itc - half)
        je.post()
        return je

    # Inventory write-off movement types on the inventory side that the books
    # must relieve as a loss.
    WRITEOFF_MOVEMENT_TYPES = ('damage_write_off', 'wastage_write_off', 'expiry_write_off')

    @transaction.atomic
    def generate_stock_writeoff(self, movement_id):
        """Auto-post the GL effect of an inventory write-off (damage / wastage /
        expiry) recorded on the inventory side.

        Books, valued at the product's weighted-average cost of the units
        written off (the same basis COGS uses, so the stock account drains
        correctly):

            Dr Inventory Loss / Expiry Loss   value
                Cr Closing Stock              value

        Expiry write-offs land in Expiry Loss; damage/wastage in Inventory
        Loss — these keep their existing classification (write-offs are left
        as-is, per client policy; only stock audit variances are reclassified
        as indirect — see generate_stock_adjustment).

        Idempotent via reference_type='StockWriteOff' (reference_id = the
        StockMovement id), so re-running sync never double-posts. ITC
        reversal under CGST §17(5)(h), where applicable, remains a manual
        Closing-Entries adjustment — the inventory feed carries no tax value.
        """
        if self._entry_exists('StockWriteOff', movement_id):
            return None
        mv = StockMovementRO.objects.get(id=movement_id)
        if mv.movement_type not in self.WRITEOFF_MOVEMENT_TYPES:
            return None
        qty = abs(Decimal(str(mv.quantity or 0)))
        if qty <= 0:
            return None
        loc = mv.location_id
        cost = self._product_avg_cost(mv.product_id, loc)
        value = (qty * cost).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if value <= 0:
            # No cost basis (e.g. never purchased) — nothing to relieve.
            return None

        loss_key = 'EXPIRY_LOSS' if mv.movement_type == 'expiry_write_off' else 'INVENTORY_LOSS'
        loss_acct = self._acct(loss_key, loc)
        stock_acct = self._acct('CLOSING_STOCK', loc)

        entry = JournalEntry.objects.create(
            date=mv.created_at.date(),
            narration=(mv.notes or f'Stock write-off ({mv.movement_type})')
                      + f' — movement #{movement_id}',
            voucher_type='JOURNAL',
            reference_type='StockWriteOff',
            reference_id=movement_id,
            location_id=loc,
        )
        JournalEntryLine.objects.create(
            entry=entry, account=loss_acct, debit=value,
            narration='Stock write-off loss',
        )
        JournalEntryLine.objects.create(
            entry=entry, account=stock_acct, credit=value,
            narration='Stock relieved',
        )
        entry.post()
        return entry

    @transaction.atomic
    def generate_stock_adjustment(self, movement_id):
        """Auto-post the GL effect of a physical-count stock audit adjustment.

        Variances post against Closing Stock at weighted-average cost, with the
        offset in Stock Audit Variance (5490) — a dedicated INDIRECT expense,
        per client policy, kept separate from write-off losses:

            shortage (qty < 0):  Dr Stock Audit Variance / Cr Closing Stock
            overage  (qty > 0):  Dr Closing Stock / Cr Stock Audit Variance (gain)

        Idempotent via reference_type='StockAdjustment' (reference_id = the
        StockMovement id).
        """
        if self._entry_exists('StockAdjustment', movement_id):
            return None
        mv = StockMovementRO.objects.get(id=movement_id)
        if mv.movement_type != 'adjustment':
            return None
        delta = Decimal(str(mv.quantity or 0))
        if delta == 0:
            return None
        loc = mv.location_id
        cost = self._product_avg_cost(mv.product_id, loc)
        value = (abs(delta) * cost).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if value <= 0:
            return None

        loss_acct = self._acct('STOCK_AUDIT_VARIANCE', loc)
        stock_acct = self._acct('CLOSING_STOCK', loc)

        entry = JournalEntry.objects.create(
            date=mv.created_at.date(),
            narration=(mv.notes or 'Stock audit adjustment')
                      + f' — movement #{movement_id}',
            voucher_type='JOURNAL',
            reference_type='StockAdjustment',
            reference_id=movement_id,
            location_id=loc,
        )
        if delta < 0:   # shortage → expense
            JournalEntryLine.objects.create(
                entry=entry, account=loss_acct, debit=value,
                narration='Inventory shortage (audit)',
            )
            JournalEntryLine.objects.create(
                entry=entry, account=stock_acct, credit=value,
                narration='Stock relieved',
            )
        else:           # overage → variance gain (reduces the loss account)
            JournalEntryLine.objects.create(
                entry=entry, account=stock_acct, debit=value,
                narration='Inventory overage (audit)',
            )
            JournalEntryLine.objects.create(
                entry=entry, account=loss_acct, credit=value,
                narration='Inventory variance gain',
            )
        entry.post()
        return entry

    def generate_petty_cash(self, txn_id):
        """Auto-post a pharmacy-counter petty-cash movement.

            deposit:  Dr Bank (1120)            / Cr Cash (1110)
            expense:  Dr Petty Cash Expenses(5475)/ Cr Cash (1110)

        Cash POS sales already accumulate in the 1110 Cash GL via sync_pos;
        deposits move that cash to the bank and expenses drain it. Idempotent
        via reference_type='PettyCash' (reference_id = the PettyCashTxn id).
        """
        if self._entry_exists('PettyCash', txn_id):
            return None
        txn = PettyCashTxnRO.objects.get(id=txn_id)
        amount = Decimal(str(txn.amount or 0)).quantize(Decimal('0.01'))
        if amount <= 0:
            return None
        loc = txn.location_id
        cash_acct = self._acct('CASH', loc)
        if txn.txn_type == 'deposit':
            debit_acct = self._acct('BANK', loc)
            default_note = 'Cash deposited to bank'
            voucher = 'CONTRA'
        elif txn.txn_type == 'expense':
            debit_acct = self._acct('PETTY_EXPENSE', loc)
            default_note = 'Petty cash expense'
            voucher = 'PAYMENT'
        else:
            return None

        narration = (txn.description or default_note)
        if txn.bank_reference:
            narration = f'{narration} (ref: {txn.bank_reference})'

        entry = JournalEntry.objects.create(
            date=txn.txn_date,
            narration=f'{narration} — petty cash #{txn_id}',
            voucher_type=voucher,
            reference_type='PettyCash',
            reference_id=txn_id,
            location_id=loc,
        )
        JournalEntryLine.objects.create(entry=entry, account=debit_acct, debit=amount, narration=narration)
        JournalEntryLine.objects.create(entry=entry, account=cash_acct, credit=amount, narration='Paid from cash in hand')
        entry.post()
        return entry

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

        # Each leg resolves Closing Stock at its OWN location so each store's
        # books square independently. Stock-in-Transit may be either shared or
        # per-location; either way each leg picks the right row.
        out_stock = self._acct('CLOSING_STOCK', from_location_id)
        out_transit = self._acct('STOCK_TRANSFER_TRANSIT', from_location_id)
        in_stock = self._acct('CLOSING_STOCK', to_location_id)
        in_transit = self._acct('STOCK_TRANSFER_TRANSIT', to_location_id)

        out_je = JournalEntry.objects.create(
            date=date,
            narration=(narration or
                       f'Stock transfer OUT to location {to_location_id}'),
            voucher_type='JOURNAL', reference_type='Manual',
            location_id=from_location_id, created_by=user,
        )
        JournalEntryLine.objects.create(entry=out_je, account=out_transit, debit=value)
        JournalEntryLine.objects.create(entry=out_je, account=out_stock, credit=value)
        out_je.post()

        in_je = JournalEntry.objects.create(
            date=date,
            narration=(narration or
                       f'Stock transfer IN from location {from_location_id}'),
            voucher_type='JOURNAL', reference_type='Manual',
            location_id=to_location_id, created_by=user,
        )
        JournalEntryLine.objects.create(entry=in_je, account=in_stock, debit=value)
        JournalEntryLine.objects.create(entry=in_je, account=in_transit, credit=value)
        in_je.post()

        return {'out_entry': out_je, 'in_entry': in_je}

    @transaction.atomic
    def generate_contra(self, data):
        """Generate contra journal entry (Phase 4C). Manual trigger."""
        loc = data.get('location_id')
        entry = JournalEntry.objects.create(
            date=data['date'],
            narration=data.get('narration', 'Contra Entry'),
            voucher_type='CONTRA',
            reference_type='Manual',
            location_id=loc,
        )

        amount = Decimal(str(data['amount']))
        direction = data.get('direction', 'bank_to_cash')  # or 'cash_to_bank'

        if direction == 'bank_to_cash':
            JournalEntryLine.objects.create(entry=entry, account=self._acct('CASH', loc), debit=amount)
            JournalEntryLine.objects.create(entry=entry, account=self._acct('BANK', loc), credit=amount)
        else:
            JournalEntryLine.objects.create(entry=entry, account=self._acct('BANK', loc), debit=amount)
            JournalEntryLine.objects.create(entry=entry, account=self._acct('CASH', loc), credit=amount)

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
        # Re-resolve the party leaf at generation time (don't copy a possibly
        # stale template FK): a template line tagged to a party posts to that
        # party's current ledger, falling back to the template's own account.
        party_type = tl.party_type if tl.party_type in ('Supplier', 'Customer') else None
        account = resolve_party_account(party_type, tl.party_id, tl.account)
        JournalEntryLine.objects.create(
            entry=entry, account=account,
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



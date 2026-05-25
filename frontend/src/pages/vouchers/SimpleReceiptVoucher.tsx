import SimplePaymentVoucher from './SimplePaymentVoucher'

/**
 * Receipt voucher (F6). Shares the same Tally-classic editor as the Payment
 * voucher — the underlying SimplePaymentVoucher component is parameterized
 * by `mode`. For receipts:
 *   - Bank/Cash is on the DEBIT side (header), parties are on the CREDIT
 *     side (row table).
 *   - Default party kind for new rows is Customer.
 *   - The row-level reference picker auto-loads the customer's open
 *     invoices, single-click to allocate.
 */
export default function SimpleReceiptVoucher() {
  return <SimplePaymentVoucher mode="receipt" />
}

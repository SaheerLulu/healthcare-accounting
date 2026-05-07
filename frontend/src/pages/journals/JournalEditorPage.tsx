import VoucherEditor from '../vouchers/VoucherEditor'

/**
 * Legacy URL surface (`/journals/new`, `/journals/:id/edit`) preserved as a
 * thin wrapper around the shared Tally-style VoucherEditor with the JOURNAL
 * voucher type. Deep links from older flows keep working.
 */
export default function JournalEditorPage() {
  return <VoucherEditor voucherType="JOURNAL" />
}

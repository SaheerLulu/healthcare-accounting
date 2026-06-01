import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  getOpenSupplierInvoices, getOpenCustomerInvoices, type OpenPartyInvoice,
} from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose,
} from '../../components/ui/sheet'

export interface InvoiceAllocation {
  invoice_no: string
  ref_date: string | null
  amount: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  partyType: 'Supplier' | 'Customer'
  partyId: number
  partyName: string
  /** Confirmed per-invoice allocations (only invoices with amount > 0). */
  onAllocate: (items: InvoiceAllocation[]) => void
}

const num = (s: string) => parseFloat(s) || 0

/**
 * Tally-style bill-wise settlement grid: lists EACH outstanding invoice for a
 * party with an editable "this payment" amount (capped at the invoice's
 * remaining balance). Suppliers read /reports/open-supplier-invoices (synced
 * purchase JEs — the bills app is empty), customers read open-customer-invoices.
 * On confirm it returns one allocation per paid invoice; the caller turns each
 * into a payment line + an AGAINST BillReference.
 */
export function InvoiceAllocationGrid({
  open, onOpenChange, partyType, partyId, partyName, onAllocate,
}: Props) {
  const [invoices, setInvoices] = useState<OpenPartyInvoice[]>([])
  const [loading, setLoading] = useState(false)
  // invoice_no -> entered amount (string)
  const [amounts, setAmounts] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setAmounts({})
    const fetcher = partyType === 'Supplier'
      ? getOpenSupplierInvoices({ party_id: String(partyId) })
      : getOpenCustomerInvoices({ party_id: String(partyId) })
    fetcher
      .then((res) => {
        if (cancelled) return
        const mine = (res.rows || []).filter((r) => r.party_id === partyId)
        setInvoices(mine)
      })
      .catch(() => { if (!cancelled) toast.error('Failed to load outstanding invoices') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, partyType, partyId])

  function outstandingOf(inv: OpenPartyInvoice): number {
    return num(inv.outstanding_amount ?? inv.amount)
  }

  function setAmount(invoiceNo: string, raw: string, cap: number) {
    let v = raw
    if (num(v) > cap) v = cap.toFixed(2) // never allocate beyond the remaining balance
    setAmounts((prev) => ({ ...prev, [invoiceNo]: v }))
  }

  function payAll() {
    const next: Record<string, string> = {}
    for (const inv of invoices) next[inv.invoice_no] = outstandingOf(inv).toFixed(2)
    setAmounts(next)
  }
  function clearAll() { setAmounts({}) }

  const total = useMemo(
    () => invoices.reduce((s, inv) => s + num(amounts[inv.invoice_no] || ''), 0),
    [invoices, amounts]
  )

  function commit() {
    const items: InvoiceAllocation[] = invoices
      .filter((inv) => num(amounts[inv.invoice_no] || '') > 0)
      .map((inv) => ({
        invoice_no: inv.invoice_no,
        ref_date: inv.date || null,
        amount: num(amounts[inv.invoice_no]).toFixed(2),
      }))
    if (items.length === 0) {
      toast.info('Enter a payment amount against at least one invoice')
      return
    }
    onAllocate(items)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width="lg">
        <div className="flex flex-col h-full">
          <SheetHeader>
            <SheetTitle>Settle Invoices · {partyName}</SheetTitle>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-2)' }}>
              {invoices.length} outstanding invoice{invoices.length === 1 ? '' : 's'} — enter how much to pay against each
            </p>
          </SheetHeader>
          <SheetBody>
            {loading ? (
              <div className="text-center py-12">
                <Loader2 className="animate-spin inline" size={20} style={{ color: 'var(--brand)' }} />
              </div>
            ) : invoices.length === 0 ? (
              <div className="text-center py-12 text-sm" style={{ color: 'var(--ink-3)' }}>
                No outstanding invoices for this {partyType.toLowerCase()}
              </div>
            ) : (
              <>
                <div className="flex justify-end gap-2 mb-2">
                  <Button type="button" variant="ghost" size="sm" onClick={payAll}>Pay all in full</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={clearAll}>Clear</Button>
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b" style={{ borderColor: 'var(--line)' }}>
                    <tr>
                      <th className="text-left text-[10px] font-semibold uppercase mono px-2 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Invoice #</th>
                      <th className="text-left text-[10px] font-semibold uppercase mono px-2 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Date</th>
                      <th className="text-right text-[10px] font-semibold uppercase mono px-2 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Outstanding</th>
                      <th className="text-right text-[10px] font-semibold uppercase mono px-2 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>This Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const cap = outstandingOf(inv)
                      return (
                        <tr key={inv.invoice_no} className="border-b" style={{ borderColor: 'var(--line)' }}>
                          <td className="px-2 py-2 mono text-xs" style={{ color: 'var(--ink)' }}>
                            <div>{inv.invoice_no}</div>
                            {inv.narration && (
                              <div className="text-[10px] truncate max-w-[180px]" style={{ color: 'var(--ink-3)' }}>{inv.narration}</div>
                            )}
                          </td>
                          <td className="px-2 py-2 text-xs" style={{ color: 'var(--ink-2)' }}>{formatDate(inv.date)}</td>
                          <td className="px-2 py-2 text-right font-mono font-semibold" style={{ color: 'var(--ink)' }}>
                            {formatCurrency(cap)}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <input
                              type="number" step="0.01" min="0" max={cap}
                              value={amounts[inv.invoice_no] ?? ''}
                              onChange={(e) => setAmount(inv.invoice_no, e.target.value, cap)}
                              placeholder="0.00"
                              className="w-28 px-2 py-1 text-right font-mono text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
                              style={{ background: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface-1)' }}>
                      <td colSpan={3} className="px-2 py-2 text-right text-xs font-semibold" style={{ color: 'var(--ink)' }}>Total payment</td>
                      <td className="px-2 py-2 text-right font-mono font-bold" style={{ color: 'var(--brand)' }}>{formatCurrency(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="secondary">Cancel</Button>
            </SheetClose>
            <Button type="button" onClick={commit} disabled={total <= 0}>
              Allocate {total > 0 && formatCurrency(total)}
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  )
}

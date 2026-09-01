import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { getBills, type Bill } from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose,
} from '../../components/ui/sheet'

export interface BillAllocation {
  bill_id: number
  ref_no: string
  ref_date: string | null
  amount: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  vendorId: number
  vendorName: string
  /** Called when the user confirms allocations. */
  onAllocate: (allocation: {
    amount: string
    narration: string
    billIds: number[]
    items: BillAllocation[]
  }) => void
}

export function BillAllocationSheet({ open, onOpenChange, vendorId, vendorName, onAllocate }: Props) {
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // The rows are the only thing on this panel; focus is parked on the header
  // close button until they arrive, so hand it over once they do.
  const pendingFocusRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setLoading(true)
    pendingFocusRef.current = true
    getBills({ vendor_id: String(vendorId) })
      .then((res) => {
        // Defensive client-side filter — only outstanding bills.
        const outstanding = (res.results || []).filter(
          (b) => b.status === 'open' || b.status === 'partially_paid'
        )
        setBills(outstanding)
      })
      .catch(() => toast.error('Failed to load bills'))
      .finally(() => setLoading(false))
  }, [open, vendorId])

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totals = useMemo(() => {
    let sum = 0
    const refs: string[] = []
    for (const b of bills) {
      if (selected.has(b.id)) {
        sum += parseFloat(b.balance_due) || 0
        refs.push(b.bill_no || `#${b.id}`)
      }
    }
    return { sum, refs }
  }, [bills, selected])

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // Every row is a checkbox that was only ever clickable: a <tr> is not
  // focusable and does not answer Enter, so a keyboard user could open this
  // panel and select nothing. Roving tabindex gives the table ONE tab stop,
  // ↑↓/Home/End/PgUp/PgDn inside it, and Enter/Space to toggle the row.
  const list = useListKeyboardNav({
    count: bills.length,
    onActivate: (i) => toggle(bills[i].id),
  })

  useEffect(() => {
    if (!open || loading || bills.length === 0) return
    if (!pendingFocusRef.current) return
    pendingFocusRef.current = false
    list.focusList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, bills.length])

  function commit() {
    if (selected.size === 0) {
      toast.info('Select at least one bill to allocate')
      return
    }
    const items: BillAllocation[] = bills
      .filter((b) => selected.has(b.id))
      .map((b) => ({
        bill_id: b.id,
        ref_no: b.bill_no || `BILL-${b.id}`,
        ref_date: b.bill_date || null,
        amount: b.balance_due,
      }))
    onAllocate({
      amount: totals.sum.toFixed(2),
      narration: `Against ${totals.refs.join(', ')}`,
      billIds: Array.from(selected),
      items,
    })
    onOpenChange(false)
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Ctrl+S / Ctrl+Enter allocate from anywhere in the panel — the footer
          button is the last stop in the DOM, past every row. */}
      <SheetContent width="lg" onSubmit={commit}>
        <div className="flex flex-col h-full">
          <SheetHeader>
            <SheetTitle>Bill-wise Allocation</SheetTitle>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-2)' }}>
              {vendorName} · {bills.length} outstanding bill{bills.length === 1 ? '' : 's'}
            </p>
          </SheetHeader>
          <SheetBody>
            {loading ? (
              <div className="text-center py-12">
                <Loader2 className="animate-spin inline" size={20} style={{ color: 'var(--brand)' }} />
              </div>
            ) : bills.length === 0 ? (
              <div className="text-center py-12 text-sm" style={{ color: 'var(--ink-3)' }}>
                No outstanding bills for this supplier
              </div>
            ) : (
              <div className="table-scroll">
                {/* 440px stays inside the sheet's own content width, so the rail
                    only engages once the sheet goes full-screen on a phone. */}
                <table className="w-full text-sm min-w-[440px]">
                  <thead className="border-b" style={{ borderColor: 'var(--line)' }}>
                    <tr>
                      <th className="w-8 px-2 py-2" />
                      <th className="text-left text-[10px] font-semibold uppercase mono px-2 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Bill #</th>
                      <th className="text-left text-[10px] font-semibold uppercase mono px-2 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Date</th>
                      <th className="text-left text-[10px] font-semibold uppercase mono px-2 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Due</th>
                      <th className="text-right text-[10px] font-semibold uppercase mono px-2 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Total</th>
                      <th className="text-right text-[10px] font-semibold uppercase mono px-2 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Balance Due</th>
                    </tr>
                  </thead>
                  <tbody {...list.containerProps}>
                    {bills.map((b, i) => {
                      const isSel = selected.has(b.id)
                      const overdue = b.due_date && b.due_date < today
                      return (
                        <tr
                          key={b.id}
                          onClick={() => toggle(b.id)}
                          {...list.rowProps(i)}
                          // Selection is otherwise carried by background colour
                          // alone, which says nothing to a screen reader.
                          aria-pressed={isSel}
                          // Selection tint and hover are CLASSES, not inline
                          // `style`. index.css gives the keyboard-focused row
                          // its tint through `[data-kbd-row]:focus-visible`,
                          // and an inline background beats any stylesheet — so
                          // an inline tint here left focus signalled by the
                          // 4px rail alone. Utilities sit in Tailwind's layer,
                          // which the unlayered focus rule still outranks, so
                          // focus reads over both selection and hover.
                          className={`group border-b cursor-pointer transition-colors ${
                            isSel ? 'bg-[rgba(15,157,154,0.08)]' : 'hover:bg-[var(--color-hover-bg)]'
                          }`}
                          style={{ borderColor: 'var(--line)' }}
                        >
                          <td className="px-2 py-2">
                            <span
                              aria-hidden="true"
                              // Selected rows are tinted the same teal the
                              // focus rule paints, so the rail would otherwise
                              // be the only "you are here" on them. Ring the
                              // box the row's Enter/Space actually toggles.
                              className="inline-flex items-center justify-center w-4 h-4 rounded border transition-shadow group-focus-visible:ring-2 group-focus-visible:ring-[var(--brand)] group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-[var(--surface-0)]"
                              style={{
                                borderColor: isSel ? 'var(--brand)' : 'var(--line)',
                                background: isSel ? 'var(--brand)' : 'transparent',
                                color: '#fff',
                              }}
                            >
                              {isSel && <Check size={10} />}
                            </span>
                          </td>
                          <td className="px-2 py-2 mono text-xs" style={{ color: 'var(--ink)' }}>
                            {b.bill_no || `BILL-${b.id}`}
                          </td>
                          <td className="px-2 py-2 text-xs" style={{ color: 'var(--ink-2)' }}>
                            {formatDate(b.bill_date)}
                          </td>
                          <td className="px-2 py-2 text-xs" style={{ color: overdue ? 'var(--danger)' : 'var(--ink-2)' }}>
                            {b.due_date ? formatDate(b.due_date) : '—'}
                          </td>
                          <td className="px-2 py-2 text-right font-mono" style={{ color: 'var(--ink-2)' }}>
                            {formatCurrency(b.total_amount)}
                          </td>
                          <td className="px-2 py-2 text-right font-mono font-semibold" style={{ color: 'var(--ink)' }}>
                            {formatCurrency(b.balance_due)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {selected.size > 0 && (
                    <tfoot>
                      <tr style={{ background: 'var(--surface-1)' }}>
                        <td colSpan={5} className="px-2 py-2 text-right text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                          Selected ({selected.size}) total
                        </td>
                        <td className="px-2 py-2 text-right font-mono font-bold" style={{ color: 'var(--brand)' }}>
                          {formatCurrency(totals.sum)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="secondary">Cancel</Button>
            </SheetClose>
            <Button type="button" onClick={commit} disabled={selected.size === 0} chord="Ctrl+Enter">
              Allocate {selected.size > 0 && `${formatCurrency(totals.sum)}`}
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  )
}

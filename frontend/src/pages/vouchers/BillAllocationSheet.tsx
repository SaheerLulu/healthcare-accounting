import { useEffect, useMemo, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { getBills, type Bill } from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Button } from '../../components/ui/button'
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

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setLoading(true)
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
      <SheetContent width="lg">
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
              <table className="w-full text-sm">
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
                <tbody>
                  {bills.map((b) => {
                    const isSel = selected.has(b.id)
                    const overdue = b.due_date && b.due_date < today
                    return (
                      <tr
                        key={b.id}
                        onClick={() => toggle(b.id)}
                        className="border-b cursor-pointer transition-colors"
                        style={{
                          borderColor: 'var(--line)',
                          backgroundColor: isSel ? 'rgba(15,157,154,0.08)' : 'transparent',
                        }}
                        onMouseEnter={(e) => {
                          if (!isSel) e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)'
                        }}
                        onMouseLeave={(e) => {
                          if (!isSel) e.currentTarget.style.backgroundColor = 'transparent'
                        }}
                      >
                        <td className="px-2 py-2">
                          <span
                            className="inline-flex items-center justify-center w-4 h-4 rounded border"
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
            )}
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="secondary">Cancel</Button>
            </SheetClose>
            <Button type="button" onClick={commit} disabled={selected.size === 0}>
              Allocate {selected.size > 0 && `${formatCurrency(totals.sum)}`}
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  )
}

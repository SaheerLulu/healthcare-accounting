import { useEffect, useMemo, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import {
  getBills, getOpenCustomerInvoices,
  type Bill, type OpenCustomerInvoice,
} from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose,
} from '../../components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'

export type BillRefKind = 'AGAINST' | 'ADVANCE' | 'ON_ACCOUNT' | 'NEW'

export interface BillRefValue {
  kind: BillRefKind
  bill_id: number | null
  ref_no: string
  ref_date: string | null
  /** Suggested amount when picked from a bill/invoice (caller may override). */
  amount: string | null
  /** Display chips on the row, e.g. "BILL-001 · 12-Apr-26". */
  label: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  partyType: 'Supplier' | 'Customer' | null
  partyId: number | null
  partyName: string
  onPick: (value: BillRefValue) => void
}

const todayStr = () => new Date().toISOString().slice(0, 10)

export function BillRefPickerSheet({
  open, onOpenChange, partyType, partyId, partyName, onPick,
}: Props) {
  const [tab, setTab] = useState<BillRefKind>('AGAINST')
  const [bills, setBills] = useState<Bill[]>([])
  const [invoices, setInvoices] = useState<OpenCustomerInvoice[]>([])
  const [loading, setLoading] = useState(false)

  const [freeRefNo, setFreeRefNo] = useState('')
  const [freeRefDate, setFreeRefDate] = useState(todayStr())

  // Reset state each time the sheet opens.
  useEffect(() => {
    if (!open) return
    setTab(partyId ? 'AGAINST' : 'NEW')
    setFreeRefNo('')
    setFreeRefDate(todayStr())
    setBills([])
    setInvoices([])
  }, [open, partyId])

  useEffect(() => {
    if (!open || tab !== 'AGAINST' || !partyId) return
    let cancelled = false
    setLoading(true)
    async function load() {
      try {
        if (partyType === 'Supplier') {
          const res = await getBills({ vendor_id: String(partyId) })
          if (cancelled) return
          setBills((res.results || []).filter(
            (b) => b.status === 'open' || b.status === 'partially_paid'
          ))
        } else if (partyType === 'Customer') {
          const res = await getOpenCustomerInvoices()
          if (cancelled) return
          setInvoices((res.rows || []).filter((r) => r.party_id === partyId))
        }
      } catch {
        toast.error('Failed to load outstanding references')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [open, tab, partyId, partyType])

  function pickBill(b: Bill) {
    onPick({
      kind: 'AGAINST',
      bill_id: b.id,
      ref_no: b.bill_no || `BILL-${b.id}`,
      ref_date: b.bill_date || null,
      amount: b.balance_due,
      label: `${b.bill_no || `BILL-${b.id}`} · ${formatDate(b.bill_date)}`,
    })
    onOpenChange(false)
  }

  function pickInvoice(inv: OpenCustomerInvoice) {
    onPick({
      kind: 'AGAINST',
      // Customer invoices live as JEs, not in the Bill model — no bill_id.
      bill_id: null,
      ref_no: inv.invoice_no,
      ref_date: inv.date,
      amount: inv.amount,
      label: `${inv.invoice_no} · ${formatDate(inv.date)}`,
    })
    onOpenChange(false)
  }

  function pickAdvance() {
    onPick({
      kind: 'ADVANCE',
      bill_id: null,
      ref_no: 'Advance',
      ref_date: todayStr(),
      amount: null,
      label: 'Advance',
    })
    onOpenChange(false)
  }

  function pickOnAccount() {
    onPick({
      kind: 'ON_ACCOUNT',
      bill_id: null,
      ref_no: 'On Account',
      ref_date: todayStr(),
      amount: null,
      label: 'On Account',
    })
    onOpenChange(false)
  }

  function pickFreeform() {
    if (!freeRefNo.trim()) {
      toast.info('Enter a reference number')
      return
    }
    onPick({
      kind: 'NEW',
      bill_id: null,
      ref_no: freeRefNo.trim(),
      ref_date: freeRefDate || null,
      amount: null,
      label: freeRefDate
        ? `${freeRefNo.trim()} · ${formatDate(freeRefDate)}`
        : freeRefNo.trim(),
    })
    onOpenChange(false)
  }

  const partyLabel = partyId
    ? `${partyType ?? 'Party'}: ${partyName}`
    : 'No party — only freeform reference is available'

  const today = todayStr()

  const billsList = useMemo(() => bills, [bills])
  const invoicesList = useMemo(() => invoices, [invoices])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width="lg">
        <div className="flex flex-col h-full">
          <SheetHeader>
            <SheetTitle>Bill / Invoice Reference</SheetTitle>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-2)' }}>{partyLabel}</p>
          </SheetHeader>
          <SheetBody>
            <Tabs value={tab} onValueChange={(v) => setTab(v as BillRefKind)}>
              <TabsList>
                <TabsTrigger value="AGAINST" disabled={!partyId}>Against Bill</TabsTrigger>
                <TabsTrigger value="ADVANCE" disabled={!partyId}>Advance</TabsTrigger>
                <TabsTrigger value="ON_ACCOUNT" disabled={!partyId}>On Account</TabsTrigger>
                <TabsTrigger value="NEW">Freeform</TabsTrigger>
              </TabsList>

              <TabsContent value="AGAINST">
                {loading ? (
                  <div className="text-center py-10">
                    <Loader2 className="animate-spin inline" size={18} style={{ color: 'var(--brand)' }} />
                  </div>
                ) : partyType === 'Supplier' ? (
                  billsList.length === 0 ? (
                    <Empty>No outstanding bills for this supplier</Empty>
                  ) : (
                    <RefTable
                      cols={['Bill #', 'Date', 'Due', 'Balance']}
                      rows={billsList.map((b) => {
                        const overdue = !!b.due_date && b.due_date < today
                        return {
                          key: `b-${b.id}`,
                          onClick: () => pickBill(b),
                          cells: [
                            <span key="no" className="mono text-xs" style={{ color: 'var(--ink)' }}>{b.bill_no || `BILL-${b.id}`}</span>,
                            <span key="d" className="text-xs" style={{ color: 'var(--ink-2)' }}>{formatDate(b.bill_date)}</span>,
                            <span key="due" className="text-xs" style={{ color: overdue ? 'var(--danger)' : 'var(--ink-2)' }}>
                              {b.due_date ? formatDate(b.due_date) : '—'}
                            </span>,
                            <span key="amt" className="font-mono font-semibold" style={{ color: 'var(--ink)' }}>{formatCurrency(b.balance_due)}</span>,
                          ],
                        }
                      })}
                    />
                  )
                ) : invoicesList.length === 0 ? (
                  <Empty>No outstanding invoices for this customer</Empty>
                ) : (
                  <RefTable
                    cols={['Invoice #', 'Date', '', 'Amount']}
                    rows={invoicesList.map((inv, i) => ({
                      key: `i-${inv.invoice_no}-${i}`,
                      onClick: () => pickInvoice(inv),
                      cells: [
                        <span key="no" className="mono text-xs" style={{ color: 'var(--ink)' }}>{inv.invoice_no}</span>,
                        <span key="d" className="text-xs" style={{ color: 'var(--ink-2)' }}>{formatDate(inv.date)}</span>,
                        <span key="x" />,
                        <span key="amt" className="font-mono font-semibold" style={{ color: 'var(--ink)' }}>{formatCurrency(inv.amount)}</span>,
                      ],
                    }))}
                  />
                )}
              </TabsContent>

              <TabsContent value="ADVANCE">
                <SimpleTabBody
                  body="Mark this payment as an advance to the party. No specific bill/invoice is linked."
                  action="Set as Advance"
                  onAction={pickAdvance}
                />
              </TabsContent>

              <TabsContent value="ON_ACCOUNT">
                <SimpleTabBody
                  body="Record this payment on the party's account, without allocating it to a specific bill/invoice yet."
                  action="Set as On Account"
                  onAction={pickOnAccount}
                />
              </TabsContent>

              <TabsContent value="NEW">
                <div className="space-y-3 pt-2">
                  <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
                    For invoices not tracked inside the Bills module — type the reference manually.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>Reference #</span>
                      <Input
                        value={freeRefNo}
                        onChange={(e) => setFreeRefNo(e.target.value)}
                        placeholder="INV-2026-007"
                        autoFocus
                      />
                    </label>
                    <label className="block">
                      <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>Reference Date</span>
                      <Input
                        type="date"
                        value={freeRefDate}
                        onChange={(e) => setFreeRefDate(e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="secondary">Cancel</Button>
            </SheetClose>
            {tab === 'NEW' && (
              <Button type="button" onClick={pickFreeform}>
                <Check size={14} /> Use this reference
              </Button>
            )}
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center py-10 text-sm" style={{ color: 'var(--ink-3)' }}>
      {children}
    </div>
  )
}

function RefTable({ cols, rows }: {
  cols: string[]
  rows: { key: string; onClick: () => void; cells: React.ReactNode[] }[]
}) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b" style={{ borderColor: 'var(--line)' }}>
        <tr>
          {cols.map((c, i) => (
            <th
              key={i}
              className={`text-[10px] font-semibold uppercase mono px-2 py-2 tracking-wider ${i === cols.length - 1 ? 'text-right' : 'text-left'}`}
              style={{ color: 'var(--ink-2)' }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.key}
            onClick={r.onClick}
            className="border-b cursor-pointer transition-colors"
            style={{ borderColor: 'var(--line)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
          >
            {r.cells.map((cell, i) => (
              <td
                key={i}
                className={`px-2 py-2 ${i === r.cells.length - 1 ? 'text-right' : ''}`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SimpleTabBody({ body, action, onAction }: {
  body: string; action: string; onAction: () => void
}) {
  return (
    <div className="pt-2 space-y-4">
      <p className="text-sm" style={{ color: 'var(--ink-2)' }}>{body}</p>
      <Button type="button" onClick={onAction}>
        <Check size={14} /> {action}
      </Button>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Wallet, ChevronRight, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import {
  getReceivablesAging, createReceiptVoucher,
  type ReceivablesAgingRow,
} from '../lib/api'
import { formatCurrency, cn } from '../lib/utils'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeletons'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose,
} from '../components/ui/sheet'

export default function ReceivablesPage() {
  const [rows, setRows] = useState<ReceivablesAgingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [asOf, setAsOf] = useState(new Date().toISOString().split('T')[0])
  const [paying, setPaying] = useState<ReceivablesAgingRow | null>(null)

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (asOf) params.date = asOf
      const res = await getReceivablesAging(params)
      setRows(res.rows)
    } catch {
      toast.error('Failed to load receivables aging')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [asOf])

  const totals = useMemo(() => rows.reduce(
    (acc, row) => ({
      total: acc.total + Number(row.total_outstanding),
      d0_30: acc.d0_30 + Number(row.aging_0_30),
      d31_60: acc.d31_60 + Number(row.aging_31_60),
      d61_90: acc.d61_90 + Number(row.aging_61_90),
      d90plus: acc.d90plus + Number(row.aging_90_plus),
    }),
    { total: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }
  ), [rows])

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Receivables Aging</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{rows.length}</span> customers owe a total of{' '}
            <span className="font-medium mono" style={{ color: 'var(--warning)' }}>{formatCurrency(totals.total)}</span>.
            Click a row to drill into the customer; use Receive to record payment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>As of</label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-auto" />
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={7} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No outstanding receivables"
          description="When customers owe you money, their aging buckets will appear here."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">Customer</Th>
                <Th className="text-right px-3">Total Outstanding</Th>
                <Th className="text-right px-3">0–30</Th>
                <Th className="text-right px-3">31–60</Th>
                <Th className="text-right px-3">61–90</Th>
                <Th className="text-right px-3">90+</Th>
                <Th className="w-[160px]" />
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.customer_id} className="group">
                  <Td className="font-medium">
                    <Link
                      to={`/parties/customers/${row.customer_id}`}
                      className="inline-flex items-center gap-1 hover:underline"
                      style={{ color: 'var(--ink)' }}
                    >
                      {row.customer_name}
                      <ExternalLink size={11} className="opacity-0 group-hover:opacity-100" style={{ color: 'var(--brand)' }} />
                    </Link>
                  </Td>
                  <Td className="text-right mono font-semibold px-3" style={{ color: 'var(--ink)' }}>
                    {formatCurrency(row.total_outstanding)}
                  </Td>
                  <Td className="text-right mono px-3" style={{ color: 'var(--ink-2)' }}>{formatCurrency(row.aging_0_30)}</Td>
                  <Td className="text-right mono px-3" style={{ color: 'var(--warning)' }}>{formatCurrency(row.aging_31_60)}</Td>
                  <Td className="text-right mono px-3" style={{ color: '#d97706' }}>{formatCurrency(row.aging_61_90)}</Td>
                  <Td className="text-right mono px-3" style={{ color: 'var(--danger)' }}>{formatCurrency(row.aging_90_plus)}</Td>
                  <Td className="text-right pr-3">
                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="sm" onClick={() => setPaying(row)}>
                        <Wallet size={13} /> Receive
                      </Button>
                      <Link
                        to={`/parties/customers/${row.customer_id}`}
                        className="p-1.5 rounded hover:bg-[var(--color-hover-bg)]"
                        style={{ color: 'var(--ink-3)' }}
                        title="Open detail"
                      >
                        <ChevronRight size={16} />
                      </Link>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--color-grey-light)' }} className="font-semibold">
                <td className="py-3 px-4 text-sm" style={{ color: 'var(--ink-2)' }}>Total</td>
                <td className="py-3 px-3 text-right mono" style={{ color: 'var(--ink)' }}>{formatCurrency(totals.total)}</td>
                <td className="py-3 px-3 text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(totals.d0_30)}</td>
                <td className="py-3 px-3 text-right mono" style={{ color: 'var(--warning)' }}>{formatCurrency(totals.d31_60)}</td>
                <td className="py-3 px-3 text-right mono" style={{ color: '#d97706' }}>{formatCurrency(totals.d61_90)}</td>
                <td className="py-3 px-3 text-right mono" style={{ color: 'var(--danger)' }}>{formatCurrency(totals.d90plus)}</td>
                <td />
              </tr>
            </tfoot>
          </Table>
        </Card>
      )}

      {paying && (
        <ReceivePaymentSheet row={paying} onClose={() => setPaying(null)}
          onSuccess={() => { setPaying(null); load() }} />
      )}
    </div>
  )
}

function ReceivePaymentSheet({ row, onClose, onSuccess }: {
  row: ReceivablesAgingRow
  onClose: () => void
  onSuccess: () => void
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState(row.total_outstanding)
  const [mode, setMode] = useState<'bank' | 'cash'>('bank')
  const [narration, setNarration] = useState(`Receipt from ${row.customer_name}`)
  const [saving, setSaving] = useState(false)

  const outstanding = parseFloat(row.total_outstanding) || 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseFloat(amount) || 0
    if (amt <= 0) { toast.error('Amount must be > 0'); return }
    if (amt > outstanding + 0.005) {
      if (!confirm(`Amount ${formatCurrency(amt)} exceeds outstanding ${formatCurrency(outstanding)}. Continue anyway?`)) return
    }
    setSaving(true)
    try {
      await createReceiptVoucher({
        date, amount, party_id: row.customer_id,
        receipt_mode: mode, narration,
      })
      toast.success('Receipt posted')
      onSuccess()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to post receipt')
    } finally { setSaving(false) }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent width="md">
        <form onSubmit={submit} className="flex flex-col h-full">
          <SheetHeader>
            <SheetTitle>Receive payment</SheetTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              From <span className="font-medium">{row.customer_name}</span> · Outstanding{' '}
              <span className="font-mono font-medium">{formatCurrency(outstanding)}</span>
            </p>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date" required>
                  <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Amount" required>
                  <Input type="number" step="0.01" min="0.01" required value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="text-right font-mono" />
                </Field>
              </div>
              <Field label="Received in">
                <div className="flex gap-2">
                  {(['bank', 'cash'] as const).map((m) => (
                    <label key={m} className={cn(
                      'flex-1 flex items-center justify-center px-3 py-2 rounded-lg border cursor-pointer text-sm capitalize',
                      mode === m ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-600'
                    )}>
                      <input type="radio" checked={mode === m} onChange={() => setMode(m)} className="hidden" />
                      {m}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Narration">
                <Input value={narration} onChange={(e) => setNarration(e.target.value)} />
              </Field>
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-3">
                Posts a Receipt: Debit {mode === 'bank' ? 'Bank' : 'Cash'}, Credit Trade Receivables
                <span className="ml-1">(party-tagged to {row.customer_name}).</span>
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" size={14} />} Post Receipt
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function Field({ label, required, children }: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
    </label>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Banknote, ChevronRight, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import {
  getPayablesAging, createPaymentVoucher,
  type PayablesAgingRow,
} from '../lib/api'
import { formatCurrency, cn } from '../lib/utils'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { Button } from '../components/ui/button'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose,
} from '../components/ui/sheet'

export default function PayablesPage() {
  const [rows, setRows] = useState<PayablesAgingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [asOf, setAsOf] = useState(new Date().toISOString().split('T')[0])
  const [paying, setPaying] = useState<PayablesAgingRow | null>(null)

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (asOf) params.date = asOf
      const res = await getPayablesAging(params)
      setRows(res.rows)
    } catch {
      toast.error('Failed to load payables aging')
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
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Payables Aging</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {rows.length} suppliers owed a total of{' '}
            <span className="font-medium text-amber-700">{formatCurrency(totals.total)}</span>.
            Click a row to drill into the supplier; use Pay to record payment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">As of</label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
            className="w-auto px-2.5 py-1.5" />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Supplier</Th>
              <Th className="text-right px-3">Total Outstanding</Th>
              <Th className="text-right px-3">0–30</Th>
              <Th className="text-right px-3">31–60</Th>
              <Th className="text-right px-3">61–90</Th>
              <Th className="text-right px-3">90+</Th>
              <Th className="w-[160px]" />
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-12">
                  <Loader2 size={24} className="animate-spin inline text-teal-600" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-slate-400 text-sm">
                  No payables data found
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <Tr key={row.supplier_id} className="group hover:bg-slate-50">
                  <Td className="font-medium">
                    <Link to={`/parties/suppliers/${row.supplier_id}`}
                      className="inline-flex items-center gap-1 text-slate-900 hover:text-teal-700">
                      {row.supplier_name}
                      <ExternalLink size={11} className="opacity-0 group-hover:opacity-100 text-teal-600" />
                    </Link>
                  </Td>
                  <Td className="text-right font-mono font-semibold px-3">
                    {formatCurrency(row.total_outstanding)}
                  </Td>
                  <Td className="text-right font-mono text-slate-500 px-3">
                    {formatCurrency(row.aging_0_30)}
                  </Td>
                  <Td className="text-right font-mono text-amber-700 px-3">
                    {formatCurrency(row.aging_31_60)}
                  </Td>
                  <Td className="text-right font-mono text-orange-700 px-3">
                    {formatCurrency(row.aging_61_90)}
                  </Td>
                  <Td className="text-right font-mono text-red-700 px-3">
                    {formatCurrency(row.aging_90_plus)}
                  </Td>
                  <Td className="text-right pr-3">
                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="sm" onClick={() => setPaying(row)}>
                        <Banknote size={13} /> Pay
                      </Button>
                      <Link to={`/parties/suppliers/${row.supplier_id}`}
                        className="p-1.5 text-slate-400 hover:text-teal-600 rounded hover:bg-slate-100"
                        title="Open detail">
                        <ChevronRight size={16} />
                      </Link>
                    </div>
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="py-3 px-4 text-sm text-slate-500">Total</td>
                <td className="py-3 px-3 text-right font-mono text-slate-900">{formatCurrency(totals.total)}</td>
                <td className="py-3 px-3 text-right font-mono text-slate-500">{formatCurrency(totals.d0_30)}</td>
                <td className="py-3 px-3 text-right font-mono text-amber-700">{formatCurrency(totals.d31_60)}</td>
                <td className="py-3 px-3 text-right font-mono text-orange-700">{formatCurrency(totals.d61_90)}</td>
                <td className="py-3 px-3 text-right font-mono text-red-700">{formatCurrency(totals.d90plus)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>

      {paying && (
        <PayPaymentSheet row={paying} onClose={() => setPaying(null)}
          onSuccess={() => { setPaying(null); load() }} />
      )}
    </div>
  )
}

function PayPaymentSheet({ row, onClose, onSuccess }: {
  row: PayablesAgingRow
  onClose: () => void
  onSuccess: () => void
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState(row.total_outstanding)
  const [mode, setMode] = useState<'bank' | 'cash'>('bank')
  const [narration, setNarration] = useState(`Payment to ${row.supplier_name}`)
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
      await createPaymentVoucher({
        date, amount, party_id: row.supplier_id,
        payment_mode: mode, narration,
      })
      toast.success('Payment posted')
      onSuccess()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to post payment')
    } finally { setSaving(false) }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent width="md">
        <form onSubmit={submit} className="flex flex-col h-full">
          <SheetHeader>
            <SheetTitle>Make payment</SheetTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              To <span className="font-medium">{row.supplier_name}</span> · Outstanding{' '}
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
              <Field label="Paid from">
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
                Posts a Payment: Debit Trade Payables (party-tagged to {row.supplier_name}),
                Credit {mode === 'bank' ? 'Bank' : 'Cash'}.
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" size={14} />} Post Payment
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

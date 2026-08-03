import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Wallet, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import {
  getOpenCustomerInvoices, createReceiptVoucher,
  type OpenCustomerInvoice,
} from '../lib/api'
import { formatCurrency, formatDate, cn } from '../lib/utils'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeletons'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose,
} from '../components/ui/sheet'
import { useLocation as useActiveLocation } from '../contexts/LocationContext'

/**
 * Receivables — one row per open customer SALE invoice. Click Receive on
 * any row to record a receipt against that customer. Per-invoice balance
 * isn't tracked (no bill-allocation on the customer side); the rightmost
 * "Customer outstanding" column shows the customer's running net so you
 * can see which customers still owe overall.
 */
export default function ReceivablesPage() {
  const [rows, setRows] = useState<OpenCustomerInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [asOf, setAsOf] = useState(new Date().toISOString().split('T')[0])
  const [search, setSearch] = useState('')
  const [receiving, setReceiving] = useState<OpenCustomerInvoice | null>(null)

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (asOf) params.date = asOf
      if (search) params.search = search
      const res = await getOpenCustomerInvoices(params)
      setRows(res.rows)
    } catch {
      toast.error('Failed to load open customer invoices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [asOf])
  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Each row now carries its own remaining balance, so the total is a plain
  // sum. It used to read customer_outstanding — the party's whole balance —
  // once per party, because per-invoice figures did not net part-receipts.
  const totals = useMemo(() => {
    const customers = new Set<number>()
    let sum = 0
    for (const r of rows) {
      customers.add(r.party_id)
      sum += parseFloat(r.outstanding_amount ?? r.amount ?? '0') || 0
    }
    return { invoiceCount: rows.length, customerCount: customers.size, totalOutstanding: sum }
  }, [rows])

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Receivables
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{totals.invoiceCount}</span> open invoice
            {totals.invoiceCount === 1 ? '' : 's'} across <span className="mono">{totals.customerCount}</span>{' '}
            customer{totals.customerCount === 1 ? '' : 's'}, owing{' '}
            <span className="font-medium mono" style={{ color: 'var(--warning)' }}>
              {formatCurrency(totals.totalOutstanding)}
            </span>
            . Click Receive on an invoice to record a payment from that customer.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap w-full sm:w-auto">
          <Input
            type="text"
            placeholder="Search invoice # or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-56"
          />
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>As of</label>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-full sm:w-auto" />
          </div>
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={7} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No outstanding customer invoices"
          description="When customers owe you money, their open invoices will appear here."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">Invoice #</Th>
                <Th className="text-left">Date</Th>
                <Th className="text-left">Type</Th>
                <Th className="text-left">Customer</Th>
                <Th className="text-right px-3">Invoice Amount</Th>
                <Th className="text-right px-3">Outstanding</Th>
                <Th className="w-[140px]" />
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <Tr key={`${r.party_id}-${r.invoice_no}`} className="group">
                  <Td>
                    <span className="font-medium mono" style={{ color: 'var(--brand)' }}>
                      {r.invoice_no}
                    </span>
                  </Td>
                  <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>{formatDate(r.date)}</Td>
                  <Td className="text-xs" style={{ color: 'var(--ink-2)' }}>{r.voucher_type}</Td>
                  <Td className="font-medium">
                    <Link
                      to={`/parties/customers/${r.party_id}`}
                      className="inline-flex items-center gap-1 hover:underline"
                      style={{ color: 'var(--ink)' }}
                    >
                      {r.party_name}
                      <ExternalLink size={11} className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100" style={{ color: 'var(--brand)' }} />
                    </Link>
                  </Td>
                  <Td className="text-right mono px-3" style={{ color: 'var(--ink)' }}>
                    {formatCurrency(r.amount)}
                  </Td>
                  <Td className="text-right mono font-semibold px-3"
                    style={{ color: 'var(--warning)' }}>
                    {formatCurrency(r.outstanding_amount ?? r.amount)}
                  </Td>
                  <Td className="text-right pr-3">
                    <div className="flex items-center justify-end gap-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                      <Button size="sm" onClick={() => setReceiving(r)}>
                        <Wallet size={13} /> Receive
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--color-grey-light)' }} className="font-semibold">
                <td colSpan={5} className="py-3 px-4 text-sm" style={{ color: 'var(--ink-2)' }}>
                  Total · {totals.customerCount} customer{totals.customerCount === 1 ? '' : 's'}
                </td>
                <td className="py-3 px-3 text-right mono" style={{ color: 'var(--warning)' }}>
                  {formatCurrency(totals.totalOutstanding)}
                </td>
                <td />
              </tr>
            </tfoot>
          </Table>
        </Card>
      )}

      {receiving && (
        <ReceivePaymentSheet
          row={receiving}
          onClose={() => setReceiving(null)}
          onSuccess={() => { setReceiving(null); load() }}
        />
      )}
    </div>
  )
}

function ReceivePaymentSheet({ row, onClose, onSuccess }: {
  row: OpenCustomerInvoice
  onClose: () => void
  onSuccess: () => void
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState(row.amount)
  const [mode, setMode] = useState<'bank' | 'cash'>('bank')
  const [narration, setNarration] = useState(`Receipt from ${row.party_name} (${row.invoice_no})`)
  const [saving, setSaving] = useState(false)
  const { activeLocationId } = useActiveLocation()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseFloat(amount) || 0
    if (amt <= 0) { toast.error('Amount must be > 0'); return }
    if (activeLocationId === null) {
      toast.error('Select a specific location before recording a receipt')
      return
    }
    setSaving(true)
    try {
      await createReceiptVoucher({
        date, amount, party_id: row.party_id,
        receipt_mode: mode, narration,
        location_id: activeLocationId,
      })
      toast.success(`Receipt against ${row.invoice_no} posted`)
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
            <SheetTitle>Receive against {row.invoice_no}</SheetTitle>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
              From <span className="font-medium">{row.party_name}</span> · Invoice{' '}
              <span className="font-mono">{formatCurrency(row.amount)}</span> · Customer outstanding{' '}
              <span className="font-mono font-medium">{formatCurrency((row.customer_outstanding ?? '0'))}</span>
            </p>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Date" required>
                  <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Amount" required>
                  <Input type="number" step="0.01" min="0.01" required value={amount}
                    onChange={(e) => setAmount(e.target.value)} className="text-right font-mono" />
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
              <div
                className="text-xs rounded-lg p-3"
                style={{
                  background: 'var(--surface-1)',
                  color: 'var(--ink-3)',
                  border: '1px solid var(--line)',
                }}
              >
                Posts a Receipt at the customer level: Dr {mode === 'bank' ? 'Bank' : 'Cash'} /
                Cr Trade Receivables (party-tagged to {row.party_name}). Customer-side payments
                aren't allocated to specific invoices, so the receipt reduces the customer's
                overall outstanding balance.
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
      <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </span>
      {children}
    </label>
  )
}

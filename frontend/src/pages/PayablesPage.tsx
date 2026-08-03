import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Banknote, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import {
  getBills, recordBillPayment, getOpenSupplierInvoices,
  type Bill, type OpenPartyInvoice,
} from '../lib/api'
import { formatCurrency, formatDate, cn } from '../lib/utils'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeletons'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose,
} from '../components/ui/sheet'

/**
 * Payables — the full amount owed to suppliers/vendors, from BOTH sources:
 *
 *  - Supplier invoices: inventory purchases synced from the inventory system,
 *    which post straight to the GL (party-tagged Trade Payables) and never
 *    create a row in the bills app. Read from the open-supplier-invoices report.
 *  - Vendor bills: manually-entered non-inventory bills (rent, utilities, …),
 *    each with a Pay action that allocates a payment via recordBillPayment.
 *
 * Showing only the latter (the old behaviour) made the page understate
 * payables vs the dashboard, which aggregates the GL. Both are surfaced here.
 *
 * The two are disjoint, which is what makes the grand total below a valid sum:
 * a bills-app bill also posts a party-tagged Payable credit, so the GL report
 * deliberately excludes bills-app entries (see _bills_app_ledger_keys in
 * reports/views.py) rather than reporting the same debt on both tabs.
 */
export default function PayablesPage() {
  const [bills, setBills] = useState<Bill[]>([])
  const [supplierInvoices, setSupplierInvoices] = useState<OpenPartyInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [paying, setPaying] = useState<Bill | null>(null)

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = { status: 'open,partially_paid' }
      if (search) params.search = search
      const supplierParams: Record<string, string> = {}
      if (search) supplierParams.search = search
      const [billRes, supplierRes] = await Promise.all([
        getBills(params),
        getOpenSupplierInvoices(supplierParams).catch(() => ({ rows: [] as OpenPartyInvoice[] })),
      ])
      setBills(billRes.results)
      setSupplierInvoices(supplierRes.rows)
    } catch {
      toast.error('Failed to load payables')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  // Re-fetch when search changes (debounced).
  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const today = new Date().toISOString().slice(0, 10)
  const totals = useMemo(() => {
    return bills.reduce((acc, b) => {
      const due = parseFloat(b.balance_due) || 0
      const overdue = b.due_date && b.due_date < today
      return {
        total: acc.total + due,
        overdue: acc.overdue + (overdue ? due : 0),
        count: acc.count + 1,
      }
    }, { total: 0, overdue: 0, count: 0 })
  }, [bills, today])

  const supplierTotal = useMemo(
    () => supplierInvoices.reduce(
      (s, r) => s + (parseFloat(r.outstanding_amount || r.amount) || 0), 0),
    [supplierInvoices],
  )
  const grandTotal = totals.total + supplierTotal

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Payables
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Total outstanding{' '}
            <span className="font-medium mono" style={{ color: 'var(--warning)' }}>{formatCurrency(grandTotal)}</span>
            {' '}— <span className="mono">{formatCurrency(supplierTotal)}</span> supplier invoices,{' '}
            <span className="mono">{formatCurrency(totals.total)}</span> vendor bills
            {totals.overdue > 0 && (
              <>
                {' '}·{' '}
                <span className="font-medium mono" style={{ color: 'var(--danger)' }}>
                  {formatCurrency(totals.overdue)} bills overdue
                </span>
              </>
            )}
            .
          </p>
        </div>
        <Input
          type="text"
          placeholder="Search invoice/bill # or vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-64"
        />
      </div>

      <Tabs defaultValue="supplier-invoices">
        <TabsList>
          <TabsTrigger value="supplier-invoices">
            Supplier Invoices ({supplierInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="vendor-bills">
            Vendor Bills ({bills.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="supplier-invoices">
          {loading ? (
            <SkeletonTable rows={6} cols={5} />
          ) : supplierInvoices.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No open supplier invoices"
              description="Confirmed inventory purchases appear here once synced. Run a sync if you expect entries."
            />
          ) : (
            <Card className="overflow-hidden p-0">
              <Table>
                <Thead>
                  <Tr>
                    <Th className="text-left">Invoice #</Th>
                    <Th className="text-left">Date</Th>
                    <Th className="text-left">Supplier</Th>
                    <Th className="text-right px-3">Amount</Th>
                    <Th className="text-right px-3">Outstanding</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {supplierInvoices.map((r) => (
                    <Tr key={`${r.invoice_no}-${r.party_id}`}>
                      <Td className="font-medium mono">{r.invoice_no}</Td>
                      <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>{formatDate(r.date)}</Td>
                      <Td className="text-sm" style={{ color: 'var(--ink)' }}>{r.party_name}</Td>
                      <Td className="text-right mono px-3" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(r.amount)}
                      </Td>
                      <Td className="text-right mono px-3 font-semibold" style={{ color: 'var(--warning)' }}>
                        {formatCurrency(r.outstanding_amount || r.amount)}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--color-grey-light)' }} className="font-semibold">
                    <td colSpan={4} className="py-3 px-4 text-sm" style={{ color: 'var(--ink-2)' }}>
                      Total · {supplierInvoices.length} invoice{supplierInvoices.length === 1 ? '' : 's'}
                    </td>
                    <td className="py-3 px-3 text-right mono" style={{ color: 'var(--warning)' }}>
                      {formatCurrency(supplierTotal)}
                    </td>
                  </tr>
                </tfoot>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="vendor-bills">
      {loading ? (
        <SkeletonTable rows={6} cols={8} />
      ) : bills.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="No open bills"
          description="Once you record vendor bills, the unpaid ones will appear here."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">Bill #</Th>
                <Th className="text-left">Date</Th>
                <Th className="text-left">Due</Th>
                <Th className="text-left">Vendor</Th>
                <Th className="text-right px-3">Total</Th>
                <Th className="text-right px-3">Balance Due</Th>
                <Th className="text-left">Status</Th>
                <Th className="w-[140px]" />
              </Tr>
            </Thead>
            <Tbody>
              {bills.map((b) => {
                const overdue = b.due_date && b.due_date < today
                return (
                  <Tr key={b.id} className="group">
                    <Td>
                      <Link
                        to={`/bills/${b.id}`}
                        className="font-medium mono hover:underline"
                        style={{ color: 'var(--brand)' }}
                      >
                        {b.bill_no || `BILL-${b.id}`}
                      </Link>
                    </Td>
                    <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>{formatDate(b.bill_date)}</Td>
                    <Td className={cn('text-sm', overdue && 'font-medium')}
                      style={{ color: overdue ? 'var(--danger)' : 'var(--ink-2)' }}>
                      {b.due_date ? formatDate(b.due_date) : '—'}
                      {overdue && <span className="ml-1 text-xs">(overdue)</span>}
                    </Td>
                    <Td className="text-sm" style={{ color: 'var(--ink)' }}>{b.vendor_name}</Td>
                    <Td className="text-right mono px-3" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(b.total_amount)}
                    </Td>
                    <Td className="text-right mono px-3 font-semibold"
                      style={{ color: parseFloat(b.balance_due) > 0 ? 'var(--warning)' : 'var(--ink-2)' }}>
                      {formatCurrency(b.balance_due)}
                    </Td>
                    <Td>
                      <Badge variant={b.status === 'partially_paid' ? 'warning' : 'default'}>
                        {b.status === 'partially_paid' ? 'Part-paid' : 'Open'}
                      </Badge>
                    </Td>
                    <Td className="text-right pr-3">
                      <div className="flex items-center justify-end gap-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                        <Button size="sm" onClick={() => setPaying(b)}>
                          <Banknote size={13} /> Pay
                        </Button>
                        <Link
                          to={`/bills/${b.id}`}
                          className="p-1.5 rounded hover:bg-[var(--color-hover-bg)]"
                          style={{ color: 'var(--ink-3)' }}
                          title="Open bill"
                        >
                          <ExternalLink size={14} />
                        </Link>
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--color-grey-light)' }} className="font-semibold">
                <td colSpan={5} className="py-3 px-4 text-sm" style={{ color: 'var(--ink-2)' }}>
                  Total · {totals.count} bill{totals.count === 1 ? '' : 's'}
                </td>
                <td className="py-3 px-3 text-right mono" style={{ color: 'var(--warning)' }}>
                  {formatCurrency(totals.total)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </Table>
        </Card>
      )}
        </TabsContent>
      </Tabs>

      {paying && (
        <PayBillSheet
          bill={paying}
          onClose={() => setPaying(null)}
          onSuccess={() => { setPaying(null); load() }}
        />
      )}
    </div>
  )
}

function PayBillSheet({ bill, onClose, onSuccess }: {
  bill: Bill
  onClose: () => void
  onSuccess: () => void
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState(bill.balance_due)
  const [mode, setMode] = useState<'bank' | 'cash'>('bank')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseFloat(amount) || 0
    if (amt <= 0) { toast.error('Amount must be > 0'); return }
    setSaving(true)
    try {
      await recordBillPayment(bill.id, { date, amount, mode, reference, notes })
      toast.success(`Payment recorded against ${bill.bill_no}`)
      onSuccess()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to record payment')
    } finally { setSaving(false) }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent width="md">
        <form onSubmit={submit} className="flex flex-col h-full">
          <SheetHeader>
            <SheetTitle>Pay {bill.bill_no || `Bill #${bill.id}`}</SheetTitle>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
              {bill.vendor_name} · Outstanding{' '}
              <span className="font-mono font-medium">{formatCurrency(bill.balance_due)}</span>
            </p>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Date" required>
                  <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Amount" required>
                  <Input type="number" step="0.01" min="0.01" max={bill.balance_due} required value={amount}
                    onChange={(e) => setAmount(e.target.value)} className="text-right font-mono" />
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
              <Field label="Reference" hint="Cheque #, UTR, transaction ID — optional">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Notes">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </Field>
              <div
                className="text-xs rounded-lg p-3"
                style={{
                  background: 'var(--surface-1)',
                  color: 'var(--ink-3)',
                  border: '1px solid var(--line)',
                }}
              >
                Allocated against this bill specifically — partial payments are supported and the
                bill's status will switch to <strong>Part-paid</strong> until the balance is cleared.
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" size={14} />} Save Payment
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function Field({ label, required, hint, children }: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs mt-1" style={{ color: 'var(--ink-3)' }}>{hint}</span>}
    </label>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus, Loader2, Search, Banknote, Receipt, ArrowLeftRight,
  X, Calendar,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getJournalEntries,
  getSuppliers, getCustomers,
  createPaymentVoucher, createReceiptVoucher, createContraVoucher,
  type JournalEntry, type Party,
} from '../lib/api'
import { formatDate, formatCurrency, cn } from '../lib/utils'
import { useLocation } from '../contexts/LocationContext'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose, SheetTrigger,
} from '../components/ui/sheet'

const VOUCHER_TYPES = [
  'JOURNAL', 'PURCHASE', 'SALE', 'PAYMENT', 'RECEIPT',
  'CONTRA', 'CREDIT_NOTE', 'DEBIT_NOTE',
] as const
const voucherLabel = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

const VOUCHER_BG: Record<string, string> = {
  JOURNAL:     'bg-slate-100 text-slate-700',
  PURCHASE:    'bg-amber-50 text-amber-700',
  SALE:        'bg-emerald-50 text-emerald-700',
  PAYMENT:     'bg-rose-50 text-rose-700',
  RECEIPT:     'bg-sky-50 text-sky-700',
  CONTRA:      'bg-violet-50 text-violet-700',
  CREDIT_NOTE: 'bg-emerald-50 text-emerald-700',
  DEBIT_NOTE:  'bg-amber-50 text-amber-700',
}

function entryAmount(e: JournalEntry): number {
  // Sum of one side (debit total = credit total for posted entries)
  let dr = 0
  for (const l of e.lines) dr += parseFloat(l.debit) || 0
  return dr
}

export default function JournalsPage() {
  const navigate = useNavigate()
  const { activeLocationId } = useLocation()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'posted'>('all')
  const [voucherType, setVoucherType] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [customers, setCustomers] = useState<Party[]>([])

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search) params.narration = search
      if (statusFilter !== 'all') params.is_posted = String(statusFilter === 'posted')
      if (voucherType !== 'all') params.voucher_type = voucherType
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const res = await getJournalEntries(params)
      setEntries(res.results)
      setCount(res.count)
    } catch {
      toast.error('Failed to load journal entries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, voucherType, dateFrom, dateTo, activeLocationId])

  useEffect(() => {
    Promise.all([getSuppliers(), getCustomers()]).then(([s, c]) => {
      setSuppliers(s); setCustomers(c)
    }).catch(() => {/* ignore — quick-add can still use no party */})
  }, [])

  const totals = useMemo(() => {
    let amount = 0
    let drafts = 0
    let posted = 0
    for (const e of entries) {
      amount += entryAmount(e)
      if (e.is_posted) posted++; else drafts++
    }
    return { amount, drafts, posted }
  }, [entries])

  function clearFilters() {
    setSearch('')
    setStatusFilter('all')
    setVoucherType('all')
    setDateFrom('')
    setDateTo('')
  }
  const hasActiveFilters = !!(search || statusFilter !== 'all' || voucherType !== 'all' || dateFrom || dateTo)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Journal Entries</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {count} entries · {totals.drafts} draft · {totals.posted} posted · Total {formatCurrency(totals.amount)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PaymentSheet suppliers={suppliers} onSuccess={load} />
          <ReceiptSheet customers={customers} onSuccess={load} />
          <ContraSheet onSuccess={load} />
          <Button onClick={() => navigate('/journals/new')}>
            <Plus size={16} /> New Journal
          </Button>
        </div>
      </div>

      {/* Status pill bar */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <StatusPill label="All" count={count} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        <StatusPill label="Draft" count={totals.drafts} active={statusFilter === 'draft'} dotClassName="bg-amber-400" onClick={() => setStatusFilter('draft')} />
        <StatusPill label="Posted" count={totals.posted} active={statusFilter === 'posted'} dotClassName="bg-emerald-500" onClick={() => setStatusFilter('posted')} />
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search narration…" className="pl-9 py-1.5" />
        </div>
        <select value={voucherType} onChange={(e) => setVoucherType(e.target.value)}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
          <option value="all">All voucher types</option>
          {VOUCHER_TYPES.map((v) => <option key={v} value={v}>{voucherLabel(v)}</option>)}
        </select>
        <div className="flex items-center gap-1 px-2 py-1 border border-slate-200 rounded-lg bg-white">
          <Calendar size={13} className="text-slate-400" />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="text-xs bg-transparent focus:outline-none" />
          <span className="text-slate-300 text-xs">→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="text-xs bg-transparent focus:outline-none" />
        </div>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
            <X size={12} /> Clear
          </button>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Date</Th>
              <Th className="text-left">Journal #</Th>
              <Th className="text-left">Reference</Th>
              <Th className="text-left">Voucher</Th>
              <Th className="text-left">Notes</Th>
              <Th className="text-right px-3">Amount</Th>
              <Th className="text-left">Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">No journal entries match your filters</td></tr>
            ) : entries.map((entry) => {
              const amount = entryAmount(entry)
              return (
                <Tr key={entry.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/journals/${entry.id}`)}>
                  <Td className="text-sm text-slate-600">{formatDate(entry.date)}</Td>
                  <Td>
                    <Link to={`/journals/${entry.id}`} onClick={(e) => e.stopPropagation()}
                      className="font-mono text-xs text-teal-700 hover:underline">
                      {entry.entry_no}
                    </Link>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {entry.reference_type
                      ? `${entry.reference_type}${entry.reference_id ? ` #${entry.reference_id}` : ''}`
                      : '—'}
                  </Td>
                  <Td>
                    <span className={cn('inline-flex px-2 py-0.5 rounded text-xs font-medium', VOUCHER_BG[entry.voucher_type] || 'bg-slate-100 text-slate-600')}>
                      {voucherLabel(entry.voucher_type)}
                    </span>
                  </Td>
                  <Td className="text-sm text-slate-700 max-w-xs truncate">{entry.narration || '—'}</Td>
                  <Td className="text-right font-mono px-3">{amount > 0 ? formatCurrency(amount) : '—'}</Td>
                  <Td>
                    <Badge variant={entry.is_posted ? 'success' : 'warning'}>
                      {entry.is_posted ? 'Posted' : 'Draft'}
                    </Badge>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

// ─── Status pill ────────────────────────────────────────────────────────────

function StatusPill({ label, count, active, dotClassName, onClick }: {
  label: string
  count: number
  active: boolean
  dotClassName?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
        active
          ? 'bg-teal-50 border-teal-200 text-teal-700'
          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
      )}
    >
      {dotClassName && <span className={cn('w-1.5 h-1.5 rounded-full', dotClassName)} />}
      {label}
      <span className={cn('text-[10px] tabular-nums', active ? 'text-teal-600' : 'text-slate-400')}>
        {count}
      </span>
    </button>
  )
}

// ─── Quick voucher sheets ───────────────────────────────────────────────────

function PaymentSheet({ suppliers, onSuccess }: { suppliers: Party[]; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [partyId, setPartyId] = useState<number | ''>('')
  const [mode, setMode] = useState('bank')
  const [narration, setNarration] = useState('')

  function reset() {
    setAmount(''); setPartyId(''); setNarration(''); setMode('bank')
    setDate(new Date().toISOString().split('T')[0])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await createPaymentVoucher({ date, amount, party_id: partyId || null, payment_mode: mode, narration })
      toast.success('Payment voucher created')
      setOpen(false)
      reset()
      onSuccess()
    } catch {
      toast.error('Failed to create payment')
    } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm"><Banknote size={14} /> Payment</Button>
      </SheetTrigger>
      <SheetContent width="md">
        <form onSubmit={submit} className="flex flex-col h-full">
          <SheetHeader><SheetTitle>Quick Payment</SheetTitle></SheetHeader>
          <SheetBody>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" required>
                <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Amount" required>
                <Input type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Supplier">
                <select value={partyId} onChange={(e) => setPartyId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">— Select supplier —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Paid from">
                <div className="flex gap-2">
                  {['bank', 'cash'].map((m) => (
                    <label key={m} className={cn(
                      'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm',
                      mode === m
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    )}>
                      <input type="radio" name="payment_mode" value={m} checked={mode === m}
                        onChange={() => setMode(m)} className="hidden" />
                      <span className="capitalize">{m}</span>
                    </label>
                  ))}
                </div>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Notes">
                <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Optional" />
              </Field>
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" disabled={saving}>{saving && <Loader2 size={14} className="animate-spin" />} Save Payment</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function ReceiptSheet({ customers, onSuccess }: { customers: Party[]; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [partyId, setPartyId] = useState<number | ''>('')
  const [mode, setMode] = useState('bank')
  const [narration, setNarration] = useState('')

  function reset() {
    setAmount(''); setPartyId(''); setNarration(''); setMode('bank')
    setDate(new Date().toISOString().split('T')[0])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await createReceiptVoucher({ date, amount, party_id: partyId || null, receipt_mode: mode, narration })
      toast.success('Receipt voucher created')
      setOpen(false); reset(); onSuccess()
    } catch {
      toast.error('Failed to create receipt')
    } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm"><Receipt size={14} /> Receipt</Button>
      </SheetTrigger>
      <SheetContent width="md">
        <form onSubmit={submit} className="flex flex-col h-full">
          <SheetHeader><SheetTitle>Quick Receipt</SheetTitle></SheetHeader>
          <SheetBody>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" required>
                <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Amount" required>
                <Input type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Customer">
                <select value={partyId} onChange={(e) => setPartyId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">— Select customer —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Received in">
                <div className="flex gap-2">
                  {['bank', 'cash'].map((m) => (
                    <label key={m} className={cn(
                      'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm',
                      mode === m
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    )}>
                      <input type="radio" name="receipt_mode" value={m} checked={mode === m}
                        onChange={() => setMode(m)} className="hidden" />
                      <span className="capitalize">{m}</span>
                    </label>
                  ))}
                </div>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Notes">
                <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Optional" />
              </Field>
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" disabled={saving}>{saving && <Loader2 size={14} className="animate-spin" />} Save Receipt</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function ContraSheet({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState('bank_to_cash')
  const [narration, setNarration] = useState('')

  function reset() {
    setAmount(''); setNarration(''); setDirection('bank_to_cash')
    setDate(new Date().toISOString().split('T')[0])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await createContraVoucher({ date, amount, direction, narration })
      toast.success('Contra voucher created')
      setOpen(false); reset(); onSuccess()
    } catch {
      toast.error('Failed to create contra')
    } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm"><ArrowLeftRight size={14} /> Contra</Button>
      </SheetTrigger>
      <SheetContent width="md">
        <form onSubmit={submit} className="flex flex-col h-full">
          <SheetHeader><SheetTitle>Bank ↔ Cash Transfer</SheetTitle></SheetHeader>
          <SheetBody>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" required>
                <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Amount" required>
                <Input type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Direction">
                <div className="flex gap-2">
                  {[
                    { v: 'bank_to_cash', label: 'Bank → Cash' },
                    { v: 'cash_to_bank', label: 'Cash → Bank' },
                  ].map((opt) => (
                    <label key={opt.v} className={cn(
                      'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm',
                      direction === opt.v
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    )}>
                      <input type="radio" name="contra_dir" value={opt.v} checked={direction === opt.v}
                        onChange={() => setDirection(opt.v)} className="hidden" />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Notes">
                <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Optional" />
              </Field>
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" disabled={saving}>{saving && <Loader2 size={14} className="animate-spin" />} Save Contra</Button>
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
      <span className="block text-xs font-medium text-slate-600 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}

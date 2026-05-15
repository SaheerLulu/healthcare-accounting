import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus, Loader2, Search, Banknote, Receipt, ArrowLeftRight,
  X, Calendar, ChevronDown,
} from 'lucide-react'
import { voucherList } from './vouchers/voucherConfig'
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
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeletons'
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
  const [postedCount, setPostedCount] = useState(0)
  const [draftCount, setDraftCount] = useState(0)
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
      setPostedCount(res.posted_count ?? 0)
      setDraftCount(res.draft_count ?? 0)
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
    for (const e of entries) {
      amount += entryAmount(e)
    }
    return { amount }
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
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Journal Entries
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{count}</span> entries · <span className="mono">{draftCount}</span> draft ·{' '}
            <span className="mono">{postedCount}</span> posted · Total{' '}
            <span className="mono">{formatCurrency(totals.amount)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PaymentSheet suppliers={suppliers} onSuccess={load} />
          <ReceiptSheet customers={customers} onSuccess={load} />
          <ContraSheet onSuccess={load} />
          <NewVoucherDropdown />
        </div>
      </div>

      {/* Status pill bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusPill label="All" count={count} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        <StatusPill label="Draft" count={draftCount} active={statusFilter === 'draft'} dotColor="var(--warning)" onClick={() => setStatusFilter('draft')} />
        <StatusPill label="Posted" count={postedCount} active={statusFilter === 'posted'} dotColor="var(--success)" onClick={() => setStatusFilter('posted')} />
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search narration…" className="pl-9" />
        </div>
        <select value={voucherType} onChange={(e) => setVoucherType(e.target.value)}
          className="h-9 px-3 text-sm rounded-md outline-none"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-0)', color: 'var(--ink)' }}
        >
          <option value="all">All voucher types</option>
          {VOUCHER_TYPES.map((v) => <option key={v} value={v}>{voucherLabel(v)}</option>)}
        </select>
        <div
          className="flex items-center gap-1 px-2 h-9 rounded-md"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-0)' }}
        >
          <Calendar size={13} style={{ color: 'var(--ink-3)' }} />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="text-xs bg-transparent focus:outline-none" style={{ color: 'var(--ink)' }} />
          <span style={{ color: 'var(--ink-3)' }} className="text-xs">→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="text-xs bg-transparent focus:outline-none" style={{ color: 'var(--ink)' }} />
        </div>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs hover:underline inline-flex items-center gap-1" style={{ color: 'var(--ink-2)' }}>
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : entries.length === 0 ? (
        <EmptyState
          variant={hasActiveFilters ? 'no-results' : 'no-data'}
          title={hasActiveFilters ? 'No journal entries match your filters' : 'No journal entries yet'}
          description={hasActiveFilters ? 'Try adjusting your search or clearing filters.' : 'Post your first journal entry to start tracking transactions.'}
          actionLabel={hasActiveFilters ? undefined : 'New Journal'}
          onAction={hasActiveFilters ? undefined : () => navigate('/journals/new')}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
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
              {entries.map((entry) => {
                const amount = entryAmount(entry)
                return (
                  <Tr key={entry.id} className="cursor-pointer" onClick={() => navigate(`/journals/${entry.id}`)}>
                    <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>{formatDate(entry.date)}</Td>
                    <Td>
                      <Link to={`/journals/${entry.id}`} onClick={(e) => e.stopPropagation()}
                        className="mono text-xs hover:underline" style={{ color: 'var(--brand)' }}>
                        {entry.entry_no}
                      </Link>
                    </Td>
                    <Td className="text-xs" style={{ color: 'var(--ink-3)' }}>
                      {entry.reference_type
                        ? `${entry.reference_type}${entry.reference_id ? ` #${entry.reference_id}` : ''}`
                        : '—'}
                    </Td>
                    <Td>
                      <span className={cn('inline-flex px-2 py-0.5 rounded text-xs font-medium', VOUCHER_BG[entry.voucher_type] || 'bg-slate-100 text-slate-600')}>
                        {voucherLabel(entry.voucher_type)}
                      </span>
                    </Td>
                    <Td className="text-sm max-w-xs truncate" style={{ color: 'var(--ink)' }}>{entry.narration || '—'}</Td>
                    <Td className="text-right mono px-3" style={{ color: 'var(--ink)' }}>{amount > 0 ? formatCurrency(amount) : '—'}</Td>
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
      )}
    </div>
  )
}

// ─── New Voucher dropdown ────────────────────────────────────────────────────

function NewVoucherDropdown() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <Button onClick={() => setOpen((o) => !o)}>
        <Plus size={14} /> New Voucher <ChevronDown size={12} />
      </Button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-lg shadow-lg py-1 min-w-[260px] z-50 dropdown-animate"
          style={{ backgroundColor: 'var(--surface-0)', border: '1px solid var(--line)' }}
        >
          <div
            className="px-3 py-2 mono uppercase"
            style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.1em', fontWeight: 600 }}
          >
            Tally Vouchers
          </div>
          {voucherList.map((v) => (
            <button
              key={v.type}
              onClick={() => { navigate(v.routePath); setOpen(false) }}
              className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-slate-50 text-sm"
              style={{ color: 'var(--ink)' }}
            >
              <span
                className="mono text-[10px] font-bold px-1.5 py-0.5 rounded w-14 text-center flex-shrink-0"
                style={{
                  background: 'rgba(15,157,154,0.10)',
                  color: 'var(--brand)',
                  border: '1px solid rgba(15,157,154,0.20)',
                }}
              >
                {v.fKey}
              </span>
              <span className="flex-1">{v.label}</span>
              <span className="text-xs" style={{ color: 'var(--ink-3)' }}>{v.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Status pill ────────────────────────────────────────────────────────────

function StatusPill({ label, count, active, dotColor, onClick }: {
  label: string
  count: number
  active: boolean
  dotColor?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-3 h-8 rounded-full text-xs font-medium transition-colors"
      style={{
        background: active ? 'rgba(15,157,154,0.10)' : 'var(--surface-0)',
        border: `1px solid ${active ? 'rgba(15,157,154,0.35)' : 'var(--line)'}`,
        color: active ? 'var(--brand)' : 'var(--ink-2)',
      }}
    >
      {dotColor && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />}
      {label}
      <span className="text-[10px] mono" style={{ color: active ? 'var(--brand)' : 'var(--ink-3)' }}>
        {count}
      </span>
    </button>
  )
}

// ─── Quick voucher sheets ───────────────────────────────────────────────────

function PaymentSheet({ suppliers, onSuccess }: { suppliers: Party[]; onSuccess: () => void }) {
  const { activeLocationId } = useLocation()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [partyId, setPartyId] = useState<number | ''>('')
  const [mode, setMode] = useState<'bank' | 'cash'>('bank')
  const [narration, setNarration] = useState('')

  function reset() {
    setAmount(''); setPartyId(''); setNarration(''); setMode('bank')
    setDate(new Date().toISOString().split('T')[0])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (activeLocationId === null) {
      toast.error('Select a specific location before recording a payment')
      return
    }
    setSaving(true)
    try {
      await createPaymentVoucher({
        date, amount, party_id: partyId || null, payment_mode: mode, narration,
        location_id: activeLocationId,
      })
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
                  {(['bank', 'cash'] as const).map((m) => (
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
  const { activeLocationId } = useLocation()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [partyId, setPartyId] = useState<number | ''>('')
  const [mode, setMode] = useState<'bank' | 'cash'>('bank')
  const [narration, setNarration] = useState('')

  function reset() {
    setAmount(''); setPartyId(''); setNarration(''); setMode('bank')
    setDate(new Date().toISOString().split('T')[0])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (activeLocationId === null) {
      toast.error('Select a specific location before recording a receipt')
      return
    }
    setSaving(true)
    try {
      await createReceiptVoucher({
        date, amount, party_id: partyId || null, receipt_mode: mode, narration,
        location_id: activeLocationId,
      })
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
                  {(['bank', 'cash'] as const).map((m) => (
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
  const { activeLocationId } = useLocation()
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
    if (activeLocationId === null) {
      toast.error('Select a specific location before recording a contra')
      return
    }
    setSaving(true)
    try {
      await createContraVoucher({
        date, amount, direction, narration,
        location_id: activeLocationId,
      })
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

import { useEffect, useState } from 'react'
import { Plus, ChevronDown, ChevronRight, Loader2, Trash2, Banknote, Receipt, ArrowLeftRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  getJournalEntries,
  getChartOfAccounts,
  createJournalEntry,
  postEntry,
  getSuppliers,
  getCustomers,
  createPaymentVoucher,
  createReceiptVoucher,
  createContraVoucher,
  type JournalEntry,
  type JournalLine,
  type Account,
  type Party,
} from '../lib/api'
import { formatDate, cn } from '../lib/utils'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogClose } from '../components/ui/dialog'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'

const VOUCHER_TYPES = ['JOURNAL', 'PURCHASE', 'SALE', 'PAYMENT', 'RECEIPT', 'CONTRA', 'CREDIT_NOTE', 'DEBIT_NOTE']
const voucherLabel = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

function JournalRow({ entry, onPost }: { entry: JournalEntry; onPost: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <Tr
        className="cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <Td>
          <div className="flex items-center gap-1 text-slate-400">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        </Td>
        <Td className="text-sm font-mono text-teal-600">{entry.entry_no}</Td>
        <Td className="text-sm text-slate-500">{formatDate(entry.date)}</Td>
        <Td className="text-sm text-slate-900 max-w-xs truncate">{entry.narration}</Td>
        <Td className="text-sm text-slate-500">{voucherLabel(entry.voucher_type)}</Td>
        <Td className="text-sm text-slate-500">{entry.reference_type || '-'}</Td>
        <Td>
          <Badge variant={entry.is_posted ? 'success' : 'warning'}>
            {entry.is_posted ? 'Posted' : 'Draft'}
          </Badge>
        </Td>
        <Td>
          {!entry.is_posted && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onPost(entry.id) }}
              className="text-xs bg-teal-50 hover:bg-teal-100 text-teal-600"
            >
              Post
            </Button>
          )}
        </Td>
      </Tr>
      {expanded && (
        <tr className="bg-slate-50 border-b border-slate-200">
          <td colSpan={8} className="px-8 py-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left pb-1 font-medium">Account</th>
                  <th className="text-right pb-1 font-medium">Debit</th>
                  <th className="text-right pb-1 font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((line, i) => (
                  <tr key={i}>
                    <td className="py-0.5 text-slate-500">{line.account_name || `Account ${line.account}`}</td>
                    <td className="py-0.5 text-right font-mono text-slate-900">
                      {Number(line.debit) > 0 ? `₹${Number(line.debit).toFixed(2)}` : '-'}
                    </td>
                    <td className="py-0.5 text-right font-mono text-slate-900">
                      {Number(line.credit) > 0 ? `₹${Number(line.credit).toFixed(2)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}

const emptyLine = (): Omit<JournalLine, 'id'> => ({ account: 0, debit: '0', credit: '0', narration: '' })

function PaymentVoucherDialog({ suppliers, onSuccess }: { suppliers: Party[]; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [partyId, setPartyId] = useState<number | ''>('')
  const [mode, setMode] = useState('bank')
  const [narration, setNarration] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await createPaymentVoucher({
        date, amount, party_id: partyId || null, payment_mode: mode, narration,
      })
      toast.success('Payment voucher created')
      setOpen(false)
      setAmount(''); setPartyId(''); setNarration('')
      onSuccess()
    } catch { toast.error('Failed to create payment voucher') }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm"><Banknote size={14} /> Payment</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Payment Voucher</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Date *</label>
              <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Amount *</label>
              <Input type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Supplier</label>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value ? Number(e.target.value) : '')}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">-- Select Supplier --</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Payment Mode</label>
            <div className="flex gap-4">
              {['bank', 'cash'].map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="payment_mode" value={m} checked={mode === m} onChange={() => setMode(m)}
                    className="accent-teal-600" />
                  <span className="capitalize">{m}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Narration</label>
            <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Payment description..." />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
            <Button type="submit" disabled={saving}>{saving && <Loader2 size={14} className="animate-spin" />} Save Payment</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ReceiptVoucherDialog({ customers, onSuccess }: { customers: Party[]; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [partyId, setPartyId] = useState<number | ''>('')
  const [mode, setMode] = useState('bank')
  const [narration, setNarration] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await createReceiptVoucher({
        date, amount, party_id: partyId || null, receipt_mode: mode, narration,
      })
      toast.success('Receipt voucher created')
      setOpen(false)
      setAmount(''); setPartyId(''); setNarration('')
      onSuccess()
    } catch { toast.error('Failed to create receipt voucher') }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm"><Receipt size={14} /> Receipt</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Receipt Voucher</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Date *</label>
              <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Amount *</label>
              <Input type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Customer</label>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value ? Number(e.target.value) : '')}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">-- Select Customer --</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Receipt Mode</label>
            <div className="flex gap-4">
              {['bank', 'cash'].map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="receipt_mode" value={m} checked={mode === m} onChange={() => setMode(m)}
                    className="accent-teal-600" />
                  <span className="capitalize">{m}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Narration</label>
            <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Receipt description..." />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
            <Button type="submit" disabled={saving}>{saving && <Loader2 size={14} className="animate-spin" />} Save Receipt</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ContraVoucherDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState('bank_to_cash')
  const [narration, setNarration] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await createContraVoucher({ date, amount, direction, narration })
      toast.success('Contra voucher created')
      setOpen(false)
      setAmount(''); setNarration('')
      onSuccess()
    } catch { toast.error('Failed to create contra voucher') }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm"><ArrowLeftRight size={14} /> Contra</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Contra Voucher</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Date *</label>
              <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Amount *</label>
              <Input type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Direction</label>
            <div className="flex gap-4">
              {[{ value: 'bank_to_cash', label: 'Bank → Cash' }, { value: 'cash_to_bank', label: 'Cash → Bank' }].map((d) => (
                <label key={d.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="direction" value={d.value} checked={direction === d.value} onChange={() => setDirection(d.value)}
                    className="accent-teal-600" />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Narration</label>
            <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Contra description..." />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
            <Button type="submit" disabled={saving}>{saving && <Loader2 size={14} className="animate-spin" />} Save Contra</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function JournalsPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [customers, setCustomers] = useState<Party[]>([])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [voucherType, setVoucherType] = useState('')
  const [searchNarration, setSearchNarration] = useState('')
  const [searchEntryNo, setSearchEntryNo] = useState('')

  // Form state
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0])
  const [formNarration, setFormNarration] = useState('')
  const [formVoucher, setFormVoucher] = useState('JOURNAL')
  const [lines, setLines] = useState<Omit<JournalLine, 'id'>[]>([emptyLine(), emptyLine()])

  async function load() {
    setLoading(true)
    const params: Record<string, string> = {}
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    if (voucherType) params.voucher_type = voucherType
    if (searchNarration) params.narration = searchNarration
    if (searchEntryNo) params.entry_no = searchEntryNo
    try {
      const res = await getJournalEntries(params)
      setEntries(res.results)
      setTotal(res.count)
    } catch {
      toast.error('Failed to load journal entries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [dateFrom, dateTo, voucherType, searchNarration, searchEntryNo])

  useEffect(() => {
    getChartOfAccounts().then(setAccounts).catch(() => {})
    getSuppliers().then(setSuppliers).catch(() => {})
    getCustomers().then(setCustomers).catch(() => {})
  }, [])

  async function handlePost(id: number) {
    try {
      await postEntry(id)
      toast.success('Entry posted')
      load()
    } catch {
      toast.error('Failed to post entry')
    }
  }

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0)
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!balanced) { toast.error('Debits must equal credits'); return }
    setSaving(true)
    try {
      await createJournalEntry({
        date: formDate,
        narration: formNarration,
        voucher_type: formVoucher,
        lines: lines.filter((l) => l.account !== 0) as JournalLine[],
      })
      toast.success('Journal entry created')
      setOpen(false)
      setLines([emptyLine(), emptyLine()])
      setFormNarration('')
      load()
    } catch {
      toast.error('Failed to create entry')
    } finally {
      setSaving(false)
    }
  }

  function updateLine(i: number, field: keyof Omit<JournalLine, 'id'>, value: string | number) {
    const updated = [...lines]
    updated[i] = { ...updated[i], [field]: value }
    setLines(updated)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Journal Entries</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} entries</p>
        </div>
        <div className="flex items-center gap-2">
          <PaymentVoucherDialog suppliers={suppliers} onSuccess={load} />
          <ReceiptVoucherDialog customers={customers} onSuccess={load} />
          <ContraVoucherDialog onSuccess={load} />
          <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus size={16} /> Manual Entry
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Manual Entry</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSave} className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Date *</label>
                  <Input type="date" required value={formDate} onChange={(e) => setFormDate(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Voucher Type</label>
                  <select value={formVoucher} onChange={(e) => setFormVoucher(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 capitalize">
                    {VOUCHER_TYPES.map((t) => <option key={t} value={t}>{voucherLabel(t)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Narration</label>
                  <Input value={formNarration} onChange={(e) => setFormNarration(e.target.value)}
                    placeholder="Description..." />
                </div>
              </div>

              {/* Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Journal Lines</p>
                  <button type="button" onClick={() => setLines([...lines, emptyLine()])}
                    className="text-xs text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1">
                    <Plus size={12} /> Add Line
                  </button>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Account</th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Debit</th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Credit</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, i) => (
                        <tr key={i} className="border-t border-slate-200">
                          <td className="py-1.5 px-3">
                            <select
                              value={line.account}
                              onChange={(e) => updateLine(i, 'account', Number(e.target.value))}
                              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500"
                            >
                              <option value={0}>-- Select Account --</option>
                              {accounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>{acc.account_code} - {acc.account_name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1.5 px-3">
                            <input
                              type="number" step="0.01" min="0"
                              value={line.debit}
                              onChange={(e) => updateLine(i, 'debit', e.target.value)}
                              className="w-full text-right text-xs border border-slate-200 rounded px-2 py-1.5 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono"
                            />
                          </td>
                          <td className="py-1.5 px-3">
                            <input
                              type="number" step="0.01" min="0"
                              value={line.credit}
                              onChange={(e) => updateLine(i, 'credit', e.target.value)}
                              className="w-full text-right text-xs border border-slate-200 rounded px-2 py-1.5 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono"
                            />
                          </td>
                          <td className="py-1.5 px-2">
                            <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}
                              className="text-slate-400 hover:text-red-500">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                        <td className="py-2 px-3 text-xs font-semibold text-slate-500">Totals</td>
                        <td className={cn("py-2 px-3 text-right text-xs font-mono font-semibold", balanced ? 'text-emerald-600' : 'text-red-600')}>
                          {totalDebit.toFixed(2)}
                        </td>
                        <td className={cn("py-2 px-3 text-right text-xs font-mono font-semibold", balanced ? 'text-emerald-600' : 'text-red-600')}>
                          {totalCredit.toFixed(2)}
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
                {!balanced && (
                  <p className="mt-1.5 text-xs text-red-600">Debits and credits must balance.</p>
                )}
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <DialogClose asChild>
                  <Button type="button" variant="secondary">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={saving || !balanced}>
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Save Entry
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="px-2.5 py-1.5 w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="px-2.5 py-1.5 w-auto" />
        </div>
        <select value={voucherType} onChange={(e) => setVoucherType(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 capitalize">
          <option value="">All Types</option>
          {VOUCHER_TYPES.map((t) => <option key={t} value={t}>{voucherLabel(t)}</option>)}
        </select>
        <Input value={searchNarration} onChange={(e) => setSearchNarration(e.target.value)}
          placeholder="Search narration..." className="px-2.5 py-1.5 w-44" />
        <Input value={searchEntryNo} onChange={(e) => setSearchEntryNo(e.target.value)}
          placeholder="Entry no..." className="px-2.5 py-1.5 w-36" />
        {(dateFrom || dateTo || voucherType || searchNarration || searchEntryNo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); setVoucherType(''); setSearchNarration(''); setSearchEntryNo('') }}
            className="text-xs text-slate-500 hover:text-slate-900 underline">Clear filters</button>
        )}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="w-8" />
              <Th>Entry No</Th>
              <Th>Date</Th>
              <Th>Narration</Th>
              <Th>Type</Th>
              <Th>Reference</Th>
              <Th>Status</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No journal entries found</td></tr>
            ) : (
              entries.map((entry) => <JournalRow key={entry.id} entry={entry} onPost={handlePost} />)
            )}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

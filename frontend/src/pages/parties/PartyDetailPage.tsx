import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Mail, Phone, MapPin, Plus, Trash2, Download, Pencil, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import {
  getSupplierDetail, getCustomerDetail,
  getPartyTransactions, getPartyStatement, getPartyCommunications,
  createPartyCommunication, deletePartyCommunication,
  upsertPartyOpeningBalance, deletePartyOpeningBalance,
  type PartyType, type SupplierDetail, type CustomerDetail,
  type PartyTransaction, type PartyStatement, type PartyCommunication,
} from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Card } from '../../components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
} from '../../components/ui/dialog'

type Detail = (SupplierDetail | CustomerDetail) & { _kind: PartyType }

function isCustomer(d: Detail): d is CustomerDetail & { _kind: 'Customer' } {
  return d._kind === 'Customer'
}

export default function PartyDetailPage({ partyType }: { partyType: PartyType }) {
  const { id } = useParams<{ id: string }>()
  const partyId = Number(id)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)

  async function reload() {
    setLoading(true)
    try {
      const data = partyType === 'Supplier'
        ? await getSupplierDetail(partyId)
        : await getCustomerDetail(partyId)
      setDetail({ ...data, _kind: partyType })
    } catch {
      toast.error(`Failed to load ${partyType.toLowerCase()}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [partyType, partyId])

  const baseRoute = partyType === 'Supplier' ? '/parties/suppliers' : '/parties/customers'
  const heading = partyType === 'Supplier' ? 'Supplier' : 'Customer'

  if (loading || !detail) {
    return (
      <div className="p-12 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600 inline" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Link to={baseRoute} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to {heading}s
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{detail.name}</h1>
          <div className="flex items-center gap-3 text-sm text-slate-500 mt-1 flex-wrap">
            {detail.gst_no && <span className="font-mono">{detail.gst_no}</span>}
            <Badge variant={detail.status?.toLowerCase() === 'active' ? 'success' : 'default'}>
              {detail.status || 'unknown'}
            </Badge>
            {isCustomer(detail) && detail.customer_type && (
              <Badge variant="info">{detail.customer_type}</Badge>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="statement">Statement</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab detail={detail} partyType={partyType} partyId={partyId} onChange={reload} /></TabsContent>
        <TabsContent value="transactions"><TransactionsTab partyType={partyType} partyId={partyId} /></TabsContent>
        <TabsContent value="emails"><EmailsTab partyType={partyType} partyId={partyId} defaultEmail={detail.email} /></TabsContent>
        <TabsContent value="statement"><StatementTab partyType={partyType} partyId={partyId} partyName={detail.name} /></TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Overview ──────────────────────────────────────────────────────────────

function OverviewTab({ detail, partyType, partyId, onChange }: { detail: Detail; partyType: PartyType; partyId: number; onChange: () => void }) {
  const outstandingLabel = partyType === 'Supplier' ? 'Payable' : 'Receivable'
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="p-4">
        <div className="text-xs text-slate-500 uppercase tracking-wider">Total Invoices</div>
        <div className="text-2xl font-semibold text-slate-900 mt-1 font-mono">
          {formatCurrency(detail.summary.total_invoices)}
        </div>
        <div className="text-xs text-slate-400 mt-1">{detail.summary.invoice_count} entries</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-slate-500 uppercase tracking-wider">Settled</div>
        <div className="text-2xl font-semibold text-emerald-700 mt-1 font-mono">
          {formatCurrency(detail.summary.total_settled)}
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-slate-500 uppercase tracking-wider">Outstanding {outstandingLabel}</div>
        <div className={`text-2xl font-semibold mt-1 font-mono ${parseFloat(detail.summary.outstanding) > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
          {formatCurrency(detail.summary.outstanding)}
        </div>
        {detail.summary.last_transaction_date && (
          <div className="text-xs text-slate-400 mt-1">Last txn {formatDate(detail.summary.last_transaction_date)}</div>
        )}
      </Card>

      <Card className="p-4 md:col-span-3">
        <OpeningBalanceCard
          partyType={partyType}
          partyId={partyId}
          amount={detail.summary.opening_balance}
          asOf={detail.summary.opening_balance_as_of}
          onChange={onChange}
        />
      </Card>

      <Card className="p-4 md:col-span-2">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Contact</h3>
        <dl className="grid grid-cols-2 gap-y-3 text-sm">
          {'contact_person' in detail && detail.contact_person && (
            <>
              <dt className="text-slate-500">Contact Person</dt>
              <dd className="text-slate-900">{detail.contact_person}</dd>
            </>
          )}
          <dt className="text-slate-500 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Phone</dt>
          <dd className="text-slate-900">{detail.phone || '—'}</dd>
          <dt className="text-slate-500 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email</dt>
          <dd className="text-slate-900">{detail.email || '—'}</dd>
          <dt className="text-slate-500 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Address</dt>
          <dd className="text-slate-900">
            {[detail.address, detail.city, detail.state, detail.pincode].filter(Boolean).join(', ') || '—'}
          </dd>
        </dl>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Terms</h3>
        <dl className="grid grid-cols-2 gap-y-3 text-sm">
          <dt className="text-slate-500">Payment Terms</dt>
          <dd className="text-slate-900">{detail.payment_terms || '—'}</dd>
          <dt className="text-slate-500">Credit Days</dt>
          <dd className="text-slate-900">{detail.credit_days}</dd>
          {isCustomer(detail) && (
            <>
              <dt className="text-slate-500">Credit Limit</dt>
              <dd className="text-slate-900 font-mono">{formatCurrency(detail.credit_limit)}</dd>
              {detail.customer_code && (
                <>
                  <dt className="text-slate-500">Code</dt>
                  <dd className="text-slate-900 font-mono">{detail.customer_code}</dd>
                </>
              )}
            </>
          )}
        </dl>
      </Card>
    </div>
  )
}

function OpeningBalanceCard({
  partyType, partyId, amount, asOf, onChange,
}: {
  partyType: PartyType
  partyId: number
  amount: string
  asOf: string | null
  onChange: () => void
}) {
  const [open, setOpen] = useState(false)
  const hasOpening = parseFloat(amount) !== 0 || !!asOf
  const sideLabel = partyType === 'Supplier' ? 'we owe' : 'owed to us'

  async function handleClear() {
    if (!confirm('Clear the opening balance for this party?')) return
    try {
      await deletePartyOpeningBalance(partyType, partyId)
      toast.success('Opening balance cleared')
      onChange()
    } catch {
      toast.error('Failed to clear')
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-amber-700 flex-shrink-0">
          <Wallet className="w-4 h-4" />
        </div>
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wider">Opening Balance</div>
          {hasOpening ? (
            <>
              <div className="text-xl font-semibold text-slate-900 mt-1 font-mono">
                {formatCurrency(amount)}
                <span className="ml-2 text-xs font-normal text-slate-500">{sideLabel}</span>
              </div>
              {asOf && <div className="text-xs text-slate-400 mt-0.5">As of {formatDate(asOf)}</div>}
            </>
          ) : (
            <div className="text-sm text-slate-400 mt-1">
              No opening balance — set one to carry forward a balance from before this system.
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" size="sm">
              {hasOpening ? <><Pencil className="w-3.5 h-3.5" /> Edit</> : <><Plus className="w-3.5 h-3.5" /> Set</>}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{hasOpening ? 'Edit' : 'Set'} opening balance</DialogTitle></DialogHeader>
            <OpeningBalanceForm
              partyType={partyType}
              partyId={partyId}
              initialAmount={hasOpening ? amount : ''}
              initialAsOf={asOf}
              onSaved={() => { setOpen(false); onChange() }}
            />
          </DialogContent>
        </Dialog>
        {hasOpening && (
          <button
            onClick={handleClear}
            className="text-slate-400 hover:text-red-600 transition-colors p-1.5"
            title="Clear opening balance"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

function OpeningBalanceForm({
  partyType, partyId, initialAmount, initialAsOf, onSaved,
}: {
  partyType: PartyType
  partyId: number
  initialAmount: string
  initialAsOf: string | null
  onSaved: () => void
}) {
  const today = new Date()
  const fyStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
  const defaultAsOf = `${fyStartYear}-04-01`
  const [amount, setAmount] = useState(initialAmount)
  const [asOf, setAsOf] = useState(initialAsOf || defaultAsOf)
  const [narration, setNarration] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const sign = partyType === 'Supplier' ? 'we owe them' : 'they owe us'
  const numeric = parseFloat(amount)
  const isNegative = !isNaN(numeric) && numeric < 0
  const flippedSign = partyType === 'Supplier' ? 'they owe us' : 'we owe them'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || isNaN(numeric)) {
      toast.error('Enter a valid amount')
      return
    }
    setSubmitting(true)
    try {
      await upsertPartyOpeningBalance(partyType, partyId, {
        amount: amount,
        as_of_date: asOf,
        narration,
      })
      toast.success('Opening balance saved')
      onSaved()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">
        <span className="text-slate-500">Amount (positive = {sign})</span>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm font-mono"
        />
        {isNegative && (
          <span className="text-xs text-amber-700 mt-1 block">
            Negative amount means {flippedSign} (advance / credit balance).
          </span>
        )}
      </label>
      <label className="block text-sm">
        <span className="text-slate-500">As of date</span>
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          required
          className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="text-slate-500">Narration (optional)</span>
        <input
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          placeholder="e.g. Carried forward from previous accounting system"
          className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm"
        />
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
        </Button>
      </div>
    </form>
  )
}

// ─── Transactions ──────────────────────────────────────────────────────────

function TransactionsTab({ partyType, partyId }: { partyType: PartyType; partyId: number }) {
  const [rows, setRows] = useState<PartyTransaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getPartyTransactions(partyType, partyId)
      .then((d) => { if (!cancelled) setRows(d.rows) })
      .catch(() => toast.error('Failed to load transactions'))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [partyType, partyId])

  return (
    <Card className="overflow-x-auto overflow-hidden">
      <Table>
        <Thead>
          <Tr className="bg-slate-50">
            <Th className="text-left">Date</Th>
            <Th className="text-left">Entry</Th>
            <Th className="text-left">Voucher</Th>
            <Th className="text-left">Reference</Th>
            <Th className="text-left">Narration</Th>
            <Th className="text-right px-3">Debit</Th>
            <Th className="text-right px-3">Credit</Th>
          </Tr>
        </Thead>
        <Tbody>
          {loading ? (
            <tr><td colSpan={7} className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-teal-600 inline" /></td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">No transactions</td></tr>
          ) : rows.map((r) => (
            <Tr key={r.entry_id}>
              <Td className="text-slate-600">{formatDate(r.date)}</Td>
              <Td className="font-mono text-xs text-teal-700">{r.entry_no}</Td>
              <Td><Badge variant="info">{r.voucher_type}</Badge></Td>
              <Td className="text-xs text-slate-500">
                {r.reference_type ? `${r.reference_type} #${r.reference_id ?? ''}` : '—'}
              </Td>
              <Td className="text-sm text-slate-600 max-w-xs truncate">{r.narration || '—'}</Td>
              <Td className="text-right font-mono px-3">{parseFloat(r.debit) > 0 ? formatCurrency(r.debit) : '—'}</Td>
              <Td className="text-right font-mono px-3">{parseFloat(r.credit) > 0 ? formatCurrency(r.credit) : '—'}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  )
}

// ─── Emails / Communications ───────────────────────────────────────────────

function EmailsTab({ partyType, partyId, defaultEmail }: { partyType: PartyType; partyId: number; defaultEmail: string }) {
  const [rows, setRows] = useState<PartyCommunication[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const d = await getPartyCommunications(partyType, partyId)
      setRows(d.rows)
    } catch {
      toast.error('Failed to load emails')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [partyType, partyId])

  async function handleDelete(commId: number) {
    if (!confirm('Delete this entry?')) return
    try {
      await deletePartyCommunication(commId)
      toast.success('Deleted')
      load()
    } catch {
      toast.error('Failed to delete')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">Manually logged communications with this {partyType.toLowerCase()}.</p>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4" /> Log Email</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Log communication</DialogTitle></DialogHeader>
            <CommunicationForm
              partyType={partyType}
              partyId={partyId}
              defaultEmail={defaultEmail}
              onCreated={() => { setShowDialog(false); load() }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-teal-600 inline" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">No communications logged yet</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((c) => (
              <li key={c.id} className="p-4 flex items-start gap-4 hover:bg-slate-50">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center text-teal-700">
                  {c.channel === 'email' && <Mail className="w-4 h-4" />}
                  {c.channel === 'phone' && <Phone className="w-4 h-4" />}
                  {c.channel === 'whatsapp' && <span className="text-xs font-bold">WA</span>}
                  {c.channel === 'note' && <span className="text-xs font-bold">N</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900">{c.subject}</span>
                    <Badge variant={c.direction === 'out' ? 'info' : 'primary'}>
                      {c.direction === 'out' ? 'Outgoing' : 'Incoming'}
                    </Badge>
                    <span className="text-xs text-slate-400">{formatDate(c.communicated_at)}</span>
                  </div>
                  {c.contact && <div className="text-xs text-slate-500 mt-0.5">{c.contact}</div>}
                  {c.body && <div className="text-sm text-slate-600 mt-1.5 whitespace-pre-wrap">{c.body}</div>}
                  {c.created_by_username && (
                    <div className="text-xs text-slate-400 mt-1.5">Logged by {c.created_by_username}</div>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(c.id)}
                  className="text-slate-400 hover:text-red-600 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function CommunicationForm({
  partyType, partyId, defaultEmail, onCreated,
}: {
  partyType: PartyType
  partyId: number
  defaultEmail: string
  onCreated: () => void
}) {
  const [channel, setChannel] = useState<PartyCommunication['channel']>('email')
  const [direction, setDirection] = useState<PartyCommunication['direction']>('out')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [contact, setContact] = useState(defaultEmail || '')
  const [communicatedAt, setCommunicatedAt] = useState(() => new Date().toISOString().slice(0, 16))
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim()) {
      toast.error('Subject is required')
      return
    }
    setSubmitting(true)
    try {
      await createPartyCommunication(partyType, partyId, {
        channel, direction, subject, body, contact,
        communicated_at: new Date(communicatedAt).toISOString(),
      })
      toast.success('Logged')
      onCreated()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="text-slate-500">Channel</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}
            className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm">
            <option value="email">Email</option>
            <option value="phone">Phone</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="note">Note</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-500">Direction</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}
            className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm">
            <option value="out">Outgoing</option>
            <option value="in">Incoming</option>
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-slate-500">Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} required
          className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm" />
      </label>
      <label className="block text-sm">
        <span className="text-slate-500">Contact (email / phone)</span>
        <input value={contact} onChange={(e) => setContact(e.target.value)}
          className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm" />
      </label>
      <label className="block text-sm">
        <span className="text-slate-500">Body / Notes</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4}
          className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm" />
      </label>
      <label className="block text-sm">
        <span className="text-slate-500">When</span>
        <input type="datetime-local" value={communicatedAt} onChange={(e) => setCommunicatedAt(e.target.value)}
          className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm" />
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
        </Button>
      </div>
    </form>
  )
}

// ─── Statement ─────────────────────────────────────────────────────────────

function StatementTab({ partyType, partyId, partyName }: { partyType: PartyType; partyId: number; partyName: string }) {
  const today = new Date()
  const fyStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
  const [startDate, setStartDate] = useState(`${fyStartYear}-04-01`)
  const [endDate, setEndDate] = useState(today.toISOString().slice(0, 10))
  const [data, setData] = useState<PartyStatement | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = { start_date: startDate, end_date: endDate }
      const d = await getPartyStatement(partyType, partyId, params)
      setData(d)
    } catch {
      toast.error('Failed to load statement')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [partyType, partyId, startDate, endDate])

  const totals = useMemo(() => {
    if (!data) return { debit: 0, credit: 0 }
    let debit = 0, credit = 0
    for (const r of data.rows) {
      debit += parseFloat(r.debit) || 0
      credit += parseFloat(r.credit) || 0
    }
    return { debit, credit }
  }, [data])

  function downloadCsv() {
    if (!data) return
    const debitLabel = partyType === 'Supplier' ? 'Payment' : 'Debit'
    const creditLabel = partyType === 'Supplier' ? 'Invoice' : 'Credit'
    const lines = [
      `Statement of Account — ${partyName}`,
      `Period,${data.start_date} to ${data.end_date}`,
      `Opening Balance,${data.opening_balance}`,
      '',
      `Date,Entry,Voucher,Reference,Narration,${debitLabel},${creditLabel},Balance`,
      ...data.rows.map((r) => [
        r.date, r.entry_no, r.voucher_type,
        r.reference_type ? `${r.reference_type} #${r.reference_id ?? ''}` : '',
        (r.narration || '').replace(/[",\n]/g, ' '),
        r.debit, r.credit, r.balance,
      ].join(',')),
      '',
      `Closing Balance,${data.closing_balance}`,
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `statement-${partyName.replace(/\s+/g, '_')}-${data.end_date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const debitHeader = partyType === 'Supplier' ? 'Payment' : 'Debit'
  const creditHeader = partyType === 'Supplier' ? 'Invoice' : 'Credit'

  return (
    <div>
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <label className="block text-sm">
          <span className="text-slate-500 block mb-1">From</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm" />
        </label>
        <label className="block text-sm">
          <span className="text-slate-500 block mb-1">To</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm" />
        </label>
        <Button variant="secondary" size="sm" onClick={downloadCsv} disabled={!data || data.rows.length === 0}>
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Card className="p-3">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Opening</div>
            <div className="text-lg font-semibold font-mono mt-0.5">{formatCurrency(data.opening_balance)}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Period Activity</div>
            <div className="text-sm font-mono mt-0.5">
              <span className="text-slate-700">Dr {formatCurrency(totals.debit)}</span>
              <span className="text-slate-400 mx-2">·</span>
              <span className="text-slate-700">Cr {formatCurrency(totals.credit)}</span>
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Closing</div>
            <div className={`text-lg font-semibold font-mono mt-0.5 ${parseFloat(data.closing_balance) > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
              {formatCurrency(data.closing_balance)}
            </div>
          </Card>
        </div>
      )}

      <Card className="overflow-x-auto overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Date</Th>
              <Th className="text-left">Entry</Th>
              <Th className="text-left">Voucher</Th>
              <Th className="text-left">Narration</Th>
              <Th className="text-right px-3">{debitHeader}</Th>
              <Th className="text-right px-3">{creditHeader}</Th>
              <Th className="text-right px-3">Balance</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-teal-600 inline" /></td></tr>
            ) : !data || (data.rows.length === 0 && parseFloat(data.opening_balance) === 0) ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">No transactions in this period</td></tr>
            ) : (
              <>
                <Tr className="bg-slate-50/50">
                  <Td colSpan={6} className="text-slate-500 italic text-sm">
                    Opening balance
                    {data.opening_balance_as_of && parseFloat(data.stored_opening_balance) !== 0 && (
                      <span className="text-xs not-italic ml-2 text-amber-700">
                        (incl. carry-forward {formatCurrency(data.stored_opening_balance)} as of {formatDate(data.opening_balance_as_of)})
                      </span>
                    )}
                  </Td>
                  <Td className="text-right font-mono font-semibold px-3">{formatCurrency(data.opening_balance)}</Td>
                </Tr>
                {data.rows.map((r, idx) => (
                  <Tr key={`${r.entry_no}-${idx}`}>
                    <Td className="text-slate-600">{formatDate(r.date)}</Td>
                    <Td className="font-mono text-xs text-teal-700">{r.entry_no}</Td>
                    <Td><Badge variant="info">{r.voucher_type}</Badge></Td>
                    <Td className="text-sm text-slate-600 max-w-xs truncate">{r.narration || '—'}</Td>
                    <Td className="text-right font-mono px-3">{parseFloat(r.debit) > 0 ? formatCurrency(r.debit) : '—'}</Td>
                    <Td className="text-right font-mono px-3">{parseFloat(r.credit) > 0 ? formatCurrency(r.credit) : '—'}</Td>
                    <Td className="text-right font-mono font-semibold px-3">{formatCurrency(r.balance)}</Td>
                  </Tr>
                ))}
                <Tr className="bg-slate-50">
                  <Td colSpan={6} className="text-slate-700 font-semibold text-sm">Closing balance</Td>
                  <Td className="text-right font-mono font-bold px-3">{formatCurrency(data.closing_balance)}</Td>
                </Tr>
              </>
            )}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

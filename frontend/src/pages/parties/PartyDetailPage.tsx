import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Mail, Phone, MapPin, Plus, Trash2, Download, Pencil, Wallet, Banknote, Receipt as ReceiptIcon, FileStack, BookOpen } from 'lucide-react'
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
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

type Detail = (SupplierDetail | CustomerDetail) & { _kind: PartyType }

function isCustomer(d: Detail): d is CustomerDetail & { _kind: 'Customer' } {
  return d._kind === 'Customer'
}

/**
 * A panel's own actions, published upward so the ONE page-level keyboard
 * registration can reach them.
 *
 * The hint bar is a per-screen register — `registerHints` replaces the whole
 * list and clears it on unmount — so a second `usePageKeyboard` inside a tab
 * would wipe the page's hints the moment the tab mounted, and empty the bar
 * again when it switched away. Instead each tab parks its callbacks here while
 * it is mounted and the page gates the matching chord on the active tab.
 */
interface TabCommands {
  exportCsv?: () => void
  deleteFocusedComm?: () => void
}

type TabId = 'overview' | 'transactions' | 'emails' | 'statement'

export default function PartyDetailPage({ partyType }: { partyType: PartyType }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const partyId = Number(id)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabId>('overview')
  // Both dialogs are opened by a chord as well as by their button, so the open
  // state lives here rather than inside the card that renders them.
  const [obOpen, setObOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  // Alt+D is a ROW verb, and a row verb may only fire while the keyboard is
  // actually on a row. `useListKeyboardNav` starts `active` at 0 and paints
  // the active row only on :focus-visible, so an ungated Alt+D pressed off the
  // hint bar would have deleted the FIRST logged entry with nothing on screen
  // tying the chord to it. EmailsTab owns the focus; the page owns the one
  // registration, so the panel reports up. Gating also keeps the verb out of
  // the hint bar until it has a target — F3 is how you give it one.
  const [commRowFocused, setCommRowFocused] = useState(false)
  const statementFromRef = useRef<HTMLInputElement>(null)
  const cmds = useRef<TabCommands>({})

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
  const isSupplier = partyType === 'Supplier'
  const ledgerRoute = `/reports/ledger/${isSupplier ? `2105-S${partyId}` : `1125-C${partyId}`}`

  /**
   * F3 into whichever list the visible tab is showing. Each panel wires its own
   * `useListKeyboardNav`, which puts `data-kbd-row` on the rows and a roving
   * tabIndex={0} on the active one — so the page only has to find that row
   * inside the open panel; it does not need a handle on the panel's hook.
   */
  function focusActiveList() {
    const panel = document.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]')
    const row =
      panel?.querySelector<HTMLElement>('[data-kbd-row][tabindex="0"]') ??
      panel?.querySelector<HTMLElement>('[data-kbd-row]')
    row?.focus()
    row?.scrollIntoView({ block: 'nearest' })
  }

  /**
   * Alt+L / Alt+B from inside a field on this page.
   *
   * Both are advertised in the hint bar and as keycaps on their buttons, but
   * neither is in the shared GLOBAL_ALLOW_LIST, so `shouldIgnoreEvent` drops
   * them the moment focus sits in an input — i.e. straight after F2, which
   * parks focus in the statement's From date. Two advertised header actions
   * were dead from the page's own filter while the F-key ones kept working.
   * Rather than widen a list every screen shares, the page answers its own two
   * chords as they bubble out of its fields; everywhere else the global
   * listener still owns them, and it ignores exactly the events handled here,
   * so a chord never fires twice. Radix portals an open dialog's content, but
   * its events still bubble through this React tree, so overlays are skipped —
   * an overlay owns the keyboard.
   */
  function onFieldKeyDown(e: React.KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const el = e.target as HTMLElement | null
    const tag = el?.tagName
    if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return
    if (el?.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return
    const key = e.key.toLowerCase()
    if (key === 'l') {
      e.preventDefault()
      navigate(ledgerRoute)
    } else if (key === 'b') {
      if (!isSupplier) return
      e.preventDefault()
      navigate(`/vouchers/payment?party_id=${partyId}&alloc=1`)
    }
  }

  // The <kbd> badges beside Make Payment / Purchase / Receipt / Sales used to
  // be a lie: nothing on this screen bound them, so the key fell through to
  // Layout's global voucher navigation and opened a BLANK voucher. Registering
  // them here wins (HotkeyContext runs the most recent registration first) and
  // carries the party through, which is what the badge always promised.
  usePageKeyboard({
    actions: [
      { chord: 'Alt+L', label: 'GL ledger', run: () => navigate(ledgerRoute) },
      ...(isSupplier
        ? [
            { chord: 'F5', label: 'Payment', run: () => navigate(`/vouchers/payment?party_id=${partyId}`) },
            { chord: 'Alt+B', label: 'Pay bills', run: () => navigate(`/vouchers/payment?party_id=${partyId}&alloc=1`) },
            { chord: 'F9', label: 'Purchase', run: () => navigate(`/vouchers/purchase?party_id=${partyId}`) },
          ]
        : [
            { chord: 'F6', label: 'Receipt', run: () => navigate(`/vouchers/receipt?party_id=${partyId}`) },
            { chord: 'F8', label: 'Sales', run: () => navigate(`/vouchers/sales?party_id=${partyId}`) },
          ]),
      { chord: 'Alt+O', label: 'Opening balance', when: tab === 'overview', run: () => setObOpen(true) },
      { chord: 'Alt+N', label: 'Log email', when: tab === 'emails', run: () => setLogOpen(true) },
      {
        chord: 'Alt+D',
        label: 'Delete entry',
        when: tab === 'emails' && commRowFocused,
        run: () => cmds.current.deleteFocusedComm?.(),
      },
      { chord: 'Alt+X', label: 'Export CSV', when: tab === 'statement', run: () => cmds.current.exportCsv?.() },
      // hintOnly: the TabsTrigger chords do the switching — that is what runs
      // the strip's onValueChange — and these entries exist purely to reach
      // the bottom hint bar and F1, which a shared component must not write
      // to. Listed last: the tab strip is the frame, not the verb.
      { chord: 'Alt+1', label: 'Overview', hintOnly: true, run: () => {} },
      { chord: 'Alt+2', label: 'Transactions', hintOnly: true, run: () => {} },
      { chord: 'Alt+3', label: 'Emails', hintOnly: true, run: () => {} },
      { chord: 'Alt+4', label: 'Statement', hintOnly: true, run: () => {} },
    ],
    // F2 is "the filter box"; only the statement has one.
    searchRef: tab === 'statement' ? statementFromRef : undefined,
    onFocusList: tab === 'overview' ? undefined : focusActiveList,
    onBack: () => navigate(baseRoute),
  })

  if (loading || !detail) {
    return (
      <div className="p-12 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600 inline" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5" onKeyDown={onFieldKeyDown}>
      <Link to={baseRoute} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to {heading}s
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>{detail.name}</h1>
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
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            chord="Alt+L"
            title="Open this party's general-ledger account (Sundry Creditor/Debtor)"
            onClick={() => navigate(ledgerRoute)}
          >
            <BookOpen size={14} /> GL Ledger
          </Button>
          {partyType === 'Supplier' ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                chord="F5"
                onClick={() => navigate(`/vouchers/payment?party_id=${partyId}`)}
              >
                <Banknote size={14} /> Make Payment
              </Button>
              <Button
                size="sm"
                chord="Alt+B"
                onClick={() => navigate(`/vouchers/payment?party_id=${partyId}&alloc=1`)}
              >
                <FileStack size={14} /> Pay Bills
              </Button>
              <Button
                variant="secondary"
                size="sm"
                chord="F9"
                onClick={() => navigate(`/vouchers/purchase?party_id=${partyId}`)}
              >
                <Plus size={14} /> Purchase
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                chord="F6"
                onClick={() => navigate(`/vouchers/receipt?party_id=${partyId}`)}
              >
                <ReceiptIcon size={14} /> Record Receipt
              </Button>
              <Button
                variant="secondary"
                size="sm"
                chord="F8"
                onClick={() => navigate(`/vouchers/sales?party_id=${partyId}`)}
              >
                <Plus size={14} /> Sales
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Controlled so the page knows which panel's chords to register — and
          each trigger carries a chord of its own, because from deep inside a
          panel switching view otherwise means Shift+Tabbing back to the strip. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList label={`${heading} views`}>
          <TabsTrigger value="overview" chord="Alt+1">Overview</TabsTrigger>
          <TabsTrigger value="transactions" chord="Alt+2">Transactions</TabsTrigger>
          <TabsTrigger value="emails" chord="Alt+3">Emails</TabsTrigger>
          <TabsTrigger value="statement" chord="Alt+4">Statement</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab
            detail={detail}
            partyType={partyType}
            partyId={partyId}
            onChange={reload}
            obOpen={obOpen}
            setObOpen={setObOpen}
          />
        </TabsContent>
        <TabsContent value="transactions"><TransactionsTab partyType={partyType} partyId={partyId} /></TabsContent>
        <TabsContent value="emails">
          <EmailsTab
            partyType={partyType}
            partyId={partyId}
            defaultEmail={detail.email}
            logOpen={logOpen}
            setLogOpen={setLogOpen}
            cmds={cmds}
            onRowFocusChange={setCommRowFocused}
          />
        </TabsContent>
        <TabsContent value="statement">
          <StatementTab
            partyType={partyType}
            partyId={partyId}
            partyName={detail.name}
            fromRef={statementFromRef}
            cmds={cmds}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Overview ──────────────────────────────────────────────────────────────

function OverviewTab({ detail, partyType, partyId, onChange, obOpen, setObOpen }: {
  detail: Detail
  partyType: PartyType
  partyId: number
  onChange: () => void
  obOpen: boolean
  setObOpen: (open: boolean) => void
}) {
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
          open={obOpen}
          setOpen={setObOpen}
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
  partyType, partyId, amount, asOf, onChange, open, setOpen,
}: {
  partyType: PartyType
  partyId: number
  amount: string
  asOf: string | null
  onChange: () => void
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  // Ctrl+S / Ctrl+Enter inside the dialog commit through the form itself, so
  // the browser still runs `required` validation the Save button would.
  const formRef = useRef<HTMLFormElement>(null)
  const hasOpening = parseFloat(amount) !== 0 || !!asOf
  const sideLabel = partyType === 'Supplier' ? 'we owe' : 'owed to us'

  async function handleClear() {
    setClearing(true)
    try {
      await deletePartyOpeningBalance(partyType, partyId)
      toast.success('Opening balance cleared')
      setConfirmClear(false)
      onChange()
    } catch {
      toast.error('Failed to clear')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-amber-700 flex-shrink-0">
          <Wallet className="w-4 h-4" />
        </div>
        <div className="min-w-0">
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
      <div className="flex items-center gap-2 flex-shrink-0">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" size="sm" chord="Alt+O">
              {hasOpening ? <><Pencil className="w-3.5 h-3.5" /> Edit</> : <><Plus className="w-3.5 h-3.5" /> Set</>}
            </Button>
          </DialogTrigger>
          <DialogContent
            description="Opening balance carried forward from before this system"
            onSubmit={() => formRef.current?.requestSubmit()}
          >
            <DialogHeader><DialogTitle>{hasOpening ? 'Edit' : 'Set'} opening balance</DialogTitle></DialogHeader>
            <OpeningBalanceForm
              formRef={formRef}
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
            type="button"
            onClick={() => setConfirmClear(true)}
            className="text-slate-400 hover:text-red-600 transition-colors p-2.5 -m-1 sm:p-1.5 sm:m-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            title="Clear opening balance"
            aria-label="Clear opening balance"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear opening balance?"
        description="The carried-forward balance for this party will be removed."
        confirmLabel="Clear"
        tone="danger"
        loading={clearing}
        onConfirm={handleClear}
      />
    </div>
  )
}

function OpeningBalanceForm({
  formRef, partyType, partyId, initialAmount, initialAsOf, onSaved,
}: {
  formRef: RefObject<HTMLFormElement>
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
    <form ref={formRef} onSubmit={submit} className="space-y-3">
      <label className="block text-sm">
        <span className="text-slate-500">Amount (positive = {sign})</span>
        <input
          type="number"
          step="0.01"
          data-autofocus
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
      <div className="flex items-center justify-end gap-2 pt-2">
        <span className="text-xs mr-auto" style={{ color: 'var(--ink-3)' }}>
          <kbd className="mono">Ctrl+S</kbd> saves from any field
        </span>
        <Button type="submit" disabled={submitting} chord="Ctrl+S">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
        </Button>
      </div>
    </form>
  )
}

// ─── Transactions ──────────────────────────────────────────────────────────

function TransactionsTab({ partyType, partyId }: { partyType: PartyType; partyId: number }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<PartyTransaction[]>([])
  const [loading, setLoading] = useState(true)

  // ↑↓ / Home / End / PgUp / PgDn over the rows, Enter opens the journal entry
  // the teal entry number names — it looked like a link and did nothing.
  const list = useListKeyboardNav({
    count: rows.length,
    onActivate: (i) => navigate(`/journals/${rows[i].entry_id}`),
  })

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
    <Card className="overflow-hidden">
      <Table label="Transactions">
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
        <Tbody {...list.containerProps}>
          {loading ? (
            <tr><td colSpan={7} className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-teal-600 inline" /></td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">No transactions</td></tr>
          ) : rows.map((r, i) => (
            <Tr
              key={r.entry_id}
              className="cursor-pointer"
              onClick={() => navigate(`/journals/${r.entry_id}`)}
              {...list.rowProps(i)}
            >
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

function EmailsTab({ partyType, partyId, defaultEmail, logOpen, setLogOpen, cmds, onRowFocusChange }: {
  partyType: PartyType
  partyId: number
  defaultEmail: string
  logOpen: boolean
  setLogOpen: (open: boolean) => void
  cmds: RefObject<TabCommands>
  /** Whether the keyboard is on a logged entry — gates the page's Alt+D. */
  onRowFocusChange: (focused: boolean) => void
}) {
  const [rows, setRows] = useState<PartyCommunication[]>([])
  const [loading, setLoading] = useState(true)
  // The whole row, not just its id: a one-keystroke delete has to name what it
  // is about to remove, and the confirm is the only place left to say it.
  const [confirmRow, setConfirmRow] = useState<PartyCommunication | null>(null)
  const [deleting, setDeleting] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  // One tab stop for the whole log, ↑↓ between entries — deleting the nth
  // entry used to cost n Tab presses because every row held its own button.
  const list = useListKeyboardNav({ count: rows.length })

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

  // Leaving the tab unmounts this panel, and a delete can empty the list under
  // the focused row — either way the page must stop advertising a row verb
  // that has no target left.
  useEffect(() => () => onRowFocusChange(false), [onRowFocusChange])
  useEffect(() => {
    if (rows.length === 0) onRowFocusChange(false)
  }, [rows.length, onRowFocusChange])

  // Alt+D is registered once at page level; it needs to know which row the
  // keyboard is on, which only this component knows.
  useEffect(() => {
    const ref = cmds.current
    if (!ref) return
    ref.deleteFocusedComm = () => {
      const row = rows[list.active]
      if (row) setConfirmRow(row)
    }
    return () => { ref.deleteFocusedComm = undefined }
  }, [cmds, rows, list.active])

  async function handleDelete() {
    if (!confirmRow) return
    setDeleting(true)
    try {
      await deletePartyCommunication(confirmRow.id)
      toast.success('Deleted')
      setConfirmRow(null)
      load()
    } catch {
      toast.error('Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <p className="text-sm text-slate-500">Manually logged communications with this {partyType.toLowerCase()}.</p>
        <Dialog open={logOpen} onOpenChange={setLogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" chord="Alt+N"><Plus className="w-4 h-4" /> Log Email</Button>
          </DialogTrigger>
          <DialogContent
            description="Log a communication with this party"
            onSubmit={() => formRef.current?.requestSubmit()}
          >
            <DialogHeader><DialogTitle>Log communication</DialogTitle></DialogHeader>
            <CommunicationForm
              formRef={formRef}
              partyType={partyType}
              partyId={partyId}
              defaultEmail={defaultEmail}
              onCreated={() => { setLogOpen(false); load() }}
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
          <ul
            className="divide-y divide-slate-100"
            {...list.containerProps}
            onFocus={() => onRowFocusChange(true)}
            onBlur={(e) => {
              // React's onBlur is focusout, so it fires for the rows too —
              // only a move OUT of the list counts as leaving it.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                onRowFocusChange(false)
              }
            }}
          >
            {rows.map((c, i) => (
              <li
                key={c.id}
                className="p-4 flex items-start gap-4 hover:bg-slate-50"
                aria-label={`${c.subject} — ${formatDate(c.communicated_at)}`}
                {...list.rowProps(i)}
              >
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
                  type="button"
                  onClick={() => setConfirmRow(c)}
                  className="text-slate-400 hover:text-red-600 transition-colors flex-shrink-0 p-2.5 -m-2.5 sm:p-0 sm:m-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                  title="Delete"
                  aria-label={`Delete logged entry ${c.subject}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={confirmRow !== null}
        onOpenChange={(o) => { if (!o) setConfirmRow(null) }}
        title={confirmRow ? `Delete “${confirmRow.subject}”?` : 'Delete this entry?'}
        description={confirmRow
          ? `${confirmRow.direction === 'out' ? 'Outgoing' : 'Incoming'} ${confirmRow.channel}`
            + ` · ${formatDate(confirmRow.communicated_at)}`
            + (confirmRow.contact ? ` · ${confirmRow.contact}` : '')
            + ' — the logged communication will be removed permanently.'
          : 'The logged communication will be removed permanently.'}
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  )
}

function CommunicationForm({
  formRef, partyType, partyId, defaultEmail, onCreated,
}: {
  formRef: RefObject<HTMLFormElement>
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
    <form ref={formRef} onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        {/* The dialog focuses [data-autofocus] on open; without it focus would
            land on the Channel select and every log would start with a Tab. */}
        <input data-autofocus value={subject} onChange={(e) => setSubject(e.target.value)} required
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
      <div className="flex items-center justify-end gap-2 pt-2">
        <span className="text-xs mr-auto" style={{ color: 'var(--ink-3)' }}>
          <kbd className="mono">Ctrl+S</kbd> saves from any field
        </span>
        <Button type="submit" disabled={submitting} chord="Ctrl+S">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
        </Button>
      </div>
    </form>
  )
}

// ─── Statement ─────────────────────────────────────────────────────────────

function StatementTab({ partyType, partyId, partyName, fromRef, cmds }: {
  partyType: PartyType
  partyId: number
  partyName: string
  /** F2 lands here — the period is this screen's filter. */
  fromRef: RefObject<HTMLInputElement>
  cmds: RefObject<TabCommands>
}) {
  const today = new Date()
  const fyStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
  const [startDate, setStartDate] = useState(`${fyStartYear}-04-01`)
  const [endDate, setEndDate] = useState(today.toISOString().slice(0, 10))
  const [data, setData] = useState<PartyStatement | null>(null)
  const [loading, setLoading] = useState(true)

  // The statement rows carry no entry id (the API returns `entry_no` only), so
  // there is nothing for Enter to open — but a hundred-line period still has to
  // be readable with ↑↓ / PgDn instead of only by mouse-scrolling.
  const list = useListKeyboardNav({ count: data?.rows.length ?? 0 })

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

  // Alt+X is registered once at page level and routed here while this tab is
  // the mounted one — the export needs `data`, which only lives in this panel.
  // No dependency list on purpose: the callback closes over `data`, so it is
  // republished on every render and the chord can never fire a stale export.
  useEffect(() => {
    const ref = cmds.current
    if (!ref) return
    ref.exportCsv = () => { if (data && data.rows.length > 0) downloadCsv() }
    return () => { ref.exportCsv = undefined }
  })

  return (
    <div>
      <div className="flex items-end gap-2 sm:gap-3 mb-4 flex-wrap">
        <label className="block text-sm w-full sm:w-auto sm:flex-initial">
          <span className="text-slate-500 block mb-1">From</span>
          <input ref={fromRef} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="w-full sm:w-auto px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm" />
        </label>
        <label className="block text-sm w-full sm:w-auto sm:flex-initial">
          <span className="text-slate-500 block mb-1">To</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="w-full sm:w-auto px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm" />
        </label>
        <Button variant="secondary" size="sm" chord="Alt+X" onClick={downloadCsv} disabled={!data || data.rows.length === 0}
          className="w-full sm:w-auto">
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
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

      <Card className="overflow-hidden">
        <Table label="Statement of account">
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
          <Tbody {...list.containerProps}>
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
                  <Tr key={`${r.entry_no}-${idx}`} {...list.rowProps(idx)}>
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

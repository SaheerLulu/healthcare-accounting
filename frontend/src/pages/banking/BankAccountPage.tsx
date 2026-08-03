import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Loader2, UploadCloud, Plus, ArrowUpRight, ArrowDownLeft,
  Check, X, Tag, Eye, Trash2, Search,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getBankAccount, getBankTransactions,
  importBankCsv, getBankTxnSuggestions,
  matchBankTxn, unmatchBankTxn, excludeBankTxn, restoreBankTxn,
  categorizeBankTxn, createBankTransaction, deleteBankTransaction,
  getChartOfAccounts, getSuppliers, getCustomers,
  getCashInHand, depositCashToBank,
  type BankAccount, type BankTransaction, type Account, type Party, type MatchSuggestion,
} from '../../lib/api'
import { formatCurrency, formatDate, cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose, SheetTrigger,
} from '../../components/ui/sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../../components/ui/dialog'
import { AccountPicker } from '../journals/AccountPicker'

type Tab = 'review' | 'matched' | 'excluded' | 'all'

export default function BankAccountPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const accountId = Number(id)
  const [account, setAccount] = useState<BankAccount | null>(null)
  const [txns, setTxns] = useState<BankTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('review')
  const [search, setSearch] = useState('')

  const [glAccounts, setGlAccounts] = useState<Account[]>([])
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [customers, setCustomers] = useState<Party[]>([])

  async function load() {
    setLoading(true)
    try {
      const [acc, list] = await Promise.all([
        getBankAccount(accountId),
        getBankTransactions({
          bank_account: String(accountId),
          ...(tab !== 'all' ? { status: tab === 'review' ? 'unmatched' : tab } : {}),
          ...(search ? { search } : {}),
        }),
      ])
      setAccount(acc)
      setTxns(list.results)
    } catch {
      toast.error('Failed to load bank account')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    Promise.all([getChartOfAccounts(), getSuppliers(), getCustomers()])
      .then(([gl, s, c]) => { setGlAccounts(gl); setSuppliers(s); setCustomers(c) })
      .catch(() => {/* ok */})
  }, [])

  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, tab, search])

  const counts = useMemo(() => {
    let unmatched = 0, matched = 0, excluded = 0
    for (const t of txns) {
      if (t.status === 'unmatched') unmatched++
      else if (t.status === 'matched') matched++
      else if (t.status === 'excluded') excluded++
    }
    return { unmatched, matched, excluded }
  }, [txns])

  if (!account && loading) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline text-teal-600" size={24} /></div>
  }
  if (!account) return null

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <button onClick={() => navigate('/banking')}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3">
        <ArrowLeft size={14} /> Back to Banking
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>{account.name}</h1>
          <div className="text-sm text-slate-500 mt-0.5">
            {account.bank_name && <span>{account.bank_name} · </span>}
            <span className="font-mono">{account.chart_account_code} {account.chart_account_name}</span>
            {account.account_number && <span className="ml-2 text-slate-400">****{account.account_number.slice(-4)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {account.account_type !== 'cash' && (
            <DepositCashDialog bankAccount={account} onDeposited={load} />
          )}
          <ImportCsvDialog bankAccount={account} onImported={load} />
          <ManualTxnSheet bankAccount={account} onCreated={load} />
        </div>
      </div>

      {/* Balances */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card className="p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Books</div>
          <div className="text-xl font-semibold text-slate-900 mt-1 font-mono">{formatCurrency(account.book_balance)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Statement</div>
          <div className="text-xl font-semibold text-slate-700 mt-1 font-mono">{formatCurrency(account.statement_balance)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Difference</div>
          <div className={cn('text-xl font-semibold mt-1 font-mono',
            Math.abs(parseFloat(account.statement_balance) - parseFloat(account.book_balance)) > 0.005
              ? 'text-amber-700' : 'text-emerald-700'
          )}>
            {formatCurrency(parseFloat(account.statement_balance) - parseFloat(account.book_balance))}
          </div>
        </Card>
      </div>

      {/* Tab pills */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <Pill label="For Review" count={tab === 'review' ? counts.unmatched : account.unmatched_count}
              active={tab === 'review'} dot="bg-amber-400" onClick={() => setTab('review')} />
        <Pill label="Matched" count={tab === 'matched' ? counts.matched : -1}
              active={tab === 'matched'} dot="bg-emerald-500" onClick={() => setTab('matched')} />
        <Pill label="Excluded" count={tab === 'excluded' ? counts.excluded : -1}
              active={tab === 'excluded'} dot="bg-slate-400" onClick={() => setTab('excluded')} />
        <Pill label="All" count={-1} active={tab === 'all'} onClick={() => setTab('all')} />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search description / reference…" className="pl-9 py-1.5" />
        </div>
      </div>

      {/* Transactions */}
      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></div>
        ) : txns.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">
            {tab === 'review'
              ? 'Nothing to review. Import a statement or add a transaction.'
              : 'No transactions match your filters.'}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {txns.map((t) => (
              <TxnRow
                key={t.id}
                txn={t}
                glAccounts={glAccounts}
                suppliers={suppliers}
                customers={customers}
                onChange={load}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ─── Single row with inline actions ─────────────────────────────────────────

function TxnRow({ txn, glAccounts, suppliers, customers, onChange }: {
  txn: BankTransaction
  glAccounts: Account[]
  suppliers: Party[]
  customers: Party[]
  onChange: () => void
}) {
  const isIn = txn.direction === 'in'
  const [matchOpen, setMatchOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)

  async function handleExclude() {
    try { await excludeBankTxn(txn.id); onChange(); toast.success('Excluded') }
    catch { toast.error('Failed to exclude') }
  }
  async function handleRestore() {
    try { await restoreBankTxn(txn.id); onChange(); toast.success('Restored') }
    catch { toast.error('Failed to restore') }
  }
  async function handleUnmatch() {
    if (!confirm('Unmatch this transaction?')) return
    try { await unmatchBankTxn(txn.id); onChange(); toast.success('Unmatched') }
    catch { toast.error('Failed') }
  }
  async function handleDelete() {
    if (!confirm('Delete this transaction?')) return
    try { await deleteBankTransaction(txn.id); onChange(); toast.success('Deleted') }
    catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to delete')
    }
  }

  return (
    <li className="px-4 py-3 hover:bg-slate-50">
      <div className="flex items-start gap-3">
        <div className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
          isIn ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        )}>
          {isIn ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-900 truncate min-w-0 lg:min-w-[auto]">
              {txn.description || '(no description)'}
            </span>
            {txn.source === 'manual' && <Badge variant="default">Manual</Badge>}
            {txn.status === 'matched' && <Badge variant="success">Matched</Badge>}
            {txn.status === 'excluded' && <Badge variant="default">Excluded</Badge>}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {formatDate(txn.date)}
            {txn.reference && <> · {txn.reference}</>}
            {txn.matched_entry_no && (
              <> · linked to <Link to={`/journals/${txn.matched_journal_entry}`}
                                   className="text-teal-700 hover:underline font-mono">{txn.matched_entry_no}</Link></>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={cn('font-mono font-semibold text-sm',
            isIn ? 'text-emerald-700' : 'text-rose-700'
          )}>
            {isIn ? '+' : '−'} {formatCurrency(txn.abs_amount)}
          </span>
          {txn.running_balance != null && (
            <span className="text-xs text-slate-400 font-mono">bal {formatCurrency(txn.running_balance)}</span>
          )}
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 mt-2.5 ml-12 flex-wrap">
        {txn.status === 'unmatched' && (
          <>
            <Button size="sm" onClick={() => setMatchOpen(true)}>
              <Check size={13} /> Match
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setCatOpen(true)}>
              <Tag size={13} /> Categorize
            </Button>
            <Button size="sm" variant="ghost" onClick={handleExclude}>
              <Eye size={13} /> Exclude
            </Button>
          </>
        )}
        {txn.status === 'matched' && (
          <>
            <Button size="sm" variant="secondary" onClick={handleUnmatch}>
              <X size={13} /> Unmatch
            </Button>
          </>
        )}
        {txn.status === 'excluded' && (
          <Button size="sm" variant="secondary" onClick={handleRestore}>
            <Eye size={13} /> Restore
          </Button>
        )}
        {txn.source === 'manual' && txn.status !== 'matched' && (
          <button onClick={handleDelete}
                  className="text-xs text-slate-400 hover:text-rose-600 ml-auto inline-flex items-center gap-1">
            <Trash2 size={12} /> Delete
          </button>
        )}
      </div>

      {/* Match dialog */}
      {matchOpen && (
        <MatchDialog txn={txn} open={matchOpen} onClose={() => setMatchOpen(false)}
          onMatched={() => { setMatchOpen(false); onChange() }} />
      )}
      {/* Categorize sheet */}
      {catOpen && (
        <CategorizeSheet txn={txn} open={catOpen} onClose={() => setCatOpen(false)}
          glAccounts={glAccounts} suppliers={suppliers} customers={customers}
          onCategorized={() => { setCatOpen(false); onChange() }} />
      )}
    </li>
  )
}

// ─── Match dialog ──────────────────────────────────────────────────────────

function MatchDialog({ txn, open, onClose, onMatched }: {
  txn: BankTransaction
  open: boolean
  onClose: () => void
  onMatched: () => void
}) {
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [matching, setMatching] = useState<number | null>(null)
  const [manualId, setManualId] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getBankTxnSuggestions(txn.id)
      .then((d) => setSuggestions(d.rows))
      .catch(() => toast.error('Failed to load suggestions'))
      .finally(() => setLoading(false))
  }, [open, txn.id])

  async function pick(entryId: number) {
    setMatching(entryId)
    try {
      await matchBankTxn(txn.id, entryId)
      toast.success('Matched')
      onMatched()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to match')
    } finally { setMatching(null) }
  }

  async function pickManual(e: React.FormEvent) {
    e.preventDefault()
    const id = parseInt(manualId, 10)
    if (!id) return
    pick(id)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Match transaction</DialogTitle></DialogHeader>
        <div className="text-sm text-slate-500 mb-3">
          {formatDate(txn.date)} · {txn.description || '(no description)'} ·{' '}
          <span className="font-mono">{txn.direction === 'in' ? '+' : '−'} {formatCurrency(txn.abs_amount)}</span>
        </div>

        {loading ? (
          <div className="py-6 text-center"><Loader2 size={20} className="animate-spin inline text-teal-600" /></div>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-slate-400 py-3">
            No matching journal entries found. Try Categorize, or paste a journal entry ID below.
          </p>
        ) : (
          <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100 mb-3">
            {suggestions.map((s) => (
              <li key={s.entry_id} className="p-3 hover:bg-slate-50 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-teal-700">{s.entry_no}</span>
                    <Badge variant="info">{s.voucher_type}</Badge>
                    <span className="text-xs text-slate-400">{formatDate(s.date)}</span>
                    {s.days_off > 0 && (
                      <span className="text-[10px] text-slate-400">±{s.days_off}d</span>
                    )}
                  </div>
                  <div className="text-sm text-slate-600 truncate mt-0.5">{s.narration || '—'}</div>
                </div>
                <Button size="sm" onClick={() => pick(s.entry_id)} disabled={matching === s.entry_id}>
                  {matching === s.entry_id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Match
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={pickManual} className="border-t border-slate-100 pt-3 flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[9rem] block text-xs">
            <span className="text-slate-500 block mb-1">Or match by Journal Entry ID</span>
            <Input value={manualId} onChange={(e) => setManualId(e.target.value)} type="number"
              placeholder="e.g. 42" />
          </label>
          <Button type="submit" variant="secondary" disabled={!manualId}>Match</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Categorize sheet ──────────────────────────────────────────────────────

function CategorizeSheet({ txn, open, onClose, glAccounts, suppliers, customers, onCategorized }: {
  txn: BankTransaction
  open: boolean
  onClose: () => void
  glAccounts: Account[]
  suppliers: Party[]
  customers: Party[]
  onCategorized: () => void
}) {
  const [accountId, setAccountId] = useState<number | null>(null)
  const [partyType, setPartyType] = useState<'' | 'Supplier' | 'Customer'>('')
  const [partyId, setPartyId] = useState<number | ''>('')
  const [narration, setNarration] = useState(txn.description || '')
  const [saving, setSaving] = useState(false)

  // Sensible default party type from direction
  useEffect(() => {
    if (open) {
      setPartyType(txn.direction === 'in' ? 'Customer' : 'Supplier')
      setPartyId('')
      setAccountId(null)
      setNarration(txn.description || '')
    }
  }, [open, txn])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!accountId) { toast.error('Pick a category account'); return }
    setSaving(true)
    try {
      await categorizeBankTxn(txn.id, {
        account_id: accountId,
        party_type: partyType,
        party_id: partyType ? (partyId || null) : null,
        narration,
      })
      toast.success('Categorized — journal entry posted')
      onCategorized()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to categorize')
    } finally { setSaving(false) }
  }

  const partyList = partyType === 'Customer' ? customers : partyType === 'Supplier' ? suppliers : []

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent width="md">
        <form onSubmit={submit} className="flex flex-col h-full">
          <SheetHeader>
            <SheetTitle>Categorize {txn.direction === 'in' ? 'deposit' : 'spend'}</SheetTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              {formatDate(txn.date)} · <span className="font-mono">{txn.direction === 'in' ? '+' : '−'} {formatCurrency(txn.abs_amount)}</span>
              {txn.description && <> · {txn.description}</>}
            </p>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-3">
              <Field label={txn.direction === 'in' ? 'Income / settled account' : 'Expense / settled account'} required
                hint="A receipt credits this; a payment debits it">
                <AccountPicker accounts={glAccounts} value={accountId}
                  onChange={(id) => setAccountId(id)} />
              </Field>

              <Field label="Tag a party" hint="Optional — for outstanding tracking">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select value={partyType} onChange={(e) => { setPartyType(e.target.value as typeof partyType); setPartyId('') }}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                    <option value="">— None —</option>
                    <option value="Supplier">Supplier</option>
                    <option value="Customer">Customer</option>
                  </select>
                  <select value={partyId} onChange={(e) => setPartyId(e.target.value ? Number(e.target.value) : '')}
                    disabled={!partyType}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400">
                    <option value="">— Select —</option>
                    {partyList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </Field>

              <Field label="Narration">
                <Input value={narration} onChange={(e) => setNarration(e.target.value)}
                  placeholder="Will appear on the journal entry" />
              </Field>

              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-3">
                {txn.direction === 'in' ? (
                  <>This will create a <span className="font-medium">Receipt</span> entry: Debit{' '}
                    <span className="font-mono">{txn.bank_account_name}</span>, Credit the selected account.</>
                ) : (
                  <>This will create a <span className="font-medium">Payment</span> entry: Debit the selected account, Credit{' '}
                    <span className="font-mono">{txn.bank_account_name}</span>.</>
                )}
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" size={14} />} Post Entry
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// ─── Deposit cash dialog ───────────────────────────────────────────────────

function DepositCashDialog({ bankAccount, onDeposited }: { bankAccount: BankAccount; onDeposited: () => void }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [narration, setNarration] = useState('')
  const [cashInHand, setCashInHand] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    getCashInHand().then((d) => setCashInHand(d.cash_in_hand)).catch(() => setCashInHand(null))
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || parseFloat(amount) <= 0) { toast.error('Amount must be > 0'); return }
    setSaving(true)
    try {
      const r = await depositCashToBank(bankAccount.id, { date, amount, narration })
      toast.success(`Cash deposited — ${r.entry_no}`)
      setOpen(false); setAmount(''); setNarration(''); onDeposited()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to deposit cash')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <ArrowDownLeft size={14} /> Deposit Cash
      </Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Deposit cash into {bankAccount.name}</DialogTitle></DialogHeader>
        <p className="text-xs text-slate-500 mb-3">
          Moves cash-in-hand (accumulated from cash sales) into this bank account.
          Books <span className="font-mono">Dr {bankAccount.chart_account_code} / Cr Cash</span>.
          {cashInHand != null && (
            <> Current cash-in-hand: <span className="font-mono font-medium">{formatCurrency(cashInHand)}</span>.</>
          )}
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Date" required>
              <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Amount" required>
              <Input type="number" step="0.01" min="0.01" required value={amount}
                onChange={(e) => setAmount(e.target.value)} className="text-right font-mono" placeholder="0.00" />
            </Field>
          </div>
          <Field label="Narration">
            <Input value={narration} onChange={(e) => setNarration(e.target.value)}
              placeholder="e.g. Daily cash deposit" />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" size={14} />} Deposit
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Import CSV dialog ─────────────────────────────────────────────────────

function ImportCsvDialog({ bankAccount, onImported }: { bankAccount: BankAccount; onImported: () => void }) {
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ imported: number; duplicates: number; errors: string[] } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setResult(null)
    try {
      const r = await importBankCsv(bankAccount.id, file)
      setResult(r)
      if (r.imported > 0) toast.success(`Imported ${r.imported} transactions`)
      onImported()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Import failed')
    } finally { setUploading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setResult(null) }}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <UploadCloud size={14} /> Import Statement
      </Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Import bank statement</DialogTitle></DialogHeader>
        <p className="text-xs text-slate-500 mb-3">
          Upload a CSV from your bank. We'll auto-detect columns named Date, Description, Reference,
          and either a single Amount column or Debit + Credit columns.
        </p>
        <div className="border-2 border-dashed border-slate-200 rounded-lg py-8 text-center cursor-pointer hover:bg-slate-50"
             onClick={() => inputRef.current?.click()}>
          {uploading ? (
            <Loader2 size={24} className="animate-spin inline text-teal-600" />
          ) : (
            <>
              <UploadCloud size={24} className="text-slate-400 mb-1.5 mx-auto" />
              <p className="text-sm text-slate-600">
                <span className="text-teal-700 font-medium">Click to upload</span> a CSV file
              </p>
            </>
          )}
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = '' }} />
        </div>

        {result && (
          <div className="mt-4 text-sm">
            <div className="text-slate-700">
              <span className="font-medium text-emerald-700">{result.imported} imported</span>
              {result.duplicates > 0 && <span className="text-slate-500"> · {result.duplicates} duplicates skipped</span>}
            </div>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto border border-rose-100 bg-rose-50 rounded-lg p-2 text-xs text-rose-700 space-y-0.5">
                {result.errors.slice(0, 20).map((er, i) => <li key={i}>{er}</li>)}
                {result.errors.length > 20 && <li className="italic">…and {result.errors.length - 20} more</li>}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3">
          <Button variant="secondary" onClick={() => setOpen(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Manual transaction sheet ──────────────────────────────────────────────

function ManualTxnSheet({ bankAccount, onCreated }: { bankAccount: BankAccount; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [direction, setDirection] = useState<'in' | 'out'>('out')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() {
    setDate(new Date().toISOString().slice(0, 10))
    setDirection('out'); setAmount(''); setDescription(''); setReference('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || parseFloat(amount) <= 0) { toast.error('Amount must be > 0'); return }
    setSaving(true)
    try {
      const signed = direction === 'in' ? amount : `-${amount}`
      await createBankTransaction({
        bank_account: bankAccount.id, date, description, reference, amount: signed,
      })
      toast.success('Transaction added')
      setOpen(false); reset(); onCreated()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed')
    } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <SheetTrigger asChild>
        <Button size="sm"><Plus size={14} /> Add Transaction</Button>
      </SheetTrigger>
      <SheetContent width="md">
        <form onSubmit={submit} className="flex flex-col h-full">
          <SheetHeader><SheetTitle>Add transaction</SheetTitle></SheetHeader>
          <SheetBody>
            <div className="space-y-3">
              <Field label="Direction" required>
                <div className="flex flex-wrap gap-2">
                  {[
                    { v: 'in' as const, label: 'Money In', cls: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
                    { v: 'out' as const, label: 'Money Out', cls: 'border-rose-300 bg-rose-50 text-rose-700' },
                  ].map((opt) => (
                    <label key={opt.v} className={cn(
                      'flex-1 min-w-[7rem] flex items-center justify-center px-3 py-2 rounded-lg border cursor-pointer text-sm',
                      direction === opt.v ? opt.cls : 'border-slate-200 text-slate-600'
                    )}>
                      <input type="radio" checked={direction === opt.v} onChange={() => setDirection(opt.v)}
                        className="hidden" />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Date" required>
                  <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Amount" required>
                  <Input type="number" step="0.01" min="0.01" required value={amount}
                    onChange={(e) => setAmount(e.target.value)} className="text-right font-mono" placeholder="0.00" />
                </Field>
              </div>
              <Field label="Description">
                <Input value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. NEFT to Tata Power" />
              </Field>
              <Field label="Reference">
                <Input value={reference} onChange={(e) => setReference(e.target.value)}
                  placeholder="UTR / Cheque number" />
              </Field>
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" size={14} />} Save
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// ─── Field wrapper ─────────────────────────────────────────────────────────

function Pill({ label, count, active, dot, onClick }: {
  label: string
  count: number
  active: boolean
  dot?: string
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className={cn(
      'inline-flex items-center gap-2 px-3 py-2 sm:py-1.5 rounded-full border text-xs font-medium transition-colors',
      active
        ? 'bg-teal-50 border-teal-200 text-teal-700'
        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
    )}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />}
      {label}
      {count >= 0 && (
        <span className={cn('text-[10px] tabular-nums', active ? 'text-teal-600' : 'text-slate-400')}>
          {count}
        </span>
      )}
    </button>
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

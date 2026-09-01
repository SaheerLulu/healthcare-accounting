import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, ArrowDown, ArrowUp, Eye, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  listPettyCashFloats, createPettyCashFloat,
  spendPettyCash, replenishPettyCash, getPettyCashTxns, getChartOfAccounts,
  type PettyCashFloat, type PettyCashTxn, type Account,
  apiErrorMessage,
  apiFieldErrors,
} from '../../lib/api'
import { useLocation } from '../../contexts/LocationContext'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { AccountPicker } from '../journals/AccountPicker'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

/**
 * Every dialog on this page is state-driven and opened from a button that
 * lives outside the Dialog subtree, so Radix has no trigger to hand focus
 * back to on close and drops it on <body> — after each spend the user was
 * Tabbing from the top of the document to find their place again. Remember
 * the opener before the dialog mounts, and restore to it (or to the row it
 * belonged to, if the reload replaced it) on the way out.
 */
function useFocusReturn(fallback: () => void) {
  const ref = useRef<HTMLElement | null>(null)
  const remember = useCallback(() => {
    ref.current = document.activeElement as HTMLElement | null
  }, [])
  const restore = useCallback((e: Event) => {
    e.preventDefault()
    const el = ref.current
    if (el && el.isConnected) el.focus()
    else fallback()
  }, [fallback])
  return { remember, restore }
}

function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 justify-end mt-4">{children}</div>
}

function Field({ label, required, hint, error, children }: {
  label: string
  required?: boolean
  hint?: string
  /** Server-side rejection for this field, from apiFieldErrors(). */
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {error
        ? <span className="block text-xs mt-1" style={{ color: 'var(--danger)' }}>{error}</span>
        : hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}

export default function PettyCashPage() {
  const navigate = useNavigate()
  const [floats, setFloats] = useState<PettyCashFloat[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [spendFor, setSpendFor] = useState<PettyCashFloat | null>(null)
  const [replenishFor, setReplenishFor] = useState<PettyCashFloat | null>(null)
  const [txnsFor, setTxnsFor] = useState<PettyCashFloat | null>(null)
  const [glAccounts, setGlAccounts] = useState<Account[]>([])

  async function load() {
    // Deliberately no setLoading(true): `loading` starts true, so the mount
    // still shows the skeleton — but a reload (Alt+R, or a dialog that just
    // posted) would otherwise swap the whole register for it, unmounting the
    // row the keyboard user was standing on and dropping focus on <body>. It
    // also keeps the element useFocusReturn remembered connected, so closing a
    // dialog lands back on the button that opened it. Same reasoning as
    // SetupChecklistPage's Alt+R.
    try {
      const r = await listPettyCashFloats()
      setFloats(Array.isArray(r) ? r : (r.results ?? []))
    } catch (e) { toast.error(apiErrorMessage(e, 'Failed to load floats')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    getChartOfAccounts().then(setGlAccounts).catch(() => {/* pickers degrade */})
  }, [])

  // ─── Keyboard ─────────────────────────────────────────────────────────────
  // Each row carried three buttons and no way in from the keyboard. A roving
  // tabindex makes the table one tab stop: ↑↓ walk the floats, Enter opens the
  // transaction ledger, and only the focused row's verbs stay tabbable.
  // The fallback is read through a ref because the list and the focus-return
  // helper each need the other: the list's Enter handler remembers focus, and
  // the helper falls back into the list when the remembered row is gone.
  const focusListRef = useRef<() => void>(() => {})
  const { remember: rememberFocus, restore: restoreFocus } = useFocusReturn(
    useCallback(() => focusListRef.current(), []),
  )
  const list = useListKeyboardNav({
    count: floats.length,
    onActivate: (i) => { const f = floats[i]; if (f) { rememberFocus(); setTxnsFor(f) } },
  })
  focusListRef.current = list.focusList

  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'New float', run: () => { rememberFocus(); setShowDialog(true) } },
      { chord: 'Alt+R', label: 'Refresh', run: load },
    ],
    onFocusList: list.focusList,
    onBack: () => navigate('/banking'),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Petty Cash</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{floats.length}</span> petty-cash floats across locations
          </p>
        </div>
        <Button onClick={() => { rememberFocus(); setShowDialog(true) }}>
          <Plus size={16} /> New Float
        </Button>
      </div>

      {loading ? <SkeletonTable /> : floats.length === 0 ? (
        <EmptyState title="No petty cash floats" description="Set up a per-location float to start recording small cash spends." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr><Th>Location</Th><Th>Custodian</Th><Th>GL</Th>
                <Th className="text-right px-3">Imprest</Th><Th className="text-right px-3">Threshold</Th>
                <Th className="text-right px-3">Current</Th><Th>Status</Th><Th></Th></Tr>
            </Thead>
            <Tbody {...list.containerProps}>
              {floats.map((f, i) => (
                <Tr key={f.id} {...list.rowProps(i)}>
                  <Td>{f.location_name || `#${f.location_id}`}</Td>
                  <Td>{f.custodian_name || '—'}</Td>
                  <Td className="mono">{f.chart_account_code}</Td>
                  <Td className="text-right mono px-3">{formatCurrency(f.imprest_amount)}</Td>
                  <Td className="text-right mono px-3">{formatCurrency(f.replenishment_threshold)}</Td>
                  <Td className="text-right mono px-3 font-medium">{formatCurrency(f.current_balance ?? '0')}</Td>
                  <Td>{f.needs_replenishment ?
                    <Badge variant="error">Low — replenish</Badge> :
                    <Badge variant="success">OK</Badge>}</Td>
                  <Td>
                    {/* Only the focused row's verbs are tabbable, so Tab steps
                        row → its three actions → out, instead of walking every
                        action of every float in the register. */}
                    <div className="flex gap-1"
                         onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}>
                      <Button size="sm" variant="ghost" tabIndex={list.active === i ? 0 : -1}
                        onClick={() => { rememberFocus(); setSpendFor(f) }}>
                        <ArrowDown size={14} /> Spend
                      </Button>
                      <Button size="sm" variant="ghost" tabIndex={list.active === i ? 0 : -1}
                        onClick={() => { rememberFocus(); setReplenishFor(f) }}>
                        <ArrowUp size={14} /> Replenish
                      </Button>
                      <Button size="sm" variant="ghost" tabIndex={list.active === i ? 0 : -1}
                        title="View transactions" aria-label={`View transactions — ${f.location_name || `#${f.location_id}`}`}
                        onClick={() => { rememberFocus(); setTxnsFor(f) }}>
                        <Eye size={14} />
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}

      <NewFloatDialog open={showDialog} glAccounts={glAccounts} onCloseAutoFocus={restoreFocus}
        onClose={() => setShowDialog(false)} onSaved={load} />
      <SpendDialog floatObj={spendFor} glAccounts={glAccounts} onCloseAutoFocus={restoreFocus}
        onClose={() => setSpendFor(null)} onDone={load} />
      <ReplenishDialog floatObj={replenishFor} onCloseAutoFocus={restoreFocus}
        onClose={() => setReplenishFor(null)} onDone={load} />
      <TxnsDialog floatObj={txnsFor} onCloseAutoFocus={restoreFocus} onClose={() => setTxnsFor(null)} />
    </div>
  )
}

function NewFloatDialog({ open, glAccounts, onClose, onSaved, onCloseAutoFocus }: {
  open: boolean
  glAccounts: Account[]
  onClose: () => void
  onSaved: () => void
  onCloseAutoFocus: (e: Event) => void
}) {
  const { activeLocationId, activeLocation } = useLocation()
  const blank = {
    chart_account: null as number | null,
    imprest_amount: '5000', replenishment_threshold: '1000',
    custodian_name: '',
  }
  const [data, setData] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  useEffect(() => { if (open) { setData(blank); setFieldErrors({}) } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open])

  // The float's GL must be a Cash leaf — same rule the backend enforces.
  const cashAccounts = useMemo(
    () => glAccounts.filter((g) => g.account_subtype === 'Cash'),
    [glAccounts])

  // The picker's trigger is a <button>, so DialogContent's own "first form
  // control" rule would skip it and land on the Custodian text box instead.
  const pickerRef = useRef<HTMLDivElement>(null)

  async function submit() {
    if (!activeLocationId) {
      toast.error('Pick a store from the switcher at the top — each store keeps its own float.')
      return
    }
    if (!data.chart_account) { toast.error('Pick the cash GL account'); return }
    setSaving(true)
    setFieldErrors({})
    try {
      await createPettyCashFloat({
        chart_account: data.chart_account,
        imprest_amount: data.imprest_amount,
        replenishment_threshold: data.replenishment_threshold,
        custodian_name: data.custodian_name,
        location_id: activeLocationId,
        location_name: activeLocation?.name ?? '',
      })
      toast.success('Float created'); onSaved(); onClose()
    } catch (err) {
      setFieldErrors(apiFieldErrors(err))
      toast.error(apiErrorMessage(err, 'Failed to create float.'))
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={(e) => {
          const btn = pickerRef.current?.querySelector('button')
          if (btn) { e.preventDefault(); btn.focus() }
        }}
      >
        <DialogHeader><DialogTitle>New Petty Cash Float</DialogTitle></DialogHeader>
        <p className="text-xs mb-2" style={{ color: 'var(--ink-2)' }}>
          Float store: <strong>{activeLocation?.name || 'Select a store from the switcher first'}</strong>
        </p>
        {/* A real <form>, so Enter commits from any field rather than making the
            user Tab down to Save. Ctrl+S is not bound here: the dialog owns the
            keyboard while it is open and Enter is the shorter answer. */}
        <form onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="space-y-3">
          <Field label="Cash GL Account" required error={fieldErrors.chart_account}
            hint="A Cash-subtype leaf — typically 1110 Cash in Hand or a sub-account">
            <div ref={pickerRef}>
              <AccountPicker accounts={cashAccounts} value={data.chart_account}
                onChange={(id) => setData({ ...data, chart_account: id })} />
            </div>
          </Field>
          <Field label="Custodian" error={fieldErrors.custodian_name}>
            <Input placeholder="Who holds the cash box" value={data.custodian_name}
              onChange={(e) => setData({ ...data, custodian_name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Imprest Amount" required error={fieldErrors.imprest_amount}>
              <Input type="number" step="0.01" min="0.01" value={data.imprest_amount}
                className="text-right font-mono"
                onChange={(e) => setData({ ...data, imprest_amount: e.target.value })} />
            </Field>
            <Field label="Replenish Threshold" required error={fieldErrors.replenishment_threshold}>
              <Input type="number" step="0.01" min="0" value={data.replenishment_threshold}
                className="text-right font-mono"
                onChange={(e) => setData({ ...data, replenishment_threshold: e.target.value })} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />} Save
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SpendDialog({ floatObj, glAccounts, onClose, onDone, onCloseAutoFocus }: {
  floatObj: PettyCashFloat | null
  glAccounts: Account[]
  onClose: () => void
  onDone: () => void
  onCloseAutoFocus: (e: Event) => void
}) {
  const blank = {
    date: new Date().toISOString().slice(0, 10),
    amount: '', expense_account: null as number | null, description: '', voucher_no: '',
  }
  const [data, setData] = useState(blank)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (floatObj) setData(blank) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [floatObj])

  // Spends debit an expense head — same rule the backend enforces.
  const expenseAccounts = useMemo(
    () => glAccounts.filter((g) => g.account_type === 'EXPENSE'),
    [glAccounts])

  if (!floatObj) return null

  async function submit() {
    if (!data.amount || parseFloat(data.amount) <= 0) { toast.error('Amount must be > 0'); return }
    if (!data.expense_account) { toast.error('Pick the expense account'); return }
    if (!data.description.trim()) { toast.error('Describe the spend'); return }
    setSaving(true)
    try {
      await spendPettyCash(floatObj!.id, {
        date: data.date, amount: data.amount,
        expense_account: data.expense_account,
        description: data.description, voucher_no: data.voucher_no,
      })
      toast.success('Spend recorded — journal entry posted'); onDone(); onClose()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(apiErrorMessage(e, 'Failed to record spend.'))
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={!!floatObj} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader><DialogTitle>Petty Cash Spend — {floatObj.location_name || `#${floatObj.location_id}`}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Date" required>
              <Input type="date" data-autofocus value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
            </Field>
            <Field label="Amount" required>
              <Input type="number" step="0.01" min="0.01" placeholder="0.00" value={data.amount}
                className="text-right font-mono"
                onChange={(e) => setData({ ...data, amount: e.target.value })} />
            </Field>
          </div>
          <Field label="Expense Account" required hint="Debited by the posted entry; the float's cash GL is credited">
            <AccountPicker accounts={expenseAccounts} value={data.expense_account}
              onChange={(id) => setData({ ...data, expense_account: id })} />
          </Field>
          <Field label="Description" required>
            <Input placeholder="e.g. Courier charges" value={data.description}
              onChange={(e) => setData({ ...data, description: e.target.value })} />
          </Field>
          <Field label="Voucher No.">
            <Input placeholder="Paper voucher reference (optional)" value={data.voucher_no}
              onChange={(e) => setData({ ...data, voucher_no: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />} Record Spend
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ReplenishDialog({ floatObj, onClose, onDone, onCloseAutoFocus }: {
  floatObj: PettyCashFloat | null
  onClose: () => void
  onDone: () => void
  onCloseAutoFocus: (e: Event) => void
}) {
  const blank = {
    date: new Date().toISOString().slice(0, 10),
    amount: '', source: 'bank',
  }
  const [data, setData] = useState(blank)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (floatObj) setData(blank) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [floatObj])
  if (!floatObj) return null

  async function submit() {
    if (!data.amount || parseFloat(data.amount) <= 0) { toast.error('Amount must be > 0'); return }
    setSaving(true)
    try {
      await replenishPettyCash(floatObj!.id, data)
      toast.success('Replenished — contra entry posted'); onDone(); onClose()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(apiErrorMessage(e, 'Failed to replenish.'))
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={!!floatObj} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader><DialogTitle>Replenish Petty Cash — {floatObj.location_name || `#${floatObj.location_id}`}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Date" required>
              <Input type="date" data-autofocus value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
            </Field>
            <Field label="Amount" required>
              <Input type="number" step="0.01" min="0.01" placeholder="0.00" value={data.amount}
                className="text-right font-mono"
                onChange={(e) => setData({ ...data, amount: e.target.value })} />
            </Field>
          </div>
          <Field label="Source" hint="Posts a contra: Dr float cash GL / Cr source">
            <select className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              value={data.source}
              onChange={(e) => setData({ ...data, source: e.target.value })}>
              <option value="bank">From Bank</option>
              <option value="cash">From Cash</option>
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />} Replenish
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TxnsDialog({ floatObj, onClose, onCloseAutoFocus }: {
  floatObj: PettyCashFloat | null
  onClose: () => void
  onCloseAutoFocus: (e: Event) => void
}) {
  const [txns, setTxns] = useState<PettyCashTxn[]>([])
  const [balance, setBalance] = useState('0')
  useEffect(() => {
    if (!floatObj) return
    getPettyCashTxns(floatObj.id)
      .then((r) => { setTxns(r.rows); setBalance(r.current_balance) })
      .catch((e) => toast.error(apiErrorMessage(e, 'Failed to load transactions')))
  }, [floatObj])
  // The ledger is capped at 60vh and scrolls, and a scroll rail nobody can
  // focus is a rail nobody can scroll. Roving row focus moves the rail for us
  // (useListKeyboardNav scrolls the focused row into view), so a long ledger
  // is readable with ↑↓/PgDn/End instead of only a mouse wheel.
  const rows = useListKeyboardNav({ count: txns.length })
  if (!floatObj) return null
  return (
    <Dialog open={!!floatObj} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="max-w-3xl" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>
            {floatObj.location_name || `#${floatObj.location_id}`} — current {formatCurrency(balance)}
          </DialogTitle>
        </DialogHeader>
        {/* The height cap belongs on <Table>'s own scroll rail: nesting it in
            a second scroll container would leave the sticky header stuck to
            the inner rail, which never scrolls vertically. */}
        <Table wrapperClassName="max-h-[60vh] overflow-y-auto">
            <Thead><Tr><Th>Date</Th><Th>Kind</Th><Th>Description</Th>
              <Th className="text-right px-3">Amount</Th><Th>Voucher</Th><Th>Entry</Th></Tr></Thead>
            <Tbody {...rows.containerProps}>
              {txns.map((t, i) => (
                <Tr key={t.id} {...(i === 0 ? { 'data-autofocus': '' } : {})} {...rows.rowProps(i)}>
                  <Td>{formatDate(t.date)}</Td>
                  <Td><Badge variant={t.kind === 'spend' ? 'error' : 'success'}>{t.kind}</Badge></Td>
                  <Td>{t.description}</Td>
                  <Td className="text-right mono px-3">{formatCurrency(t.amount)}</Td>
                  <Td>{t.voucher_no || '—'}</Td>
                  <Td>
                    {t.entry_no ? (
                      <Link to={`/journals?search=${encodeURIComponent(t.entry_no)}`}
                        className="mono text-xs hover:underline" style={{ color: 'var(--brand)' }}>
                        {t.entry_no}
                      </Link>
                    ) : '—'}
                  </Td>
                </Tr>
              ))}
            </Tbody>
        </Table>
        <DialogFooter><Button variant="secondary" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

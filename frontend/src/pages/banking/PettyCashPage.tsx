import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, ArrowDown, ArrowUp, Eye, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  listPettyCashFloats, createPettyCashFloat,
  spendPettyCash, replenishPettyCash, getPettyCashTxns, getChartOfAccounts,
  type PettyCashFloat, type PettyCashTxn, type Account,
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

function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 justify-end mt-4">{children}</div>
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

export default function PettyCashPage() {
  const [floats, setFloats] = useState<PettyCashFloat[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [spendFor, setSpendFor] = useState<PettyCashFloat | null>(null)
  const [replenishFor, setReplenishFor] = useState<PettyCashFloat | null>(null)
  const [txnsFor, setTxnsFor] = useState<PettyCashFloat | null>(null)
  const [glAccounts, setGlAccounts] = useState<Account[]>([])

  async function load() {
    setLoading(true)
    try {
      const r = await listPettyCashFloats()
      setFloats(Array.isArray(r) ? r : (r.results ?? []))
    } catch { toast.error('Failed to load floats') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    getChartOfAccounts().then(setGlAccounts).catch(() => {/* pickers degrade */})
  }, [])

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Petty Cash</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{floats.length}</span> petty-cash floats across locations
          </p>
        </div>
        <Button onClick={() => setShowDialog(true)}><Plus size={16} /> New Float</Button>
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
            <Tbody>
              {floats.map((f) => (
                <Tr key={f.id}>
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
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setSpendFor(f)}>
                        <ArrowDown size={14} /> Spend
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReplenishFor(f)}>
                        <ArrowUp size={14} /> Replenish
                      </Button>
                      <Button size="sm" variant="ghost" title="View transactions" onClick={() => setTxnsFor(f)}>
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

      <NewFloatDialog open={showDialog} glAccounts={glAccounts}
        onClose={() => setShowDialog(false)} onSaved={load} />
      <SpendDialog floatObj={spendFor} glAccounts={glAccounts}
        onClose={() => setSpendFor(null)} onDone={load} />
      <ReplenishDialog floatObj={replenishFor} onClose={() => setReplenishFor(null)} onDone={load} />
      <TxnsDialog floatObj={txnsFor} onClose={() => setTxnsFor(null)} />
    </div>
  )
}

function NewFloatDialog({ open, glAccounts, onClose, onSaved }: {
  open: boolean
  glAccounts: Account[]
  onClose: () => void
  onSaved: () => void
}) {
  const { activeLocationId, activeLocation } = useLocation()
  const blank = {
    chart_account: null as number | null,
    imprest_amount: '5000', replenishment_threshold: '1000',
    custodian_name: '',
  }
  const [data, setData] = useState(blank)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setData(blank) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open])

  // The float's GL must be a Cash leaf — same rule the backend enforces.
  const cashAccounts = useMemo(
    () => glAccounts.filter((g) => g.account_subtype === 'Cash'),
    [glAccounts])

  async function submit() {
    if (!activeLocationId) { toast.error('Select a store first'); return }
    if (!data.chart_account) { toast.error('Pick the cash GL account'); return }
    setSaving(true)
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
      const e = err as { response?: { data?: Record<string, unknown> } }
      const d = e.response?.data
      toast.error(d
        ? Object.entries(d).map(([k, v]) =>
            `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(' • ')
        : 'Failed to create float')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Petty Cash Float</DialogTitle></DialogHeader>
        <p className="text-xs mb-2" style={{ color: 'var(--ink-2)' }}>
          Float store: <strong>{activeLocation?.name || 'Select a store from the switcher first'}</strong>
        </p>
        <div className="space-y-3">
          <Field label="Cash GL Account" required hint="A Cash-subtype leaf — typically 1110 Cash in Hand or a sub-account">
            <AccountPicker accounts={cashAccounts} value={data.chart_account}
              onChange={(id) => setData({ ...data, chart_account: id })} />
          </Field>
          <Field label="Custodian">
            <Input placeholder="Who holds the cash box" value={data.custodian_name}
              onChange={(e) => setData({ ...data, custodian_name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Imprest Amount" required>
              <Input type="number" step="0.01" min="0.01" value={data.imprest_amount}
                className="text-right font-mono"
                onChange={(e) => setData({ ...data, imprest_amount: e.target.value })} />
            </Field>
            <Field label="Replenish Threshold" required>
              <Input type="number" step="0.01" min="0" value={data.replenishment_threshold}
                className="text-right font-mono"
                onChange={(e) => setData({ ...data, replenishment_threshold: e.target.value })} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={submit}>
            {saving && <Loader2 size={14} className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SpendDialog({ floatObj, glAccounts, onClose, onDone }: {
  floatObj: PettyCashFloat | null
  glAccounts: Account[]
  onClose: () => void
  onDone: () => void
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
      toast.error(e.response?.data?.detail || 'Failed to record spend')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={!!floatObj} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Petty Cash Spend — {floatObj.location_name || `#${floatObj.location_id}`}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" required>
              <Input type="date" value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
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
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={submit}>
            {saving && <Loader2 size={14} className="animate-spin" />} Record Spend
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReplenishDialog({ floatObj, onClose, onDone }: {
  floatObj: PettyCashFloat | null
  onClose: () => void
  onDone: () => void
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
      toast.error(e.response?.data?.detail || 'Failed to replenish')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={!!floatObj} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Replenish Petty Cash — {floatObj.location_name || `#${floatObj.location_id}`}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" required>
              <Input type="date" value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
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
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={submit}>
            {saving && <Loader2 size={14} className="animate-spin" />} Replenish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TxnsDialog({ floatObj, onClose }: {
  floatObj: PettyCashFloat | null
  onClose: () => void
}) {
  const [txns, setTxns] = useState<PettyCashTxn[]>([])
  const [balance, setBalance] = useState('0')
  useEffect(() => {
    if (!floatObj) return
    getPettyCashTxns(floatObj.id)
      .then((r) => { setTxns(r.rows); setBalance(r.current_balance) })
      .catch(() => toast.error('Failed to load transactions'))
  }, [floatObj])
  if (!floatObj) return null
  return (
    <Dialog open={!!floatObj} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {floatObj.location_name || `#${floatObj.location_id}`} — current {formatCurrency(balance)}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <Thead><Tr><Th>Date</Th><Th>Kind</Th><Th>Description</Th>
              <Th className="text-right px-3">Amount</Th><Th>Voucher</Th><Th>Entry</Th></Tr></Thead>
            <Tbody>
              {txns.map((t) => (
                <Tr key={t.id}>
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
        </div>
        <DialogFooter><Button variant="secondary" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

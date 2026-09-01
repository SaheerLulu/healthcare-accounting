import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, CheckCircle2, AlertTriangle, Ban, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  listCheques, createCheque, clearCheque, bounceCheque, cancelCheque,
  getBankAccounts, getSuppliers, getCustomers,
  type Cheque, type BankAccount, type Party,
  apiErrorMessage,
} from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

const STATUS_BADGE: Record<Cheque['status'], 'default' | 'success' | 'error' | 'warning'> = {
  pending: 'default',
  cleared: 'success',
  bounced: 'error',
  cancelled: 'warning',
}

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

export default function ChequesPage() {
  const [cheques, setCheques] = useState<Cheque[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'all' | 'issued' | 'received' | 'pdc'>('all')
  const [showDialog, setShowDialog] = useState(false)
  const [bounceFor, setBounceFor] = useState<Cheque | null>(null)
  const [cancelFor, setCancelFor] = useState<Cheque | null>(null)
  const [clearFor, setClearFor] = useState<Cheque | null>(null)
  const [clearing, setClearing] = useState(false)
  const newChequeRef = useRef<HTMLButtonElement>(null)

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [customers, setCustomers] = useState<Party[]>([])

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (tab === 'issued' || tab === 'received') params.kind = tab
      if (tab === 'pdc') params.pdc = 'true'
      const r = await listCheques(params)
      setCheques(Array.isArray(r) ? r : (r.results ?? []))
    } catch (e) { toast.error(apiErrorMessage(e, 'Failed to load cheques')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [tab])

  useEffect(() => {
    Promise.all([getBankAccounts(), getSuppliers(), getCustomers()])
      .then(([b, s, c]) => { setBankAccounts(b); setSuppliers(s); setCustomers(c) })
      .catch((e) => toast.error(apiErrorMessage(e, 'Could not load bank accounts and parties.')))
  }, [])

  async function runClear(c: Cheque) {
    setClearing(true)
    try {
      await clearCheque(c.id)
      toast.success('Cleared')
      setClearFor(null)
      // The row's action buttons vanish once it is no longer pending, and a
      // closing confirm hands focus back to nothing — so claim it for the row,
      // after the dialog has finished unmounting.
      setTimeout(focusRows, 0)
      load()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to clear the cheque.'))
    } finally { setClearing(false) }
  }

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // Every pending row carries three action buttons, so Tab alone made the 30th
  // cheque 90 stops away. Roving focus walks the rows with ↑↓ and the three
  // verbs are chords that act on the row the keyboard is on; Tab from a focused
  // row still steps into that row's own buttons.
  const list = useListKeyboardNav({ count: cheques.length })
  const activeCheque: Cheque | undefined = cheques[list.active]
  const focusRows = () => list.focusList()

  // A row verb may only fire while the keyboard is actually ON a row. Before
  // the user has entered the list `list.active` is 0, and the active row is
  // painted only on :focus-visible — so pressing one of these straight off the
  // hint bar would have acted on the first cheque in the table with nothing on
  // screen tying the verb to that row. Gating on focus also keeps the three
  // verbs out of the hint bar until they have a target: F3 puts you there.
  const [listFocused, setListFocused] = useState(false)
  const canAct = listFocused && !!activeCheque && activeCheque.status === 'pending'

  // Alt+K / Alt+B are this screen's own verbs — the canonical map has no chord
  // for clearing or bouncing a cheque. Alt+L, which this screen used to bind
  // for "clear", already means "GL ledger" on the party screens, and one letter
  // cannot carry two app-wide meanings. Alt+V is the mapped void.
  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'New cheque', run: () => setShowDialog(true) },
      { chord: 'Alt+R', label: 'Refresh', run: load },
      { chord: 'Alt+K', label: 'Mark cleared', when: canAct, run: () => setClearFor(activeCheque!) },
      { chord: 'Alt+B', label: 'Bounce', when: canAct, run: () => setBounceFor(activeCheque!) },
      { chord: 'Alt+V', label: 'Cancel cheque', when: canAct, run: () => setCancelFor(activeCheque!) },
    ],
    onFocusList: list.focusList,
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Cheques</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{cheques.length}</span> cheques in view
          </p>
        </div>
        <Button ref={newChequeRef} onClick={() => setShowDialog(true)}><Plus size={16} /> New Cheque</Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="issued">Issued</TabsTrigger>
          <TabsTrigger value="received">Received</TabsTrigger>
          <TabsTrigger value="pdc">PDC (post-dated)</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          {loading ? <SkeletonTable /> : cheques.length === 0 ? (
            <EmptyState title="No cheques in this view" description="Add a cheque you issued or received." />
          ) : (
            <Card className="overflow-hidden p-0">
              <Table>
                <Thead>
                  <Tr><Th>Cheque No.</Th><Th>Kind</Th><Th>Date</Th><Th>Expected Clear</Th>
                    <Th>Bank</Th><Th>Party</Th><Th className="text-right px-3">Amount</Th>
                    <Th>Status</Th><Th></Th></Tr>
                </Thead>
                <Tbody
                  {...list.containerProps}
                  onFocus={() => setListFocused(true)}
                  onBlur={(e) => {
                    // focusout fires for moves WITHIN the list too (row → its
                    // own buttons), so only a landing spot outside the rows
                    // means the keyboard has really left them.
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setListFocused(false)
                    }
                  }}
                >
                  {cheques.map((c, i) => (
                    <Tr key={c.id} {...list.rowProps(i)}>
                      <Td className="mono">
                        {c.cheque_no}
                        {c.is_pdc && c.status === 'pending' && (
                          <Badge variant="info" className="ml-2">PDC</Badge>
                        )}
                      </Td>
                      <Td><Badge variant={c.kind === 'issued' ? 'default' : 'success'}>{c.kind}</Badge></Td>
                      <Td>{formatDate(c.cheque_date)}</Td>
                      <Td>{c.expected_clear_date ? formatDate(c.expected_clear_date) : '—'}</Td>
                      <Td>{c.bank_account_name}</Td>
                      <Td>{c.party_name || '—'}</Td>
                      <Td className="text-right mono px-3">{formatCurrency(c.amount)}</Td>
                      <Td>
                        <Badge variant={STATUS_BADGE[c.status] ?? 'default'}
                          title={c.status === 'bounced' && c.bounce_reason ? c.bounce_reason : undefined}>
                          {c.status}
                        </Badge>
                      </Td>
                      <Td>
                        {c.status === 'pending' && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => runClear(c)}>
                              <CheckCircle2 size={14} /> Clear
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setBounceFor(c)}>
                              <AlertTriangle size={14} /> Bounce
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setCancelFor(c)}>
                              <Ban size={14} /> Cancel
                            </Button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <NewChequeDialog
        open={showDialog}
        bankAccounts={bankAccounts}
        suppliers={suppliers}
        customers={customers}
        onClose={() => setShowDialog(false)}
        onSaved={load}
        // Opened from a button, so focus goes back to that button; opened by
        // Alt+N it is the same button, which is where the user expects to land.
        restoreFocus={() => newChequeRef.current?.focus()}
      />
      <BounceDialog cheque={bounceFor} onClose={() => setBounceFor(null)} onDone={load}
        restoreFocus={focusRows} />
      <CancelDialog cheque={cancelFor} onClose={() => setCancelFor(null)} onDone={load}
        restoreFocus={focusRows} />

      {/* Alt+K acts on the row the keyboard is on, so it confirms which cheque
          before posting the clearing. The row button keeps its direct action. */}
      <ConfirmDialog
        open={!!clearFor}
        onOpenChange={(o) => { if (!o) { setClearFor(null); focusRows() } }}
        title={clearFor ? `Mark cheque ${clearFor.cheque_no} as cleared?` : 'Mark cheque as cleared?'}
        description={clearFor
          ? `${formatCurrency(clearFor.amount)} · ${clearFor.bank_account_name}${clearFor.party_name ? ` · ${clearFor.party_name}` : ''}`
          : undefined}
        confirmLabel="Mark Cleared"
        cancelLabel="Keep Pending"
        loading={clearing}
        onConfirm={() => { if (clearFor && !clearing) runClear(clearFor) }}
      />
    </div>
  )
}

function NewChequeDialog({ open, bankAccounts, suppliers, customers, onClose, onSaved, restoreFocus }: {
  open: boolean
  bankAccounts: BankAccount[]
  suppliers: Party[]
  customers: Party[]
  onClose: () => void
  onSaved: () => void
  /** Where focus goes when the dialog closes — Radix has no trigger to return to. */
  restoreFocus: () => void
}) {
  const blank = {
    cheque_no: '', kind: 'issued' as 'issued' | 'received', bank_account: '',
    cheque_date: new Date().toISOString().slice(0, 10),
    expected_clear_date: '',
    amount: '', party_type: '' as '' | 'Customer' | 'Supplier', party_id: '' as number | '',
  }
  const [data, setData] = useState(blank)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (open) setData(blank) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open])

  const partyList = data.party_type === 'Customer' ? customers
    : data.party_type === 'Supplier' ? suppliers : []
  const selectClass = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!data.bank_account) { toast.error('Pick a bank account'); return }
    if (!data.amount || parseFloat(data.amount) <= 0) { toast.error('Amount must be > 0'); return }
    setSaving(true)
    try {
      const party = partyList.find((p) => p.id === data.party_id)
      await createCheque({
        cheque_no: data.cheque_no,
        kind: data.kind,
        bank_account: Number(data.bank_account),
        cheque_date: data.cheque_date,
        expected_clear_date: data.expected_clear_date || null,
        amount: data.amount,
        party_type: data.party_type,
        party_id: data.party_id === '' ? null : data.party_id,
        party_name: party?.name ?? '',
      })
      toast.success('Cheque saved'); onSaved(); onClose()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save cheque.'))
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent onCloseAutoFocus={(e) => { e.preventDefault(); restoreFocus() }}>
        <DialogHeader><DialogTitle>New Cheque</DialogTitle></DialogHeader>
        <form onSubmit={submit}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Cheque No." required>
              <Input data-autofocus value={data.cheque_no} required
                onChange={(e) => setData({ ...data, cheque_no: e.target.value })} />
            </Field>
            <Field label="Kind" required>
              <select className={selectClass} value={data.kind}
                onChange={(e) => setData({ ...data, kind: e.target.value as 'issued' | 'received' })}>
                <option value="issued">Issued (we paid)</option>
                <option value="received">Received (we collected)</option>
              </select>
            </Field>
            <Field label={data.kind === 'issued' ? 'Drawn on (our bank)' : 'Deposit to (our bank)'} required>
              {bankAccounts.filter((b) => b.account_type !== 'cash').length === 0 ? (
                // An empty picker leaves nothing to select, and the save then
                // fails on a required field with no way for the user to fix it.
                <div className="text-xs rounded px-2.5 py-2" style={{
                  background: 'rgba(199,122,17,0.08)', color: 'var(--warning)',
                }}>
                  No bank account is available for this store.{' '}
                  <Link to="/banking" className="underline">Add one in Banking</Link>.
                </div>
              ) : (
                <select className={selectClass} value={data.bank_account} required
                  onChange={(e) => setData({ ...data, bank_account: e.target.value })}>
                  <option value="">— Select —</option>
                  {bankAccounts.filter((b) => b.account_type !== 'cash').map((b) => (
                    <option key={b.id} value={b.id}>{b.name}{b.bank_name ? ` · ${b.bank_name}` : ''}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Cheque Date" required>
              <Input type="date" value={data.cheque_date} required
                onChange={(e) => setData({ ...data, cheque_date: e.target.value })} />
            </Field>
            <Field label="Expected Clear" hint="Only for post-dated cheques">
              <Input type="date" value={data.expected_clear_date}
                onChange={(e) => setData({ ...data, expected_clear_date: e.target.value })} />
            </Field>
            <Field label="Amount" required>
              <Input type="number" step="0.01" min="0.01" required value={data.amount}
                onChange={(e) => setData({ ...data, amount: e.target.value })}
                className="text-right font-mono" placeholder="0.00" />
            </Field>
            <Field label="Party Type">
              <select className={selectClass} value={data.party_type}
                onChange={(e) => setData({
                  ...data,
                  party_type: e.target.value as '' | 'Customer' | 'Supplier',
                  party_id: '',
                })}>
                <option value="">— None —</option>
                <option value="Customer">Customer</option>
                <option value="Supplier">Supplier</option>
              </select>
            </Field>
            <Field label="Party">
              <select className={selectClass + ' disabled:bg-slate-50 disabled:text-slate-400'}
                value={data.party_id} disabled={!data.party_type}
                onChange={(e) => setData({ ...data, party_id: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">— Select —</option>
                {partyList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
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

function BounceDialog({ cheque, onClose, onDone, restoreFocus }: {
  cheque: Cheque | null
  onClose: () => void
  onDone: () => void
  restoreFocus: () => void
}) {
  const [reason, setReason] = useState('')
  const [bankCharge, setBankCharge] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (cheque) { setReason(''); setBankCharge('') } }, [cheque])
  if (!cheque) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving || !cheque) return
    setSaving(true)
    try { await bounceCheque(cheque.id, reason, bankCharge || undefined); toast.success('Marked as bounced'); onDone(); onClose() }
    catch (err) {
      toast.error(apiErrorMessage(err, 'Action failed.'))
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={!!cheque} onOpenChange={(o: boolean) => !o && onClose()}>
      {/* Opened from a row button (or Alt+B), so there is no Radix trigger to
          restore to — hand focus back to the cheque row instead of <body>. */}
      <DialogContent onCloseAutoFocus={(e) => { e.preventDefault(); restoreFocus() }}>
        <DialogHeader><DialogTitle>Bounce cheque {cheque.cheque_no}</DialogTitle></DialogHeader>
        {/* A real form so Enter from the reason field commits. */}
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            Marks the cheque bounced. If a journal entry is linked it is reversed and any
            linked bill payment rolled back; a bank charge posts its own payment entry.
          </p>
          <Input data-autofocus placeholder="Reason (e.g. insufficient funds)" value={reason}
                 onChange={(e) => setReason(e.target.value)} />
          <Input type="number" step="0.01" min="0" placeholder="Bank charge ₹ (optional)"
                 value={bankCharge} className="text-right font-mono"
                 onChange={(e) => setBankCharge(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 size={14} className="animate-spin" />} Mark Bounced
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CancelDialog({ cheque, onClose, onDone, restoreFocus }: {
  cheque: Cheque | null
  onClose: () => void
  onDone: () => void
  restoreFocus: () => void
}) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (cheque) setReason('') }, [cheque])
  if (!cheque) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving || !cheque) return
    setSaving(true)
    try { await cancelCheque(cheque.id, reason); toast.success('Cheque cancelled'); onDone(); onClose() }
    catch (err) {
      toast.error(apiErrorMessage(err, 'Action failed.'))
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={!!cheque} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent onCloseAutoFocus={(e) => { e.preventDefault(); restoreFocus() }}>
        <DialogHeader><DialogTitle>Cancel cheque {cheque.cheque_no}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            For a cheque that was voided, stopped, or never presented. If a journal
            entry is linked it is reversed so the books back out the payment.
          </p>
          <Input data-autofocus placeholder="Reason (e.g. stop payment, torn cheque)" value={reason}
                 onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Keep Pending</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 size={14} className="animate-spin" />} Cancel Cheque
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

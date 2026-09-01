import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Pencil, Trash2, Repeat, Pause, Play, Square,
  AlertCircle, Send,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getRecurringBill, deleteRecurringBill,
  pauseRecurringBill, resumeRecurringBill, stopRecurringBill,
  generateRecurringBillNow,
  type RecurringBill,
} from '../../lib/api'
import { formatCurrency, formatDate, cn } from '../../lib/utils'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

const FREQ_LABEL: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', yearly: 'Yearly',
}

const STATUS_BADGE = {
  active: 'success',
  paused: 'warning',
  stopped: 'default',
} as const

export default function RecurringBillDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const rbId = Number(id)
  const [rb, setRb] = useState<RecurringBill | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  // Generating creates a real bill against the vendor. The recurring-JOURNAL
  // twin confirms it; a clerk moves between the two screens, so this one does
  // too rather than being the sibling where one keystroke writes.
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Focus is moved into the page once per profile — not on every refetch, which
  // would yank it off the button the user just pressed.
  const focusedFor = useRef<number | null>(null)

  async function load() {
    setLoading(true)
    try {
      setRb(await getRecurringBill(rbId))
    } catch {
      toast.error('Failed to load recurring profile')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [rbId])

  async function action(label: string, fn: () => Promise<RecurringBill>) {
    setBusy(true)
    try {
      const updated = await fn()
      setRb(updated)
      toast.success(label)
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed')
    } finally { setBusy(false) }
  }

  async function handleGenerateNow() {
    if (!rb) return
    setBusy(true)
    try {
      const res = await generateRecurringBillNow(rb.id)
      toast.success(`Bill ${res.bill_no || `#${res.bill_id}`} generated`)
      load()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to generate')
    } finally { setBusy(false) }
  }

  async function handleDelete() {
    if (!rb) return
    setBusy(true)
    try {
      await deleteRecurringBill(rb.id)
      toast.success('Profile deleted')
      navigate('/bills/recurring')
    } catch {
      toast.error('Failed to delete')
      setBusy(false)
    }
  }

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // Each chord mirrors the condition that renders its button, so the hint bar
  // lists exactly the lifecycle verbs this profile can take. Stop and Delete
  // are irreversible, so both confirm first.
  const isActive = rb?.status === 'active'
  const isPaused = rb?.status === 'paused'
  const isStopped = rb?.status === 'stopped'

  // The generated bills open a record, so they get the standard roving
  // tabindex: F3 jumps in, ↑↓ move, Enter opens the bill.
  const generated = rb?.generated_recent ?? []
  const list = useListKeyboardNav({
    count: generated.length,
    onActivate: (i) => navigate(`/bills/${generated[i].id}`),
  })

  // Same chords as the recurring *journal* detail screen — the two profiles are
  // the same shape and a clerk moves between them.
  usePageKeyboard({
    actions: [
      { chord: 'Alt+E', label: 'Edit', when: !!rb && !isStopped, run: () => navigate(`/bills/recurring/${rbId}/edit`) },
      { chord: 'Alt+G', label: 'Generate now', when: isActive && !busy, run: () => setConfirmGenerate(true) },
      {
        chord: 'Alt+S',
        label: isPaused ? 'Resume' : 'Pause',
        when: (isActive || isPaused) && !busy,
        run: () => {
          if (!rb) return
          if (rb.status === 'paused') action('Resumed', () => resumeRecurringBill(rb.id))
          else action('Paused', () => pauseRecurringBill(rb.id))
        },
      },
      // Stopping ends the schedule for good, so the chord goes through the same
      // confirm the button does.
      { chord: 'Alt+V', label: 'Stop', when: !!rb && !isStopped, run: () => setConfirmStop(true) },
      { chord: 'Alt+D', label: 'Delete', when: !!rb, run: () => setConfirmDelete(true) },
    ],
    onFocusList: generated.length > 0 ? list.focusList : undefined,
    onBack: () => navigate('/bills/recurring'),
  })

  // Land focus on the page heading once it exists — the route-level focus pass
  // runs while this screen is still a spinner, so without this the first Tab
  // after arriving walks the whole nav again.
  useEffect(() => {
    if (loading || !rb || focusedFor.current === rb.id) return
    focusedFor.current = rb.id
    headingRef.current?.focus({ preventScroll: true })
  }, [loading, rb])

  if (loading || !rb) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline text-teal-600" size={24} /></div>
  }

  const today = new Date().toISOString().slice(0, 10)
  const isDue = rb.status === 'active' && rb.next_run_date <= today

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <button onClick={() => navigate('/bills/recurring')}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3">
        <ArrowLeft size={14} /> Back to Recurring Bills
      </button>

      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Repeat size={18} className="text-teal-600 flex-shrink-0" />
            <h1 ref={headingRef} tabIndex={-1} className="text-lg sm:text-xl font-semibold min-w-0 focus:outline-none" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>{rb.profile_name}</h1>
            <Badge variant={STATUS_BADGE[rb.status]}>{rb.status}</Badge>
            {rb.auto_approve && <Badge variant="info">Auto-approve</Badge>}
          </div>
          <p className="text-sm text-slate-500">
            {rb.vendor_name} · {FREQ_LABEL[rb.frequency]}
            {' · '}Next run <span className={cn('font-medium', isDue && 'text-amber-700')}>{formatDate(rb.next_run_date)}</span>
            {isDue && <span className="ml-1 text-amber-700 text-xs">(due)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {rb.status !== 'stopped' && (
            <Button variant="secondary" size="sm" onClick={() => navigate(`/bills/recurring/${rb.id}/edit`)}>
              <Pencil size={14} /> Edit
            </Button>
          )}
          {rb.status === 'active' && (
            <>
              <Button size="sm" onClick={() => setConfirmGenerate(true)} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} Generate Now
              </Button>
              <Button variant="secondary" size="sm" onClick={() => action('Paused', () => pauseRecurringBill(rb.id))} disabled={busy}>
                <Pause size={14} /> Pause
              </Button>
            </>
          )}
          {rb.status === 'paused' && (
            <Button size="sm" onClick={() => action('Resumed', () => resumeRecurringBill(rb.id))} disabled={busy}>
              <Play size={14} /> Resume
            </Button>
          )}
          {rb.status !== 'stopped' && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmStop(true)} disabled={busy}>
              <Square size={14} /> Stop
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      </div>

      {rb.last_error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm flex items-start gap-2">
          <AlertCircle size={14} className="text-rose-600 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-medium text-rose-800">Last run failed:</span>{' '}
            <span className="text-rose-700">{rb.last_error}</span>
          </div>
        </div>
      )}

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat label="Frequency" value={FREQ_LABEL[rb.frequency]} />
          <Stat label="Per cycle" value={formatCurrency(rb.total_amount)} />
          <Stat label="Bills generated" value={String(rb.generated_count)} />
          <Stat label="Last run" value={rb.last_run_date ? formatDate(rb.last_run_date) : '— never —'} />
          <Stat label="Start" value={formatDate(rb.start_date)} />
          <Stat label="End" value={rb.end_date ? formatDate(rb.end_date) : 'Indefinite'} />
          <Stat label="Due in" value={`${rb.due_days} days from each bill`} />
          <Stat label="Bill # pattern" value={rb.bill_no_pattern || '—'} mono />
        </div>
      </Card>

      <Card className="overflow-hidden p-0 mb-4">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Line Items</h2>
        </div>
        <div className="table-scroll">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Account</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Description</th>
                <th className="text-right text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rb.items.map((it) => (
                <tr key={it.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-900">{it.account_name}</div>
                    <div className="text-xs text-slate-400 font-mono">{it.account_code}</div>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-600">{it.description || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(it.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200">
                <td colSpan={2} className="px-4 py-2 text-right text-xs text-slate-500">Subtotal</td>
                <td className="px-4 py-2 text-right font-mono">{formatCurrency(rb.subtotal)}</td>
              </tr>
              {parseFloat(rb.tax_cgst) > 0 && (
                <tr><td colSpan={2} className="px-4 py-1.5 text-right text-xs text-slate-500">CGST</td>
                    <td className="px-4 py-1.5 text-right font-mono">{formatCurrency(rb.tax_cgst)}</td></tr>
              )}
              {parseFloat(rb.tax_sgst) > 0 && (
                <tr><td colSpan={2} className="px-4 py-1.5 text-right text-xs text-slate-500">SGST</td>
                    <td className="px-4 py-1.5 text-right font-mono">{formatCurrency(rb.tax_sgst)}</td></tr>
              )}
              {parseFloat(rb.tax_igst) > 0 && (
                <tr><td colSpan={2} className="px-4 py-1.5 text-right text-xs text-slate-500">IGST</td>
                    <td className="px-4 py-1.5 text-right font-mono">{formatCurrency(rb.tax_igst)}</td></tr>
              )}
              <tr className="bg-slate-50 border-t border-slate-200">
                <td colSpan={2} className="px-4 py-2.5 text-right font-semibold">Total</td>
                <td className="px-4 py-2.5 text-right font-mono font-bold">{formatCurrency(rb.total_amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden p-0 mb-4">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Recently Generated</h2>
        </div>
        {rb.generated_recent.length === 0 ? (
          <div className="text-center py-6 text-sm text-slate-400">No bills generated yet</div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Bill #</th>
                  <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Date</th>
                  <th className="text-right text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Amount</th>
                  <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody {...list.containerProps}>
                {rb.generated_recent.map((b, i) => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0 cursor-pointer"
                    onClick={() => navigate(`/bills/${b.id}`)}
                    {...list.rowProps(i)}>
                    <td className="px-4 py-2.5">
                      <Link to={`/bills/${b.id}`} className="text-teal-700 hover:underline font-medium"
                        onClick={(ev) => ev.stopPropagation()}>
                        {b.bill_no || `BILL-${b.id}`}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-slate-600 whitespace-nowrap">{formatDate(b.bill_date)}</td>
                    <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap">{formatCurrency(b.total_amount)}</td>
                    <td className="px-4 py-2.5"><Badge variant="default">{b.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {rb.notes && (
        <Card className="p-4 mb-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Notes</div>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">{rb.notes}</p>
        </Card>
      )}

      {/* Alt+V and Alt+D both end the profile's life, so both confirm — and a
          danger-tone ConfirmDialog opens on Cancel, which is what a reflexive
          Enter hits. */}
      <ConfirmDialog
        open={confirmGenerate}
        onOpenChange={setConfirmGenerate}
        title="Generate this bill now?"
        description="A bill is created against the vendor immediately, outside the schedule."
        confirmLabel="Generate"
        loading={busy}
        onConfirm={async () => {
          await handleGenerateNow()
          setConfirmGenerate(false)
        }}
      />

      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop this recurring profile?"
        description="No further bills will be generated. A stopped profile cannot be resumed or edited."
        confirmLabel="Stop"
        cancelLabel="Keep running"
        tone="danger"
        loading={busy}
        onConfirm={async () => {
          await action('Stopped', () => stopRecurringBill(rb.id))
          setConfirmStop(false)
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this profile?"
        description="Bills already generated by this profile will not be touched. The template itself will be removed."
        confirmLabel="Delete"
        cancelLabel="Keep"
        tone="danger"
        loading={busy}
        onConfirm={handleDelete}
      />
    </div>
  )
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">{label}</div>
      <div className={'text-sm text-slate-900 ' + (mono ? 'font-mono' : 'font-medium')}>{value}</div>
    </div>
  )
}

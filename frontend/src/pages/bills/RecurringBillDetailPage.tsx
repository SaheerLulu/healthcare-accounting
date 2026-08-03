import { useEffect, useState } from 'react'
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../../components/ui/dialog'

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
            <h1 className="text-lg sm:text-xl font-semibold min-w-0" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>{rb.profile_name}</h1>
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
              <Button size="sm" onClick={handleGenerateNow} disabled={busy}>
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
            <Button variant="secondary" size="sm" onClick={() => action('Stopped', () => stopRecurringBill(rb.id))} disabled={busy}>
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
              <tbody>
                {rb.generated_recent.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <Link to={`/bills/${b.id}`} className="text-teal-700 hover:underline font-medium">
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

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this profile?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            Bills already generated by this profile will not be touched. The template itself will be removed.
          </p>
          <div className="flex flex-wrap gap-2 justify-end pt-4">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy && <Loader2 className="animate-spin" size={14} />} Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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

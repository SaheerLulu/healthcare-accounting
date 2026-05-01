import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Pencil, Trash2, Repeat, Pause, Play, Square,
  AlertCircle, Send,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getRecurringJournal, deleteRecurringJournal,
  pauseRecurringJournal, resumeRecurringJournal, stopRecurringJournal,
  generateRecurringJournalNow,
  type RecurringJournal,
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
  active: 'success', paused: 'warning', stopped: 'default',
} as const

export default function RecurringJournalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const rjId = Number(id)
  const [rj, setRj] = useState<RecurringJournal | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function load() {
    setLoading(true)
    try { setRj(await getRecurringJournal(rjId)) }
    catch { toast.error('Failed to load recurring journal') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [rjId])

  async function action(label: string, fn: () => Promise<RecurringJournal>) {
    setBusy(true)
    try {
      const updated = await fn()
      setRj(updated)
      toast.success(label)
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed')
    } finally { setBusy(false) }
  }

  async function handleGenerateNow() {
    if (!rj) return
    setBusy(true)
    try {
      const res = await generateRecurringJournalNow(rj.id)
      toast.success(`Entry ${res.entry_no} generated`)
      load()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to generate')
    } finally { setBusy(false) }
  }

  async function handleDelete() {
    if (!rj) return
    setBusy(true)
    try {
      await deleteRecurringJournal(rj.id)
      toast.success('Profile deleted')
      navigate('/journals/recurring')
    } catch {
      toast.error('Failed to delete')
      setBusy(false)
    }
  }

  if (loading || !rj) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline text-teal-600" size={24} /></div>
  }

  const today = new Date().toISOString().slice(0, 10)
  const isDue = rj.status === 'active' && rj.next_run_date <= today

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <button onClick={() => navigate('/journals/recurring')}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3">
        <ArrowLeft size={14} /> Back to Recurring Journals
      </button>

      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Repeat size={18} className="text-teal-600" />
            <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>{rj.profile_name}</h1>
            <Badge variant={STATUS_BADGE[rj.status]}>{rj.status}</Badge>
            {rj.auto_post && <Badge variant="info">Auto-post</Badge>}
          </div>
          <p className="text-sm text-slate-500">
            {rj.voucher_type_display} · {FREQ_LABEL[rj.frequency]}
            {' · '}Next run <span className={cn('font-medium', isDue && 'text-amber-700')}>{formatDate(rj.next_run_date)}</span>
            {isDue && <span className="ml-1 text-amber-700 text-xs">(due)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {rj.status !== 'stopped' && (
            <Button variant="secondary" size="sm" onClick={() => navigate(`/journals/recurring/${rj.id}/edit`)}>
              <Pencil size={14} /> Edit
            </Button>
          )}
          {rj.status === 'active' && (
            <>
              <Button size="sm" onClick={handleGenerateNow} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} Generate Now
              </Button>
              <Button variant="secondary" size="sm" onClick={() => action('Paused', () => pauseRecurringJournal(rj.id))} disabled={busy}>
                <Pause size={14} /> Pause
              </Button>
            </>
          )}
          {rj.status === 'paused' && (
            <Button size="sm" onClick={() => action('Resumed', () => resumeRecurringJournal(rj.id))} disabled={busy}>
              <Play size={14} /> Resume
            </Button>
          )}
          {rj.status !== 'stopped' && (
            <Button variant="secondary" size="sm" onClick={() => action('Stopped', () => stopRecurringJournal(rj.id))} disabled={busy}>
              <Square size={14} /> Stop
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      </div>

      {rj.last_error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm flex items-start gap-2">
          <AlertCircle size={14} className="text-rose-600 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-medium text-rose-800">Last run failed:</span>{' '}
            <span className="text-rose-700">{rj.last_error}</span>
          </div>
        </div>
      )}

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat label="Frequency" value={FREQ_LABEL[rj.frequency]} />
          <Stat label="Total per cycle" value={formatCurrency(rj.total_debit)} />
          <Stat label="Entries generated" value={String(rj.generated_count)} />
          <Stat label="Last run" value={rj.last_run_date ? formatDate(rj.last_run_date) : '— never —'} />
          <Stat label="Start" value={formatDate(rj.start_date)} />
          <Stat label="End" value={rj.end_date ? formatDate(rj.end_date) : 'Indefinite'} />
          <Stat label="Auto-post" value={rj.auto_post ? 'Yes' : 'Drafts only'} />
          <Stat label="Narration template" value={rj.narration_template || '—'} mono />
        </div>
      </Card>

      <Card className="overflow-hidden p-0 mb-4">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Line Items</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Account</th>
              <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Description</th>
              <th className="text-right text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Debit</th>
              <th className="text-right text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rj.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-900">{l.account_name}</div>
                  <div className="text-xs text-slate-400 font-mono">{l.account_code}</div>
                </td>
                <td className="px-4 py-2.5 text-sm text-slate-600">{l.narration || '—'}</td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {parseFloat(l.debit) > 0 ? formatCurrency(l.debit) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {parseFloat(l.credit) > 0 ? formatCurrency(l.credit) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t border-slate-200">
              <td colSpan={2} className="px-4 py-2.5 text-right font-semibold">Total</td>
              <td className="px-4 py-2.5 text-right font-mono font-bold">{formatCurrency(rj.total_debit)}</td>
              <td className="px-4 py-2.5 text-right font-mono font-bold">{formatCurrency(rj.total_credit)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>

      <Card className="overflow-hidden p-0 mb-4">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Recently Generated</h2>
        </div>
        {rj.generated_recent.length === 0 ? (
          <div className="text-center py-6 text-sm text-slate-400">No entries generated yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Entry #</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Date</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {rj.generated_recent.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5">
                    <Link to={`/journals/${e.id}`} className="text-teal-700 hover:underline font-mono">
                      {e.entry_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-600">{formatDate(e.date)}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={e.is_posted ? 'success' : 'warning'}>
                      {e.is_posted ? 'Posted' : 'Draft'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this profile?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            Already-generated journal entries are kept. Only this template is removed.
          </p>
          <div className="flex gap-2 justify-end pt-4">
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

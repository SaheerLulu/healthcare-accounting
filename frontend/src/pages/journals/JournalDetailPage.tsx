import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Pencil, Send, Undo2, Trash2, Copy, FileText, Printer,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getJournalEntry, postEntry, reverseEntry, deleteJournalEntry,
  type JournalEntry,
} from '../../lib/api'
import { formatCurrency, formatDate, cn } from '../../lib/utils'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../../components/ui/dialog'
import { PrintVoucherView } from '../../components/PrintVoucherView'
import { useHotkeys, useHintRegister, type HotkeyHandler, type HotkeyHint } from '../../contexts/HotkeyContext'

const VOUCHER_BG: Record<string, string> = {
  JOURNAL:     'bg-slate-100 text-slate-700',
  PURCHASE:    'bg-amber-50 text-amber-700',
  SALE:        'bg-emerald-50 text-emerald-700',
  PAYMENT:     'bg-rose-50 text-rose-700',
  RECEIPT:     'bg-sky-50 text-sky-700',
  CONTRA:      'bg-violet-50 text-violet-700',
  CREDIT_NOTE: 'bg-emerald-50 text-emerald-700',
  DEBIT_NOTE:  'bg-amber-50 text-amber-700',
}
const voucherLabel = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

export default function JournalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const entryId = Number(id)
  const [entry, setEntry] = useState<JournalEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmReverse, setConfirmReverse] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const e = await getJournalEntry(entryId)
      setEntry(e)
    } catch {
      toast.error('Failed to load journal entry')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [entryId])

  async function handlePost() {
    if (!entry) return
    setBusy(true)
    try {
      const updated = await postEntry(entry.id)
      setEntry(updated)
      toast.success(`${updated.entry_no} posted`)
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to post')
    } finally { setBusy(false) }
  }

  async function handleReverse() {
    if (!entry) return
    setBusy(true)
    try {
      const reversal = await reverseEntry(entry.id)
      toast.success(`Reversal ${reversal.entry_no} created`)
      setConfirmReverse(false)
      navigate(`/journals/${reversal.id}`)
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to reverse')
    } finally { setBusy(false) }
  }

  async function handleDelete() {
    if (!entry) return
    setBusy(true)
    try {
      await deleteJournalEntry(entry.id)
      toast.success('Entry deleted')
      navigate('/journals')
    } catch {
      toast.error('Failed to delete')
      setBusy(false)
    }
  }

  // Hotkeys: Alt+P print, Alt+E edit (drafts), Alt+R reverse (posted), Esc back.
  const handleEdit = useCallback(() => {
    if (entry && !entry.is_posted) navigate(`/journals/${entry.id}/edit`)
  }, [entry, navigate])
  const handleReverseChord = useCallback(() => {
    if (entry?.is_posted) setConfirmReverse(true)
  }, [entry])
  const handleHotkeys = useMemo<HotkeyHandler[]>(() => [
    { chord: 'Alt+P', preventDefault: true, handler: () => setPrintOpen(true) },
    { chord: 'Alt+E', preventDefault: true, handler: handleEdit },
    { chord: 'Alt+R', preventDefault: true, handler: handleReverseChord },
    { chord: 'Escape', preventDefault: false, handler: () => navigate('/journals') },
  ], [handleEdit, handleReverseChord, navigate])
  useHotkeys(handleHotkeys)

  const hints = useMemo<HotkeyHint[]>(() => {
    const out: HotkeyHint[] = [
      { chord: 'Alt+P', label: 'Print' },
      { chord: 'Esc', label: 'Back' },
    ]
    if (entry?.is_posted) out.splice(1, 0, { chord: 'Alt+R', label: 'Reverse' })
    if (entry && !entry.is_posted) out.splice(1, 0, { chord: 'Alt+E', label: 'Edit' })
    return out
  }, [entry])
  useHintRegister(hints)

  if (loading || !entry) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline" size={24} style={{ color: 'var(--brand)' }} /></div>
  }

  const totals = entry.lines.reduce(
    (acc, l) => ({ dr: acc.dr + parseFloat(l.debit), cr: acc.cr + parseFloat(l.credit) }),
    { dr: 0, cr: 0 }
  )

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <button
        onClick={() => navigate('/journals')}
        className="inline-flex items-center gap-1 text-sm hover:underline"
        style={{ color: 'var(--ink-2)' }}
      >
        <ArrowLeft size={14} /> Back to Journals
      </button>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText size={18} style={{ color: 'var(--ink-3)' }} />
            <h1 className="text-xl font-semibold mono" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>{entry.entry_no}</h1>
            <Badge variant={entry.is_posted ? 'success' : 'warning'}>
              {entry.is_posted ? 'Posted' : 'Draft'}
            </Badge>
            <span className={cn('inline-flex px-2 py-0.5 rounded text-xs font-medium', VOUCHER_BG[entry.voucher_type] || 'bg-slate-100 text-slate-600')}>
              {voucherLabel(entry.voucher_type)}
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            {formatDate(entry.date)}
            {entry.reference_type && (
              <> · {entry.reference_type}{entry.reference_id ? ` #${entry.reference_id}` : ''}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!entry.is_posted && (
            <>
              <Button variant="secondary" size="sm" onClick={() => navigate(`/journals/${entry.id}/edit`)}>
                <Pencil size={14} /> Edit
              </Button>
              <Button size="sm" onClick={handlePost} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} Post
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete
              </Button>
            </>
          )}
          {entry.is_posted && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmReverse(true)} disabled={busy}>
              <Undo2 size={14} /> Reverse
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => duplicateLink(entry, navigate)}>
            <Copy size={14} /> Duplicate
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPrintOpen(true)}>
            <Printer size={14} /> Print
            <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Alt+P</kbd>
          </Button>
        </div>
      </div>

      {entry.narration && (
        <Card className="p-4">
          <div
            className="text-xs mono uppercase mb-1"
            style={{ color: 'var(--ink-3)', letterSpacing: '0.1em', fontWeight: 600 }}
          >
            Notes
          </div>
          <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--ink)' }}>{entry.narration}</p>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Line Items</h2>
        </div>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--color-grey-light)', borderBottom: '1px solid var(--line)' }}>
            <tr>
              <th className="text-left text-xs font-semibold px-4 py-2 uppercase mono" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em' }}>Account</th>
              <th className="text-left text-xs font-semibold px-4 py-2 uppercase mono" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em' }}>Description</th>
              <th className="text-left text-xs font-semibold px-4 py-2 uppercase mono" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em' }}>Party</th>
              <th className="text-right text-xs font-semibold px-4 py-2 uppercase mono" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em' }}>Debit</th>
              <th className="text-right text-xs font-semibold px-4 py-2 uppercase mono" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em' }}>Credit</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l, i) => (
              <tr key={i} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
                <td className="px-4 py-2.5">
                  <div className="font-medium" style={{ color: 'var(--ink)' }}>{l.account_name || `Account ${l.account}`}</div>
                  {l.account_code && <div className="text-xs mono" style={{ color: 'var(--ink-3)' }}>{l.account_code}</div>}
                </td>
                <td className="px-4 py-2.5 text-sm" style={{ color: 'var(--ink-2)' }}>{l.narration || '—'}</td>
                <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--ink-3)' }}>
                  {(l as JournalEntry['lines'][number] & { party_type?: string; party_id?: number | null })
                    .party_type && (l as JournalEntry['lines'][number] & { party_type?: string; party_id?: number | null }).party_type !== 'None'
                    ? `${(l as JournalEntry['lines'][number] & { party_type?: string; party_id?: number | null }).party_type} #${(l as JournalEntry['lines'][number] & { party_type?: string; party_id?: number | null }).party_id}`
                    : '—'}
                </td>
                <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--ink)' }}>
                  {parseFloat(l.debit) > 0 ? formatCurrency(l.debit) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--ink)' }}>
                  {parseFloat(l.credit) > 0 ? formatCurrency(l.credit) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot style={{ background: 'var(--color-grey-light)', borderTop: '2px solid var(--line)' }}>
            <tr>
              <td colSpan={3} className="px-4 py-2.5 text-right text-sm font-semibold" style={{ color: 'var(--ink)' }}>Total</td>
              <td className="px-4 py-2.5 text-right mono font-bold" style={{ color: 'var(--ink)' }}>{formatCurrency(totals.dr)}</td>
              <td className="px-4 py-2.5 text-right mono font-bold" style={{ color: 'var(--ink)' }}>{formatCurrency(totals.cr)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>

      <div className="text-xs mono" style={{ color: 'var(--ink-3)' }}>
        Created {formatDate(entry.created_at)}
        {(entry as JournalEntry & { created_by_name?: string | null }).created_by_name && (
          <> by {(entry as JournalEntry & { created_by_name?: string | null }).created_by_name}</>
        )}
      </div>

      {/* Delete dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this draft?</DialogTitle></DialogHeader>
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            Delete <span className="font-mono font-semibold">{entry.entry_no}</span>? This cannot be undone.
          </p>
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy && <Loader2 className="animate-spin" size={14} />} Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reverse dialog */}
      <Dialog open={confirmReverse} onOpenChange={setConfirmReverse}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reverse this entry?</DialogTitle></DialogHeader>
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            Create a reversal entry that flips all debits and credits. The original entry remains posted.
          </p>
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="secondary" onClick={() => setConfirmReverse(false)}>Cancel</Button>
            <Button onClick={handleReverse} disabled={busy}>
              {busy && <Loader2 className="animate-spin" size={14} />} Create Reversal
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PrintVoucherView open={printOpen} onOpenChange={setPrintOpen} entry={entry} />
    </div>
  )
}

function duplicateLink(entry: JournalEntry, navigate: (to: string, opts?: { state?: unknown }) => void) {
  navigate('/journals/new', { state: { duplicateOf: entry.id } })
}

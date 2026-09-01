import { useEffect, useState } from 'react'
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
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { PrintVoucherView } from '../../components/PrintVoucherView'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

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
  const [confirmPost, setConfirmPost] = useState(false)
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
      setConfirmPost(false)
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

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // The lines table is read-only, but on a long entry it is also the only part
  // of the screen worth scrolling, and a <tr> answers no key. Roving tabindex
  // (no onActivate — nothing to open) makes F3 then ↑↓ walk the lines and
  // leaves Tab to step clean past them to the footer.
  const isDraft = !!entry && !entry.is_posted
  const isPosted = !!entry?.is_posted
  const lines = useListKeyboardNav({ count: entry?.lines.length ?? 0 })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+E', label: 'Edit', run: () => { if (isDraft) navigate(`/journals/${entryId}/edit`) }, when: isDraft },
      // Ctrl+A confirms rather than posts. A posted entry is immutable — it can
      // only be reversed — and Ctrl+A is the select-all reflex on a screen full
      // of copyable figures, so the chord must not commit to the ledger on its
      // own. The Post button beside it stays a direct, aimed press.
      { chord: 'Ctrl+A', label: 'Post', run: () => { if (isDraft && !busy) setConfirmPost(true) }, when: isDraft },
      // Reverse lives on Alt+V only. Alt+R is Refresh everywhere in this app,
      // and a hidden second meaning for it here — absent from the hint bar and
      // from F1 — would land the app-wide refresh habit on a reversal confirm.
      { chord: 'Alt+V', label: 'Reverse', run: () => { if (isPosted) setConfirmReverse(true) }, when: isPosted },
      { chord: 'Alt+D', label: 'Delete', run: () => { if (isDraft) setConfirmDelete(true) }, when: isDraft },
      { chord: 'Alt+P', label: 'Print', run: () => setPrintOpen(true) },
    ],
    onFocusList: lines.focusList,
    onBack: () => navigate('/journals'),
  })

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

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <FileText size={18} className="flex-shrink-0" style={{ color: 'var(--ink-3)' }} />
            <h1 className="text-lg sm:text-xl font-semibold mono break-all" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>{entry.entry_no}</h1>
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
                <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Alt+E</kbd>
              </Button>
              <Button size="sm" onClick={handlePost} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} Post
                <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'rgba(255,255,255,0.75)' }}>Ctrl+A</kbd>
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete
                <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Alt+D</kbd>
              </Button>
            </>
          )}
          {entry.is_posted && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmReverse(true)} disabled={busy}>
              <Undo2 size={14} /> Reverse
              <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Alt+V</kbd>
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
        <div className="table-scroll">
          <table className="w-full text-sm min-w-[640px]">
            <thead style={{ background: 'var(--color-grey-light)', borderBottom: '1px solid var(--line)' }}>
              <tr>
                <th className="text-left text-xs font-semibold px-4 py-2 uppercase mono" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em' }}>Account</th>
                <th className="text-left text-xs font-semibold px-4 py-2 uppercase mono" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em' }}>Description</th>
                <th className="text-left text-xs font-semibold px-4 py-2 uppercase mono" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em' }}>Party</th>
                <th className="text-right text-xs font-semibold px-4 py-2 uppercase mono" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em' }}>Debit</th>
                <th className="text-right text-xs font-semibold px-4 py-2 uppercase mono" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em' }}>Credit</th>
              </tr>
            </thead>
            <tbody {...lines.containerProps}>
              {entry.lines.map((l, i) => (
                <tr
                  key={i}
                  className="border-b last:border-0"
                  style={{ borderColor: 'var(--line)' }}
                  aria-label={l.account_name || `Account ${l.account}`}
                  {...lines.rowProps(i)}
                >
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
        </div>
      </Card>

      <div className="text-xs mono" style={{ color: 'var(--ink-3)' }}>
        Created {formatDate(entry.created_at)}
        {(entry as JournalEntry & { created_by_name?: string | null }).created_by_name && (
          <> by {(entry as JournalEntry & { created_by_name?: string | null }).created_by_name}</>
        )}
      </div>

      {/* Post (Ctrl+A), Delete (Alt+D) and Reverse (Alt+V) are all reachable by
          chord, so all three go through the shared ConfirmDialog: it lands focus
          on the safe button for the tone, answers Ctrl+Enter as "yes, do it",
          and restores focus to the trigger on close. */}
      <ConfirmDialog
        open={confirmPost}
        onOpenChange={setConfirmPost}
        tone="danger"
        title="Post this entry?"
        description={<>Post <span className="mono font-semibold">{entry.entry_no}</span> to the general ledger. A posted entry is immutable — it can only be reversed, never edited.</>}
        confirmLabel="Post"
        cancelLabel="Keep as draft"
        loading={busy}
        onConfirm={handlePost}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="danger"
        title="Delete this draft?"
        description={<>Delete <span className="mono font-semibold">{entry.entry_no}</span>? This cannot be undone.</>}
        confirmLabel="Delete"
        loading={busy}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={confirmReverse}
        onOpenChange={setConfirmReverse}
        tone="danger"
        title="Reverse this entry?"
        description="Create a reversal entry that flips all debits and credits. The original entry remains posted."
        confirmLabel="Create Reversal"
        cancelLabel="Keep posted"
        loading={busy}
        onConfirm={handleReverse}
      />

      <PrintVoucherView open={printOpen} onOpenChange={setPrintOpen} entry={entry} />
    </div>
  )
}

function duplicateLink(entry: JournalEntry, navigate: (to: string, opts?: { state?: unknown }) => void) {
  navigate('/journals/new', { state: { duplicateOf: entry.id } })
}

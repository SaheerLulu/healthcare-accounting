import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Plus, Trash2, Save, Send, Info } from 'lucide-react'
import { toast } from 'sonner'
import {
  getChartOfAccounts, getJournalEntry,
  createJournalEntry, updateJournalEntry, postEntry,
  type Account, type JournalLine, type JournalEntry,
} from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { AccountPicker } from './AccountPicker'

const VOUCHER_TYPES = [
  'JOURNAL', 'PAYMENT', 'RECEIPT', 'CONTRA', 'CREDIT_NOTE', 'DEBIT_NOTE',
] as const
const voucherLabel = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

interface Line {
  uid: string
  account: number | null
  debit: string
  credit: string
  narration: string
}

const newLine = (): Line => ({
  uid: Math.random().toString(36).slice(2),
  account: null, debit: '', credit: '', narration: '',
})

const today = () => new Date().toISOString().split('T')[0]

export default function JournalEditorPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const editingId = id ? Number(id) : null

  const [accounts, setAccounts] = useState<Account[]>([])
  const [date, setDate] = useState(today())
  const [voucherType, setVoucherType] = useState<typeof VOUCHER_TYPES[number]>('JOURNAL')
  const [referenceType, setReferenceType] = useState('Manual')
  const [referenceId, setReferenceId] = useState('')
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine(), newLine()])
  const [loading, setLoading] = useState(!!editingId)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState(false)
  const [originalEntry, setOriginalEntry] = useState<JournalEntry | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const accs = await getChartOfAccounts()
        if (!cancelled) setAccounts(accs)
      } catch { /* ignore */ }
      if (editingId) {
        try {
          const entry = await getJournalEntry(editingId)
          if (cancelled) return
          if (entry.is_posted) {
            toast.error('Posted entries cannot be edited — reverse it instead')
            navigate(`/journals/${editingId}`, { replace: true })
            return
          }
          setOriginalEntry(entry)
          setDate(entry.date)
          setVoucherType(entry.voucher_type as typeof VOUCHER_TYPES[number])
          setReferenceType(entry.reference_type || 'Manual')
          setReferenceId(entry.reference_id ? String(entry.reference_id) : '')
          setNarration(entry.narration || '')
          setLines(entry.lines.length > 0
            ? entry.lines.map((l): Line => ({
                uid: Math.random().toString(36).slice(2),
                account: l.account,
                debit: parseFloat(l.debit) > 0 ? l.debit : '',
                credit: parseFloat(l.credit) > 0 ? l.credit : '',
                narration: l.narration || '',
              }))
            : [newLine(), newLine()])
        } catch {
          toast.error('Failed to load journal entry')
        }
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [editingId, navigate])

  const totals = useMemo(() => {
    let dr = 0, cr = 0
    for (const l of lines) {
      dr += parseFloat(l.debit) || 0
      cr += parseFloat(l.credit) || 0
    }
    return { dr, cr, diff: dr - cr }
  }, [lines])

  const isBalanced = Math.abs(totals.diff) < 0.005 && totals.dr > 0

  function updateLine(uid: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => l.uid === uid ? { ...l, ...patch } : l))
  }
  function addLine() { setLines((ls) => [...ls, newLine()]) }
  function removeLine(uid: string) {
    setLines((ls) => ls.length <= 1 ? ls : ls.filter((l) => l.uid !== uid))
  }

  function payload() {
    const cleanLines: JournalLine[] = lines
      .filter((l) => l.account && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
      .map((l) => ({
        account: l.account!,
        debit: l.debit ? l.debit : '0',
        credit: l.credit ? l.credit : '0',
        narration: l.narration || '',
      }))
    return {
      date,
      narration,
      voucher_type: voucherType,
      reference_type: referenceType,
      reference_id: referenceId ? Number(referenceId) : null,
      lines: cleanLines,
    }
  }

  function validate(): string | null {
    const data = payload()
    if (data.lines.length < 2) return 'At least two lines are required'
    if (!isBalanced) return `Debit ₹${totals.dr.toFixed(2)} ≠ Credit ₹${totals.cr.toFixed(2)}`
    return null
  }

  async function handleSave(thenPost = false) {
    const err = validate()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      let entry: JournalEntry
      if (editingId) {
        entry = await updateJournalEntry(editingId, payload())
      } else {
        entry = await createJournalEntry(payload())
      }
      if (thenPost) {
        setPosting(true)
        try {
          await postEntry(entry.id)
          toast.success(`${entry.entry_no} posted`)
        } catch (err) {
          const e = err as { response?: { data?: { detail?: string } } }
          toast.error(e.response?.data?.detail || 'Saved as draft, but post failed')
        } finally { setPosting(false) }
      } else {
        toast.success(editingId ? `${entry.entry_no} saved` : `${entry.entry_no} created as draft`)
      }
      navigate(`/journals/${entry.id}`)
    } catch (err) {
      const e = err as { response?: { data?: Record<string, unknown> } }
      const data = e.response?.data
      const msg = data
        ? Object.entries(data).map(([k, v]) =>
            `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(' • ')
        : 'Failed to save'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline text-teal-600" size={24} /></div>
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-24">
      <button
        onClick={() => navigate('/journals')}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3"
      >
        <ArrowLeft size={14} /> Back to Journals
      </button>

      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>
            {editingId ? `Edit ${originalEntry?.entry_no ?? 'Journal'}` : 'New Journal Entry'}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>
            {editingId ? 'Update the draft and save or publish.' : 'Record a manual debit/credit entry.'}
          </p>
        </div>
        {originalEntry && <Badge variant="warning">Draft</Badge>}
      </div>

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Date" required>
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Voucher Type" required>
            <select value={voucherType}
              onChange={(e) => setVoucherType(e.target.value as typeof VOUCHER_TYPES[number])}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
              {VOUCHER_TYPES.map((v) => <option key={v} value={v}>{voucherLabel(v)}</option>)}
            </select>
          </Field>
          <Field label="Journal #" hint="Auto-generated">
            <Input value={originalEntry?.entry_no || '— assigned on save —'} readOnly className="bg-slate-50 font-mono text-xs" />
          </Field>
          <Field label="Reference #">
            <Input value={referenceId} onChange={(e) => setReferenceId(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Notes">
            <textarea value={narration} onChange={(e) => setNarration(e.target.value)} rows={2}
              placeholder="Internal notes (e.g. month-end accrual, depreciation, etc.)"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </Field>
        </div>
      </Card>

      {/* Line items */}
      <Card className="overflow-hidden p-0 mb-4">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Line Items</h2>
          <span className="text-xs text-slate-400">Total debits must equal total credits</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide" style={{ width: '32%' }}>Account</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Description</th>
                <th className="text-right text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide" style={{ width: '14%' }}>Debit</th>
                <th className="text-right text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide" style={{ width: '14%' }}>Credit</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.uid} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 align-top">
                    <AccountPicker
                      accounts={accounts}
                      value={line.account}
                      onChange={(id) => updateLine(line.uid, { account: id })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      value={line.narration}
                      onChange={(e) => updateLine(line.uid, { narration: e.target.value })}
                      placeholder="Optional description"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      type="number" step="0.01" min="0"
                      value={line.debit}
                      onChange={(e) => updateLine(line.uid, { debit: e.target.value, credit: e.target.value ? '' : line.credit })}
                      placeholder="0.00"
                      className="text-right font-mono"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      type="number" step="0.01" min="0"
                      value={line.credit}
                      onChange={(e) => updateLine(line.uid, { credit: e.target.value, debit: e.target.value ? '' : line.debit })}
                      placeholder="0.00"
                      className="text-right font-mono"
                    />
                  </td>
                  <td className="px-2 py-2 align-middle">
                    <button
                      type="button"
                      onClick={() => removeLine(line.uid)}
                      disabled={lines.length <= 1}
                      className="text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:cursor-not-allowed p-1.5 rounded hover:bg-slate-100"
                      title="Remove line"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t border-slate-200">
              <tr>
                <td className="px-4 py-2 text-xs text-slate-500" colSpan={2}>
                  <button
                    type="button"
                    onClick={addLine}
                    className="inline-flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-800"
                  >
                    <Plus size={14} /> Add another line
                  </button>
                </td>
                <td className="px-4 py-2 text-right font-mono text-sm font-semibold text-slate-900">
                  {formatCurrency(totals.dr)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-sm font-semibold text-slate-900">
                  {formatCurrency(totals.cr)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Difference banner */}
      {totals.dr > 0 && !isBalanced && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-sm flex items-center gap-2">
          <Info size={14} className="text-amber-600" />
          <span className="text-amber-800">
            <span className="font-medium">Out of balance</span> — debits and credits differ by {formatCurrency(Math.abs(totals.diff))}
          </span>
        </div>
      )}

      {/* Sticky save bar */}
      <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-white border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] flex items-center justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={() => navigate('/journals')}>Cancel</Button>
        <Button variant="secondary" onClick={() => handleSave(false)} disabled={saving || posting}>
          {saving && !posting ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          Save as Draft
        </Button>
        <Button onClick={() => handleSave(true)} disabled={saving || posting || !isBalanced}>
          {posting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
          Save and Post
        </Button>
      </div>
    </div>
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

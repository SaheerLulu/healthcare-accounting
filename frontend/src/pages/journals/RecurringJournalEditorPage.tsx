import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Plus, Trash2, Save, Repeat, Info } from 'lucide-react'
import { toast } from 'sonner'
import {
  getChartOfAccounts,
  getRecurringJournal, createRecurringJournal, updateRecurringJournal,
  type Account, type RecurringJournal, type RecurringFrequency,
} from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { AccountPicker } from './AccountPicker'

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

const VOUCHER_TYPES = ['JOURNAL', 'PAYMENT', 'RECEIPT', 'CONTRA', 'CREDIT_NOTE', 'DEBIT_NOTE'] as const

const FREQUENCIES: { v: RecurringFrequency; label: string; sub: string }[] = [
  { v: 'daily', label: 'Daily', sub: 'Every day' },
  { v: 'weekly', label: 'Weekly', sub: 'Every 7 days' },
  { v: 'monthly', label: 'Monthly', sub: 'Same day each month' },
  { v: 'quarterly', label: 'Quarterly', sub: 'Every 3 months' },
  { v: 'yearly', label: 'Yearly', sub: 'Same day each year' },
]

const todayStr = () => new Date().toISOString().slice(0, 10)
const voucherLabel = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

export default function RecurringJournalEditorPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const editingId = id ? Number(id) : null

  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(!!editingId)
  const [saving, setSaving] = useState(false)

  const [profileName, setProfileName] = useState('')
  const [voucherType, setVoucherType] = useState<typeof VOUCHER_TYPES[number]>('JOURNAL')
  const [narrationTemplate, setNarrationTemplate] = useState('')
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly')
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState('')
  const [autoPost, setAutoPost] = useState(true)
  const [lines, setLines] = useState<Line[]>([newLine(), newLine()])
  const [original, setOriginal] = useState<RecurringJournal | null>(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const accs = await getChartOfAccounts()
        if (!cancelled) setAccounts(accs)
      } catch { /* ignore */ }
      if (editingId) {
        try {
          const rj = await getRecurringJournal(editingId)
          if (cancelled) return
          setOriginal(rj)
          setProfileName(rj.profile_name)
          setVoucherType(rj.voucher_type as typeof VOUCHER_TYPES[number])
          setNarrationTemplate(rj.narration_template)
          setFrequency(rj.frequency)
          setStartDate(rj.start_date)
          setEndDate(rj.end_date || '')
          setAutoPost(rj.auto_post)
          setLines(rj.lines.length
            ? rj.lines.map((l): Line => ({
                uid: Math.random().toString(36).slice(2),
                account: l.account,
                debit: parseFloat(l.debit) > 0 ? l.debit : '',
                credit: parseFloat(l.credit) > 0 ? l.credit : '',
                narration: l.narration || '',
              }))
            : [newLine(), newLine()])
        } catch { toast.error('Failed to load profile') }
      }
      if (!cancelled) setLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [editingId])

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
    return {
      profile_name: profileName,
      voucher_type: voucherType,
      narration_template: narrationTemplate,
      frequency,
      start_date: startDate,
      end_date: endDate || null,
      auto_post: autoPost,
      lines: lines
        .filter((l) => l.account && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
        .map((l) => ({
          account: l.account!,
          debit: l.debit || '0',
          credit: l.credit || '0',
          narration: l.narration,
        })),
    }
  }

  function validate(): string | null {
    if (!profileName.trim()) return 'Profile name is required'
    if (!startDate) return 'Start date is required'
    const data = payload()
    if (data.lines.length < 2) return 'At least two lines are required'
    if (!isBalanced) return `Debit ₹${totals.dr.toFixed(2)} ≠ Credit ₹${totals.cr.toFixed(2)}`
    if (endDate && endDate < startDate) return 'End date cannot be before start date'
    return null
  }

  async function handleSave() {
    const err = validate()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      const rj = editingId
        ? await updateRecurringJournal(editingId, payload())
        : await createRecurringJournal(payload())
      toast.success(editingId ? 'Profile saved' : 'Recurring journal created')
      navigate(`/journals/recurring/${rj.id}`)
    } catch (err) {
      const e = err as { response?: { data?: Record<string, unknown> } }
      const data = e.response?.data
      const msg = data
        ? Object.entries(data).map(([k, v]) =>
            `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(' • ')
        : 'Failed to save'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  if (loading) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline text-teal-600" size={24} /></div>
  }

  return (
    <div className="p-6 max-w-6xl mx-auto pb-24">
      <button onClick={() => navigate('/journals/recurring')}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3">
        <ArrowLeft size={14} /> Back to Recurring Journals
      </button>

      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Repeat size={18} className="text-teal-600" />
          <h1 className="text-xl font-bold text-slate-900">
            {editingId ? `Edit ${original?.profile_name || 'profile'}` : 'New Recurring Journal'}
          </h1>
        </div>
        <p className="text-sm text-slate-500">
          A balanced JE template — entries are posted on each cycle with the same lines.
        </p>
      </div>

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Profile Name" required hint="e.g. 'Monthly depreciation'">
            <Input required value={profileName} onChange={(e) => setProfileName(e.target.value)} />
          </Field>
          <Field label="Voucher Type" required>
            <select value={voucherType} onChange={(e) => setVoucherType(e.target.value as typeof VOUCHER_TYPES[number])}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
              {VOUCHER_TYPES.map((v) => <option key={v} value={v}>{voucherLabel(v)}</option>)}
            </select>
          </Field>
          <Field label="Narration Template" hint="Tokens: {YYYY-MM} {YYYY} {MM} {DD} {MON}">
            <Input value={narrationTemplate} onChange={(e) => setNarrationTemplate(e.target.value)}
              placeholder="e.g. Depreciation for {MON} {YYYY}" />
          </Field>
        </div>
      </Card>

      <Card className="p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Schedule</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          {FREQUENCIES.map((f) => (
            <button key={f.v} type="button" onClick={() => setFrequency(f.v)}
              className={'rounded-lg border px-3 py-2 text-left transition-colors ' +
                (frequency === f.v
                  ? 'border-teal-500 bg-teal-50 text-teal-800'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
              <div className="text-sm font-medium">{f.label}</div>
              <div className="text-[11px] text-slate-400">{f.sub}</div>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Start Date" required>
            <Input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End Date" hint="Leave blank for indefinite">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <label className="flex items-end gap-2 pb-1.5">
            <input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)}
              className="accent-teal-600 w-4 h-4 mt-0.5" />
            <span className="text-sm text-slate-700">
              Auto-post entries
              <span className="block text-xs text-slate-400">Off = drafts you can review before posting</span>
            </span>
          </label>
        </div>
      </Card>

      <Card className="overflow-hidden p-0 mb-4">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Line Items</h2>
          <span className="text-xs text-slate-400">Debits must equal credits</span>
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
              {lines.map((l) => (
                <tr key={l.uid} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 align-top">
                    <AccountPicker accounts={accounts} value={l.account}
                      onChange={(id) => updateLine(l.uid, { account: id })} />
                  </td>
                  <td className="px-4 py-2">
                    <Input value={l.narration} onChange={(e) => updateLine(l.uid, { narration: e.target.value })}
                      placeholder="Optional" />
                  </td>
                  <td className="px-4 py-2">
                    <Input type="number" step="0.01" min="0" value={l.debit}
                      onChange={(e) => updateLine(l.uid, { debit: e.target.value, credit: e.target.value ? '' : l.credit })}
                      className="text-right font-mono" placeholder="0.00" />
                  </td>
                  <td className="px-4 py-2">
                    <Input type="number" step="0.01" min="0" value={l.credit}
                      onChange={(e) => updateLine(l.uid, { credit: e.target.value, debit: e.target.value ? '' : l.debit })}
                      className="text-right font-mono" placeholder="0.00" />
                  </td>
                  <td className="px-2 py-2 align-middle">
                    <button type="button" onClick={() => removeLine(l.uid)} disabled={lines.length <= 1}
                      className="text-slate-400 hover:text-rose-600 disabled:opacity-30 p-1.5 rounded hover:bg-slate-100">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t border-slate-200">
              <tr>
                <td className="px-4 py-2" colSpan={2}>
                  <button type="button" onClick={addLine}
                    className="inline-flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-800">
                    <Plus size={14} /> Add another line
                  </button>
                </td>
                <td className="px-4 py-2 text-right font-mono font-semibold">{formatCurrency(totals.dr)}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold">{formatCurrency(totals.cr)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {totals.dr > 0 && !isBalanced && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-sm flex items-center gap-2">
          <Info size={14} className="text-amber-600" />
          <span className="text-amber-800">
            <span className="font-medium">Out of balance</span> — debits and credits differ by {formatCurrency(Math.abs(totals.diff))}
          </span>
        </div>
      )}

      <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-white border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] flex items-center justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={() => navigate('/journals/recurring')}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !isBalanced}>
          {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          {editingId ? 'Save Changes' : 'Create Profile'}
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

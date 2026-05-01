import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Plus, Trash2, Save, Repeat } from 'lucide-react'
import { toast } from 'sonner'
import {
  getChartOfAccounts, getSuppliers,
  getRecurringBill, createRecurringBill, updateRecurringBill,
  type Account, type Party, type RecurringBill, type RecurringFrequency,
} from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { AccountPicker } from '../journals/AccountPicker'

interface Item {
  uid: string
  account: number | null
  description: string
  amount: string
}

const newItem = (): Item => ({
  uid: Math.random().toString(36).slice(2),
  account: null, description: '', amount: '',
})

const FREQUENCIES: { v: RecurringFrequency; label: string; sub: string }[] = [
  { v: 'daily', label: 'Daily', sub: 'Every day' },
  { v: 'weekly', label: 'Weekly', sub: 'Every 7 days' },
  { v: 'monthly', label: 'Monthly', sub: 'Same day each month' },
  { v: 'quarterly', label: 'Quarterly', sub: 'Every 3 months' },
  { v: 'yearly', label: 'Yearly', sub: 'Same day each year' },
]

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function RecurringBillEditorPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const editingId = id ? Number(id) : null

  const [accounts, setAccounts] = useState<Account[]>([])
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [loading, setLoading] = useState(!!editingId)

  const [profileName, setProfileName] = useState('')
  const [vendorId, setVendorId] = useState<number | null>(null)
  const [vendorName, setVendorName] = useState('')

  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly')
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState('')
  const [dueDays, setDueDays] = useState('30')
  const [autoApprove, setAutoApprove] = useState(false)
  const [billNoPattern, setBillNoPattern] = useState('')

  const [items, setItems] = useState<Item[]>([newItem()])
  const [taxCgst, setTaxCgst] = useState('0')
  const [taxSgst, setTaxSgst] = useState('0')
  const [taxIgst, setTaxIgst] = useState('0')
  const [notes, setNotes] = useState('')

  const [original, setOriginal] = useState<RecurringBill | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const [accs, sups] = await Promise.all([getChartOfAccounts(), getSuppliers()])
        if (cancelled) return
        setAccounts(accs)
        setSuppliers(sups)
      } catch { /* ignore */ }
      if (editingId) {
        try {
          const rb = await getRecurringBill(editingId)
          if (cancelled) return
          setOriginal(rb)
          setProfileName(rb.profile_name)
          setVendorId(rb.vendor_id); setVendorName(rb.vendor_name)
          setFrequency(rb.frequency)
          setStartDate(rb.start_date)
          setEndDate(rb.end_date || '')
          setDueDays(String(rb.due_days))
          setAutoApprove(rb.auto_approve)
          setBillNoPattern(rb.bill_no_pattern)
          setTaxCgst(rb.tax_cgst); setTaxSgst(rb.tax_sgst); setTaxIgst(rb.tax_igst)
          setNotes(rb.notes)
          setItems(rb.items.length ? rb.items.map((it): Item => ({
            uid: Math.random().toString(36).slice(2),
            account: it.account, description: it.description, amount: it.amount,
          })) : [newItem()])
        } catch {
          toast.error('Failed to load recurring profile')
        }
      }
      if (!cancelled) setLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [editingId])

  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === 'EXPENSE'),
    [accounts]
  )

  const totals = useMemo(() => {
    const subtotal = items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
    const tax = (parseFloat(taxCgst) || 0) + (parseFloat(taxSgst) || 0) + (parseFloat(taxIgst) || 0)
    return { subtotal, tax, total: subtotal + tax }
  }, [items, taxCgst, taxSgst, taxIgst])

  function pickVendor(id: number) {
    setVendorId(id)
    const s = suppliers.find((x) => x.id === id)
    if (s) setVendorName(s.name)
  }
  function updateItem(uid: string, patch: Partial<Item>) {
    setItems((xs) => xs.map((x) => x.uid === uid ? { ...x, ...patch } : x))
  }
  function addItem() { setItems((xs) => [...xs, newItem()]) }
  function removeItem(uid: string) {
    setItems((xs) => xs.length <= 1 ? xs : xs.filter((x) => x.uid !== uid))
  }

  function payload() {
    return {
      profile_name: profileName,
      vendor_id: vendorId,
      vendor_name: vendorName,
      subtotal: totals.subtotal.toFixed(2),
      tax_cgst: taxCgst || '0',
      tax_sgst: taxSgst || '0',
      tax_igst: taxIgst || '0',
      total_amount: totals.total.toFixed(2),
      notes,
      frequency,
      start_date: startDate,
      end_date: endDate || null,
      due_days: parseInt(dueDays, 10) || 30,
      auto_approve: autoApprove,
      bill_no_pattern: billNoPattern,
      items: items
        .filter((i) => i.account && parseFloat(i.amount) > 0)
        .map((i) => ({ account: i.account!, description: i.description, amount: i.amount })),
    }
  }

  function validate(): string | null {
    if (!profileName.trim()) return 'Profile name is required'
    if (!vendorName.trim()) return 'Vendor name is required'
    if (!startDate) return 'Start date is required'
    const data = payload()
    if (data.items.length === 0) return 'Add at least one expense line'
    if (totals.total <= 0) return 'Total must be > 0'
    if (endDate && endDate < startDate) return 'End date cannot be before start date'
    return null
  }

  async function handleSave() {
    const err = validate()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      const rb = editingId
        ? await updateRecurringBill(editingId, payload())
        : await createRecurringBill(payload())
      toast.success(editingId ? 'Profile saved' : 'Recurring profile created')
      navigate(`/bills/recurring/${rb.id}`)
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
    <div className="max-w-6xl mx-auto space-y-5 pb-24">
      <button onClick={() => navigate('/bills/recurring')}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3">
        <ArrowLeft size={14} /> Back to Recurring Bills
      </button>

      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Repeat size={18} className="text-teal-600" />
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>
            {editingId ? `Edit ${original?.profile_name || 'profile'}` : 'New Recurring Bill'}
          </h1>
        </div>
        <p className="text-sm text-slate-500">
          A template — bills are auto-created on each cycle from this. Use it for rent, utilities, retainers, anything that repeats.
        </p>
      </div>

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Profile Name" required hint="Internal label, not shown on the bill">
            <Input required value={profileName} onChange={(e) => setProfileName(e.target.value)}
              placeholder="e.g. Monthly office rent" />
          </Field>
          <Field label="Vendor" required hint="Pick a known supplier or enter a name">
            <div className="grid grid-cols-2 gap-2">
              <select value={vendorId ?? ''}
                onChange={(e) => {
                  if (e.target.value) pickVendor(Number(e.target.value))
                  else setVendorId(null)
                }}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                <option value="">— New —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Input required value={vendorName} onChange={(e) => setVendorName(e.target.value)}
                placeholder="Vendor name" />
            </div>
          </Field>
        </div>
      </Card>

      <Card className="p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Schedule</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          {FREQUENCIES.map((f) => (
            <button
              key={f.v}
              type="button"
              onClick={() => setFrequency(f.v)}
              className={'rounded-lg border px-3 py-2 text-left transition-colors ' +
                (frequency === f.v
                  ? 'border-teal-500 bg-teal-50 text-teal-800'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300')}
            >
              <div className="text-sm font-medium">{f.label}</div>
              <div className="text-[11px] text-slate-400">{f.sub}</div>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Start Date" required hint="The date of the first generated bill">
            <Input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End Date" hint="Leave blank to run indefinitely">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label="Due Days" hint="Days from bill date until due">
            <Input type="number" min="0" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Field label="Bill # Pattern" hint="Optional. Tokens: {YYYY-MM} {YYYY} {MM} {DD} {MON} {SEQ}">
            <Input value={billNoPattern} onChange={(e) => setBillNoPattern(e.target.value)}
              placeholder="e.g. RENT-{YYYY-MM}" />
          </Field>
          <label className="flex items-end gap-2 pb-1.5">
            <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)}
              className="accent-teal-600 w-4 h-4 mt-0.5" />
            <span className="text-sm text-slate-700">
              Auto-approve generated bills <span className="text-xs text-slate-400">(post immediately, no draft review)</span>
            </span>
          </label>
        </div>
      </Card>

      {/* Line items */}
      <Card className="overflow-hidden p-0 mb-4">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Expense Lines</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide" style={{ width: '34%' }}>Expense Account</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Description</th>
                <th className="text-right text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide" style={{ width: '18%' }}>Amount</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.uid} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 align-top">
                    <AccountPicker accounts={expenseAccounts} value={it.account}
                      onChange={(id) => updateItem(it.uid, { account: id })} />
                  </td>
                  <td className="px-4 py-2">
                    <Input value={it.description} onChange={(e) => updateItem(it.uid, { description: e.target.value })}
                      placeholder="Description" />
                  </td>
                  <td className="px-4 py-2">
                    <Input type="number" step="0.01" min="0" value={it.amount}
                      onChange={(e) => updateItem(it.uid, { amount: e.target.value })}
                      className="text-right font-mono" placeholder="0.00" />
                  </td>
                  <td className="px-2 py-2 align-middle">
                    <button type="button" onClick={() => removeItem(it.uid)} disabled={items.length <= 1}
                      className="text-slate-400 hover:text-rose-600 disabled:opacity-30 p-1.5 rounded hover:bg-slate-100">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t border-slate-200">
              <tr>
                <td colSpan={2} className="px-4 py-2">
                  <button type="button" onClick={addItem}
                    className="inline-flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-800">
                    <Plus size={14} /> Add another line
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <span className="text-xs text-slate-500 mr-2">Subtotal</span>
                  <span className="font-mono font-semibold">{formatCurrency(totals.subtotal)}</span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Tax (optional)</h3>
          <div className="grid grid-cols-3 gap-2">
            <Field label="CGST">
              <Input type="number" step="0.01" min="0" value={taxCgst}
                onChange={(e) => setTaxCgst(e.target.value)} className="text-right font-mono" />
            </Field>
            <Field label="SGST">
              <Input type="number" step="0.01" min="0" value={taxSgst}
                onChange={(e) => setTaxSgst(e.target.value)} className="text-right font-mono" />
            </Field>
            <Field label="IGST">
              <Input type="number" step="0.01" min="0" value={taxIgst}
                onChange={(e) => setTaxIgst(e.target.value)} className="text-right font-mono" />
            </Field>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Per-cycle Total</h3>
          <div className="space-y-2 text-sm">
            <Row label="Subtotal" value={formatCurrency(totals.subtotal)} />
            {totals.tax > 0 && <Row label="Tax" value={formatCurrency(totals.tax)} />}
            <div className="h-px bg-slate-200 my-2" />
            <Row label="Total" value={formatCurrency(totals.total)} bold />
          </div>
        </Card>
      </div>

      <Card className="p-5 mb-4">
        <Field label="Notes" hint="Will be appended to each generated bill">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white" />
        </Field>
      </Card>

      <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-white border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] flex items-center justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={() => navigate('/bills/recurring')}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? 'font-semibold text-slate-900' : 'text-slate-500'}>{label}</span>
      <span className={'font-mono ' + (bold ? 'font-bold text-lg text-slate-900' : 'text-slate-700')}>{value}</span>
    </div>
  )
}

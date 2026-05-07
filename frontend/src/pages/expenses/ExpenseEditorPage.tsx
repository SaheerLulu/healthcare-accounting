import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Plus, Trash2, Save, Send, Layers } from 'lucide-react'
import { toast } from 'sonner'
import {
  getChartOfAccounts, getSuppliers,
  getExpense, createExpense, updateExpense, recordExpense,
  type Account, type Expense, type Party,
} from '../../lib/api'
import { formatCurrency, cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { AccountPicker } from '../journals/AccountPicker'
import { useHotkeys, useHintRegister, type HotkeyHandler, type HotkeyHint } from '../../contexts/HotkeyContext'
import { voucherConfigs } from '../vouchers/voucherConfig'

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

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function ExpenseEditorPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const editingId = id ? Number(id) : null

  const [accounts, setAccounts] = useState<Account[]>([])
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [loading, setLoading] = useState(!!editingId)

  const [expenseDate, setExpenseDate] = useState(todayStr())
  const [paidThrough, setPaidThrough] = useState<number | null>(null)
  const [vendorId, setVendorId] = useState<number | null>(null)
  const [vendorName, setVendorName] = useState('')
  const [reference, setReference] = useState('')

  // Itemize toggle: when off, single-line entry; when on, multi-line table
  const [itemize, setItemize] = useState(false)
  const [singleAccount, setSingleAccount] = useState<number | null>(null)
  const [singleAmount, setSingleAmount] = useState('')
  const [singleDescription, setSingleDescription] = useState('')
  const [items, setItems] = useState<Item[]>([newItem()])

  const [taxCgst, setTaxCgst] = useState('0')
  const [taxSgst, setTaxSgst] = useState('0')
  const [taxIgst, setTaxIgst] = useState('0')
  const [notes, setNotes] = useState('')

  const [original, setOriginal] = useState<Expense | null>(null)
  const [saving, setSaving] = useState(false)
  const [escConfirmOpen, setEscConfirmOpen] = useState(false)

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
          const e = await getExpense(editingId)
          if (cancelled) return
          if (e.status !== 'draft') {
            toast.error('Only draft expenses can be edited')
            navigate(`/expenses/${editingId}`, { replace: true })
            return
          }
          setOriginal(e)
          setExpenseDate(e.expense_date)
          setPaidThrough(e.paid_through_account)
          setVendorId(e.vendor_id)
          setVendorName(e.vendor_name)
          setReference(e.reference)
          setTaxCgst(e.tax_cgst); setTaxSgst(e.tax_sgst); setTaxIgst(e.tax_igst)
          setNotes(e.notes)

          if (e.items.length > 1) {
            setItemize(true)
            setItems(e.items.map((it): Item => ({
              uid: Math.random().toString(36).slice(2),
              account: it.account, description: it.description, amount: it.amount,
            })))
          } else if (e.items.length === 1) {
            setItemize(false)
            const it = e.items[0]
            setSingleAccount(it.account)
            setSingleAmount(it.amount)
            setSingleDescription(it.description)
          }
        } catch {
          toast.error('Failed to load expense')
        }
      }
      if (!cancelled) setLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [editingId, navigate])

  // Bank/Cash leaf accounts as paid-through options
  const paidThroughOptions = useMemo(
    () => accounts.filter((a) =>
      a.is_active !== false && a.is_leaf &&
      (a.account_subtype === 'Bank' || a.account_subtype === 'Cash')
    ),
    [accounts]
  )
  // Expense-type accounts for line items
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === 'EXPENSE'),
    [accounts]
  )

  const totals = useMemo(() => {
    let subtotal = 0
    if (itemize) {
      for (const it of items) subtotal += parseFloat(it.amount) || 0
    } else {
      subtotal = parseFloat(singleAmount) || 0
    }
    const tax = (parseFloat(taxCgst) || 0) + (parseFloat(taxSgst) || 0) + (parseFloat(taxIgst) || 0)
    return { subtotal, tax, total: subtotal + tax }
  }, [itemize, items, singleAmount, taxCgst, taxSgst, taxIgst])

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
    let outItems: { account: number; description: string; amount: string }[]
    if (itemize) {
      outItems = items
        .filter((i) => i.account && parseFloat(i.amount) > 0)
        .map((i) => ({ account: i.account!, description: i.description, amount: i.amount }))
    } else {
      if (!singleAccount || !(parseFloat(singleAmount) > 0)) {
        outItems = []
      } else {
        outItems = [{
          account: singleAccount,
          description: singleDescription,
          amount: singleAmount,
        }]
      }
    }
    return {
      expense_date: expenseDate,
      paid_through_account: paidThrough!,
      vendor_id: vendorId,
      vendor_name: vendorName,
      reference,
      subtotal: totals.subtotal.toFixed(2),
      tax_cgst: taxCgst || '0',
      tax_sgst: taxSgst || '0',
      tax_igst: taxIgst || '0',
      total_amount: totals.total.toFixed(2),
      notes,
      items: outItems,
    }
  }

  function validate(): string | null {
    if (!expenseDate) return 'Date is required'
    if (!paidThrough) return 'Pick a paid-through account'
    const data = payload()
    if (data.items.length === 0) return itemize
      ? 'Add at least one expense line with an account and amount'
      : 'Pick an expense account and enter an amount'
    if (totals.total <= 0) return 'Total must be > 0'
    return null
  }

  const handleSave = useCallback(async function handleSave(thenRecord = false) {
    const err = validate()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      const exp = editingId
        ? await updateExpense(editingId, payload())
        : await createExpense(payload())
      if (thenRecord) {
        try {
          const recorded = await recordExpense(exp.id)
          toast.success(`Expense recorded · JE ${recorded.journal_entry_no}`)
        } catch (err) {
          const e = err as { response?: { data?: { detail?: string } } }
          toast.error(e.response?.data?.detail || 'Saved as draft, but record failed')
        }
      } else {
        toast.success(editingId ? 'Expense saved' : 'Expense created as draft')
      }
      navigate(`/expenses/${exp.id}`)
    } catch (err) {
      const e = err as { response?: { data?: Record<string, unknown> } }
      const data = e.response?.data
      const msg = data
        ? Object.entries(data).map(([k, v]) =>
            `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(' • ')
        : 'Failed to save'
      toast.error(msg)
    } finally { setSaving(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, expenseDate, paidThrough, vendorId, vendorName, reference, itemize, items, singleAccount, singleAmount, singleDescription, taxCgst, taxSgst, taxIgst, notes, totals.subtotal, totals.total, navigate])

  const handleEsc = useCallback(() => {
    const dirty = vendorName || singleAmount || singleAccount || items.some((it) => it.account || it.amount) || notes
    if (dirty && !editingId) setEscConfirmOpen(true)
    else navigate('/expenses')
  }, [vendorName, singleAmount, singleAccount, items, notes, editingId, navigate])

  // Tally-style hotkeys: Ctrl+A save+record, Esc cancel.
  const handlers = useMemo<HotkeyHandler[]>(() => [
    { chord: 'Ctrl+A', preventDefault: true, handler: () => handleSave(true) },
    { chord: 'Escape', preventDefault: false, handler: handleEsc },
  ], [handleSave, handleEsc])
  useHotkeys(handlers)

  const hints = useMemo<HotkeyHint[]>(() => [
    { chord: 'Ctrl+A', label: 'Save & Record' },
    { chord: 'Esc', label: 'Cancel' },
  ], [])
  useHintRegister(hints)

  if (loading) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline text-teal-600" size={24} /></div>
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-32">
      <button onClick={handleEsc}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3">
        <ArrowLeft size={14} /> Back to Expenses
      </button>

      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <span
            className="mono text-xs font-bold px-2 py-0.5 rounded"
            style={{
              background: 'rgba(15,157,154,0.12)',
              color: 'var(--brand)',
              border: '1px solid rgba(15,157,154,0.25)',
            }}
            title="Expenses are stored as Payment vouchers"
          >
            {voucherConfigs.PAYMENT.fKey}
          </span>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>
            {editingId ? `Edit expense #${editingId}` : 'New Expense (Payment Voucher)'}
          </h1>
        </div>
        {original && <Badge variant="default">Draft</Badge>}
      </div>

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Date" required>
            <Input type="date" required value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </Field>
          <Field label="Paid Through" required hint="Bank, cash, or credit-card account that funded this">
            <select required value={paidThrough ?? ''}
              onChange={(e) => setPaidThrough(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
              <option value="">— Select —</option>
              {paidThroughOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_code} — {a.account_name} ({a.account_subtype})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vendor / Payee" hint="Pick a known supplier or type a payee name">
            <div className="grid grid-cols-2 gap-2">
              <select value={vendorId ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (v) pickVendor(Number(v))
                  else { setVendorId(null) }
                }}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                <option value="">— Free text —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)}
                placeholder="e.g. Tata Power, Local stationery" />
            </div>
          </Field>
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt #, UTR, etc" />
          </Field>
        </div>
      </Card>

      {/* Itemize toggle */}
      <div className="flex items-center gap-3 mb-3">
        <button
          type="button"
          onClick={() => setItemize((x) => !x)}
          className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
            itemize
              ? 'bg-teal-50 border-teal-200 text-teal-700'
              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
          )}
        >
          <Layers size={13} /> {itemize ? 'Itemized' : 'Single line'}
        </button>
        <span className="text-xs text-slate-400">
          {itemize
            ? 'Split this expense across multiple categories'
            : 'Toggle to split this payment across multiple expense accounts'}
        </span>
      </div>

      {!itemize ? (
        <Card className="p-5 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Expense Account" required>
              <AccountPicker accounts={expenseAccounts} value={singleAccount}
                onChange={(id) => setSingleAccount(id)} />
            </Field>
            <Field label="Amount" required>
              <Input type="number" step="0.01" min="0" required value={singleAmount}
                onChange={(e) => setSingleAmount(e.target.value)}
                className="text-right font-mono" placeholder="0.00" />
            </Field>
            <Field label="Description (optional)" hint="What this spend was for">
              <Input value={singleDescription} onChange={(e) => setSingleDescription(e.target.value)} />
            </Field>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 mb-4">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Line Items</h2>
            <span className="text-xs text-slate-400">Each line debits its expense account</span>
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
                        placeholder="e.g. Pens & notebooks" />
                    </td>
                    <td className="px-4 py-2">
                      <Input type="number" step="0.01" min="0" value={it.amount}
                        onChange={(e) => updateItem(it.uid, { amount: e.target.value })}
                        className="text-right font-mono" placeholder="0.00" />
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <button type="button" onClick={() => removeItem(it.uid)}
                        disabled={items.length <= 1}
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
      )}

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
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Summary</h3>
          <div className="space-y-2 text-sm">
            <Row label="Subtotal" value={formatCurrency(totals.subtotal)} />
            {totals.tax > 0 && <Row label="Tax" value={formatCurrency(totals.tax)} />}
            <div className="h-px bg-slate-200 my-2" />
            <Row label="Total" value={formatCurrency(totals.total)} bold />
          </div>
        </Card>
      </div>

      <Card className="p-5 mb-4">
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white" />
        </Field>
      </Card>

      <div
        className="fixed left-0 right-0 z-20 px-6 py-3 flex items-center justify-end gap-2"
        style={{
          bottom: 36,
          background: 'var(--surface-0)',
          borderTop: '1px solid var(--line)',
          boxShadow: '0 -4px 12px rgba(0,0,0,0.04)',
        }}
      >
        <Button variant="secondary" onClick={handleEsc}>
          Cancel <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Esc</kbd>
        </Button>
        <Button variant="secondary" onClick={() => handleSave(false)} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          Save Draft
        </Button>
        <Button onClick={() => handleSave(true)} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
          Save & Record
          <kbd className="hidden md:inline mono text-[10px] ml-1 text-white/80">Ctrl+A</kbd>
        </Button>
      </div>

      <ConfirmDialog
        open={escConfirmOpen}
        onOpenChange={setEscConfirmOpen}
        title="Discard this expense?"
        description="Any unsaved changes will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          setEscConfirmOpen(false)
          navigate('/expenses')
        }}
      />
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

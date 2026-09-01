import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Plus, Trash2, Save, Send, Globe } from 'lucide-react'
import { toast } from 'sonner'
import {
  getChartOfAccounts, getSuppliers,
  getBill, createBill, updateBill, approveBill,
  type Account, type Bill, type Party,
} from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { AccountPicker } from '../journals/AccountPicker'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useGridKeyboardNav } from '../../hooks/useGridKeyboardNav'
import { useLocation as useActiveLocation } from '../../contexts/LocationContext'
import { voucherConfigs } from '../vouchers/voucherConfig'

interface Line {
  uid: string
  account: number | null
  description: string
  amount: string
}

const newLine = (): Line => ({
  uid: Math.random().toString(36).slice(2),
  account: null, description: '', amount: '',
})

/** Cell ids for the line grid — see hooks/useGridKeyboardNav. */
const COLUMN_IDS = ['account', 'description', 'amount']
const cellId = (row: number, col: string) => `bill-line-${row}-${col}`

const todayStr = () => new Date().toISOString().slice(0, 10)
const plusDays = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function BillEditorPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const editingId = id ? Number(id) : null
  const { activeLocationId } = useActiveLocation()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [loading, setLoading] = useState(!!editingId)

  const [vendorId, setVendorId] = useState<number | null>(null)
  const [vendorName, setVendorName] = useState('')
  const [billNo, setBillNo] = useState('')
  const [billDate, setBillDate] = useState(todayStr())
  const [dueDate, setDueDate] = useState(plusDays(30))
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [taxCgst, setTaxCgst] = useState('0')
  const [taxSgst, setTaxSgst] = useState('0')
  const [taxIgst, setTaxIgst] = useState('0')
  const [notes, setNotes] = useState('')
  const [original, setOriginal] = useState<Bill | null>(null)
  const [saving, setSaving] = useState(false)
  const [escConfirmOpen, setEscConfirmOpen] = useState(false)
  // Which line the keyboard is on, so Alt+D deletes the line being edited
  // rather than guessing from the DOM.
  const [focusedRow, setFocusedRow] = useState(0)

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
          const bill = await getBill(editingId)
          if (cancelled) return
          if (bill.status !== 'draft') {
            toast.error('Only draft bills can be edited')
            navigate(`/bills/${editingId}`, { replace: true })
            return
          }
          setOriginal(bill)
          setVendorId(bill.vendor_id)
          setVendorName(bill.vendor_name)
          setBillNo(bill.bill_no)
          setBillDate(bill.bill_date)
          setDueDate(bill.due_date || '')
          setTaxCgst(bill.tax_cgst)
          setTaxSgst(bill.tax_sgst)
          setTaxIgst(bill.tax_igst)
          setNotes(bill.notes)
          setLines(bill.lines.length ? bill.lines.map((l): Line => ({
            uid: Math.random().toString(36).slice(2),
            account: l.account, description: l.description, amount: l.amount,
          })) : [newLine()])
        } catch {
          toast.error('Failed to load bill')
        }
      }
      if (!cancelled) setLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [editingId, navigate])

  // Only expense-type accounts make sense for bill lines
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === 'EXPENSE'),
    [accounts]
  )

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
    const cgst = parseFloat(taxCgst) || 0
    const sgst = parseFloat(taxSgst) || 0
    const igst = parseFloat(taxIgst) || 0
    return { subtotal, tax: cgst + sgst + igst, total: subtotal + cgst + sgst + igst }
  }, [lines, taxCgst, taxSgst, taxIgst])

  function updateLine(uid: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => l.uid === uid ? { ...l, ...patch } : l))
  }
  function addLine() { setLines((ls) => [...ls, newLine()]) }
  function removeLine(uid: string) {
    setLines((ls) => ls.length <= 1 ? ls : ls.filter((l) => l.uid !== uid))
  }

  function pickVendor(id: number) {
    setVendorId(id)
    const s = suppliers.find((x) => x.id === id)
    if (s) setVendorName(s.name)
  }

  function payload() {
    const cleanLines = lines
      .filter((l) => l.account && parseFloat(l.amount) > 0)
      .map((l) => ({ account: l.account!, description: l.description, amount: l.amount || '0' }))
    return {
      bill_no: billNo,
      bill_date: billDate,
      due_date: dueDate || null,
      vendor_id: vendorId,
      vendor_name: vendorName,
      subtotal: totals.subtotal.toFixed(2),
      tax_cgst: taxCgst || '0',
      tax_sgst: taxSgst || '0',
      tax_igst: taxIgst || '0',
      total_amount: totals.total.toFixed(2),
      notes,
      location_id: activeLocationId,
      lines: cleanLines,
    }
  }

  function validate(): string | null {
    if (activeLocationId === null) return 'Switch to a specific store from the top-nav selector to record this bill'
    if (!vendorName.trim()) return 'Vendor name is required'
    if (!billDate) return 'Bill date is required'
    const data = payload()
    if (data.lines.length === 0) return 'Add at least one expense line with an account and amount'
    if (totals.total <= 0) return 'Total amount must be greater than zero'
    return null
  }

  const allStores = activeLocationId === null

  const handleSave = useCallback(async function handleSave(thenApprove = false) {
    const err = validate()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      const bill = editingId
        ? await updateBill(editingId, payload())
        : await createBill(payload())
      if (thenApprove) {
        try {
          const approved = await approveBill(bill.id)
          toast.success(`Bill ${approved.bill_no || `#${approved.id}`} approved`)
        } catch (err) {
          const e = err as { response?: { data?: { detail?: string } } }
          toast.error(e.response?.data?.detail || 'Saved as draft, but approve failed')
        }
      } else {
        toast.success(editingId ? 'Bill saved' : 'Bill created as draft')
      }
      navigate(`/bills/${bill.id}`)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, vendorId, vendorName, billNo, billDate, dueDate, lines, taxCgst, taxSgst, taxIgst, notes, totals.subtotal, totals.total, navigate])

  const handleEsc = useCallback(() => {
    const dirty = vendorName || vendorId || billNo || lines.some((l) => l.account || l.amount) || notes
    if (dirty && !editingId) setEscConfirmOpen(true)
    else navigate('/bills')
  }, [vendorName, vendorId, billNo, lines, notes, editingId, navigate])

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // Enter and ↑/↓ walk down a column; Tab off the very last cell appends a
  // line, so a clerk keys line after line without reaching for "Add another
  // line".
  const grid = useGridKeyboardNav({
    rowCount: lines.length,
    columnIds: COLUMN_IDS,
    buildCellId: cellId,
    onAppendRow: addLine,
    onEnterAppendRow: addLine,
  })

  /**
   * Tab keeps the row's natural DOM order — ledger picker → description →
   * amount → remove — and only the very last cell overrides it, where the grid
   * appends a line and moves into its picker.
   *
   * Overriding Tab on every cell (which is what this screen used to do) walked
   * description → amount → next row's description, so the AccountPicker of every
   * line after the first, and every row's Remove button, dropped out of the tab
   * order entirely. A line with no account is silently discarded by payload()
   * while its amount still counts towards the total, so that was a bill saved
   * with a header total its lines do not add up to.
   */
  function lineKeyDown(e: React.KeyboardEvent, rowIdx: number, colId: string) {
    const lastCell = colId === 'amount' && rowIdx === lines.length - 1
    if (e.key === 'Tab' && (e.shiftKey || !lastCell)) return
    grid.handleKeyDown(e, rowIdx, colId)
  }

  function deleteFocusedLine() {
    const line = lines[Math.min(focusedRow, lines.length - 1)]
    if (line) removeLine(line.uid)
  }

  // Ctrl+A stays "Save & Approve" — it is the app-wide voucher chord (see
  // VoucherEditor) and Tally muscle memory. Ctrl+S is the draft save.
  // Escape goes through useEscapeBack, so it leaves the focused field first
  // and stands down entirely while the discard dialog owns the key.
  usePageKeyboard({
    actions: [
      { chord: 'Ctrl+A', label: 'Save & Approve', run: () => handleSave(true), when: !saving && !allStores },
      { chord: 'Ctrl+S', label: 'Save draft', run: () => handleSave(false), when: !saving && !allStores },
      { chord: 'Alt+A', label: 'Add line', run: addLine },
      { chord: 'Alt+D', label: 'Delete line', run: deleteFocusedLine, when: lines.length > 1 },
    ],
    onBack: handleEsc,
  })

  if (loading) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline text-teal-600" size={24} /></div>
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-32">
      <button onClick={handleEsc}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3">
        <ArrowLeft size={14} /> Back to Bills
      </button>

      {allStores && (
        <div
          className="px-4 py-2.5 rounded-lg flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm"
          style={{
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.30)',
            color: 'var(--ink)',
          }}
        >
          <Globe size={14} style={{ color: 'rgb(180,110,0)' }} />
          <span className="font-medium">All Stores is read-only.</span>
          <span style={{ color: 'var(--ink-2)' }}>
            Switch to a specific store from the selector at the top to record this bill.
          </span>
        </div>
      )}

      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
          <span
            className="mono text-xs font-bold px-2 py-0.5 rounded"
            style={{
              background: 'rgba(15,157,154,0.12)',
              color: 'var(--brand)',
              border: '1px solid rgba(15,157,154,0.25)',
            }}
            title="Bills are stored as Purchase vouchers"
          >
            {voucherConfigs.PURCHASE.fKey}
          </span>
          <h1 className="text-lg sm:text-xl font-semibold min-w-0" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>
            {editingId ? `Edit ${original?.bill_no || `Bill #${editingId}`}` : 'New Bill (Purchase Voucher)'}
          </h1>
        </div>
        {original && <Badge variant="default">Draft</Badge>}
      </div>

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Vendor" required hint="Pick a known supplier or enter a new vendor name">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                data-autofocus
                value={vendorId ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (v) pickVendor(Number(v))
                  else { setVendorId(null) }
                }}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">— New vendor —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Input
                required
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="Vendor name"
              />
            </div>
          </Field>
          <Field label="Bill Number">
            <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="e.g. INV-2026-0042" />
          </Field>
          <Field label="Bill Date" required>
            <Input type="date" required value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </Field>
          <Field label="Due Date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
      </Card>

      {/* Line items */}
      <Card className="overflow-hidden p-0 mb-4">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-slate-900">Expense Lines</h2>
          <span className="text-xs text-slate-400">Each line debits an expense account; the total credits Trade Payables</span>
        </div>
        <div className="table-scroll">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide" style={{ width: '34%' }}>Expense Account</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Description</th>
                <th className="text-right text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide" style={{ width: '18%' }}>Amount</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={line.uid} className="border-b border-slate-100 last:border-0"
                  onFocus={() => setFocusedRow(i)}>
                  <td className="px-4 py-2 align-top">
                    <AccountPicker
                      accounts={expenseAccounts}
                      value={line.account}
                      triggerId={cellId(i, 'account')}
                      ariaLabel={`Line ${i + 1} expense account`}
                      onChange={(id) => updateLine(line.uid, { account: id })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input id={cellId(i, 'description')} value={line.description}
                      onChange={(e) => updateLine(line.uid, { description: e.target.value })}
                      onKeyDown={(e) => lineKeyDown(e, i, 'description')}
                      placeholder="e.g. April electricity bill" />
                  </td>
                  <td className="px-4 py-2">
                    <Input id={cellId(i, 'amount')} type="number" step="0.01" min="0" value={line.amount}
                      onChange={(e) => updateLine(line.uid, { amount: e.target.value })}
                      onKeyDown={(e) => lineKeyDown(e, i, 'amount')}
                      placeholder="0.00"
                      className="text-right font-mono" />
                  </td>
                  <td className="px-2 py-2 align-middle">
                    <button type="button" onClick={() => removeLine(line.uid)}
                      disabled={lines.length <= 1}
                      className="text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:cursor-not-allowed p-1.5 rounded hover:bg-slate-100"
                      aria-label={`Remove line ${i + 1}`}
                      title="Remove line (Alt+D)">
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
                    <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Alt+A</kbd>
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <span className="text-xs text-slate-500 mr-2">Subtotal</span>
                  <span className="font-mono font-semibold text-slate-900">{formatCurrency(totals.subtotal)}</span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Tax + total panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Tax (optional)</h3>
          <div className="grid grid-cols-3 gap-2">
            <Field label="CGST">
              <Input type="number" step="0.01" min="0" value={taxCgst}
                onChange={(e) => setTaxCgst(e.target.value)}
                className="text-right font-mono" />
            </Field>
            <Field label="SGST">
              <Input type="number" step="0.01" min="0" value={taxSgst}
                onChange={(e) => setTaxSgst(e.target.value)}
                className="text-right font-mono" />
            </Field>
            <Field label="IGST">
              <Input type="number" step="0.01" min="0" value={taxIgst}
                onChange={(e) => setTaxIgst(e.target.value)}
                className="text-right font-mono" />
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
        <Field label="Notes" hint="Internal description, GL refs, or links to physical bill">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </Field>
      </Card>

      {/* Sticky save bar — sits on the F-key bar at md+, on the viewport edge
          below it, where HotkeyBar is hidden. */}
      <div
        className="fixed left-0 right-0 z-20 bottom-0 md:bottom-9 px-3 sm:px-6 py-3 flex flex-wrap items-center justify-end gap-2 safe-bottom"
        style={{
          background: 'var(--surface-0)',
          borderTop: '1px solid var(--line)',
          boxShadow: '0 -4px 12px rgba(0,0,0,0.04)',
        }}
      >
        <Button variant="secondary" onClick={handleEsc}>
          Cancel <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Esc</kbd>
        </Button>
        <Button variant="secondary" onClick={() => handleSave(false)} disabled={saving || allStores}>
          {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          Save Draft
          <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Ctrl+S</kbd>
        </Button>
        <Button onClick={() => handleSave(true)} disabled={saving || allStores}>
          {saving ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
          Save & Approve
          <kbd className="hidden md:inline mono text-[10px] ml-1 text-white/80">Ctrl+A</kbd>
        </Button>
      </div>

      <ConfirmDialog
        open={escConfirmOpen}
        onOpenChange={setEscConfirmOpen}
        title="Discard this bill?"
        description="Any unsaved changes will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          setEscConfirmOpen(false)
          navigate('/bills')
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

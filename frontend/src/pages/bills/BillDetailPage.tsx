import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Pencil, Send, Trash2, Wallet, X, FileText,
  AlertCircle, UploadCloud, Paperclip, Download, Image as ImageIcon, File as FileIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getBill, approveBill, cancelBill, deleteBill,
  recordBillPayment, deleteBillPayment,
  uploadBillAttachment, deleteBillAttachment,
  type Bill, type BillAttachment,
} from '../../lib/api'
import { formatCurrency, formatDate, cn } from '../../lib/utils'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose, SheetTrigger,
} from '../../components/ui/sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../../components/ui/dialog'

const STATUS_BADGE = {
  draft: 'default',
  open: 'warning',
  partially_paid: 'info',
  paid: 'success',
  cancelled: 'error',
} as const

const STATUS_LABEL = {
  draft: 'Draft',
  open: 'Open',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
} as const

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const billId = Number(id)
  const [bill, setBill] = useState<Bill | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const b = await getBill(billId)
      setBill(b)
    } catch {
      toast.error('Failed to load bill')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [billId])

  async function handleApprove() {
    if (!bill) return
    setBusy(true)
    try {
      const updated = await approveBill(bill.id)
      setBill(updated)
      toast.success('Bill approved and posted')
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to approve')
    } finally { setBusy(false) }
  }

  async function handleCancel() {
    if (!bill) return
    setBusy(true)
    try {
      const updated = await cancelBill(bill.id)
      setBill(updated)
      toast.success('Bill cancelled')
      setConfirmCancel(false)
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to cancel')
    } finally { setBusy(false) }
  }

  async function handleDelete() {
    if (!bill) return
    setBusy(true)
    try {
      await deleteBill(bill.id)
      toast.success('Bill deleted')
      navigate('/bills')
    } catch {
      toast.error('Failed to delete')
      setBusy(false)
    }
  }

  async function handleDeletePayment(paymentId: number) {
    if (!confirm('Void this payment? It will reverse the journal entry.')) return
    try {
      await deleteBillPayment(paymentId)
      toast.success('Payment voided')
      load()
    } catch {
      toast.error('Failed to void payment')
    }
  }

  if (loading || !bill) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline text-teal-600" size={24} /></div>
  }

  const today = new Date().toISOString().slice(0, 10)
  const overdue = bill.due_date && bill.due_date < today &&
    (bill.status === 'open' || bill.status === 'partially_paid')
  const balanceDue = parseFloat(bill.balance_due)

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <button onClick={() => navigate('/bills')}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3">
        <ArrowLeft size={14} /> Back to Bills
      </button>

      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <FileText size={18} className="text-slate-400 flex-shrink-0" />
            <h1 className="text-lg sm:text-xl font-semibold min-w-0 break-all" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>
              {bill.bill_no || `BILL-${bill.id}`}
            </h1>
            <Badge variant={STATUS_BADGE[bill.status]}>{STATUS_LABEL[bill.status]}</Badge>
            {overdue && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-medium">
                <AlertCircle size={12} /> Overdue
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500">
            {bill.vendor_name}
            {bill.vendor_id && (
              <Link to={`/parties/suppliers/${bill.vendor_id}`} className="ml-1 text-teal-700 hover:underline">
                ({`supplier #${bill.vendor_id}`})
              </Link>
            )}
            {' · '}
            Bill {formatDate(bill.bill_date)}
            {bill.due_date && <> · Due {formatDate(bill.due_date)}</>}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {bill.status === 'draft' && (
            <>
              <Button variant="secondary" size="sm" onClick={() => navigate(`/bills/${bill.id}/edit`)}>
                <Pencil size={14} /> Edit
              </Button>
              <Button size="sm" onClick={handleApprove} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} Approve
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete
              </Button>
            </>
          )}
          {(bill.status === 'open' || bill.status === 'partially_paid') && (
            <RecordPaymentSheet bill={bill} onRecorded={load} />
          )}
          {bill.status !== 'cancelled' && bill.status !== 'paid' && bill.status !== 'draft' && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmCancel(true)}>
              <X size={14} /> Cancel Bill
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card className="p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Total</div>
          <div className="text-2xl font-semibold text-slate-900 mt-1 font-mono">{formatCurrency(bill.total_amount)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Paid</div>
          <div className="text-2xl font-semibold text-emerald-700 mt-1 font-mono">{formatCurrency(bill.amount_paid)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Balance Due</div>
          <div className={cn('text-2xl font-semibold mt-1 font-mono', balanceDue > 0 ? 'text-amber-700' : 'text-slate-900')}>
            {formatCurrency(bill.balance_due)}
          </div>
        </Card>
      </div>

      {/* Lines */}
      <Card className="overflow-hidden p-0 mb-4">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-slate-900">Line Items</h2>
          {bill.journal_entry_no && (
            <Link to={`/journals/${bill.journal_entry}`} className="text-xs text-teal-700 hover:underline font-mono break-all">
              JE: {bill.journal_entry_no}
            </Link>
          )}
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
              {bill.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-900">{l.account_name}</div>
                    <div className="text-xs text-slate-400 font-mono">{l.account_code}</div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 text-sm">{l.description || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200">
                <td colSpan={2} className="px-4 py-2 text-right text-xs text-slate-500">Subtotal</td>
                <td className="px-4 py-2 text-right font-mono">{formatCurrency(bill.subtotal)}</td>
              </tr>
              {parseFloat(bill.tax_cgst) > 0 && (
                <tr><td colSpan={2} className="px-4 py-1.5 text-right text-xs text-slate-500">CGST</td>
                    <td className="px-4 py-1.5 text-right font-mono">{formatCurrency(bill.tax_cgst)}</td></tr>
              )}
              {parseFloat(bill.tax_sgst) > 0 && (
                <tr><td colSpan={2} className="px-4 py-1.5 text-right text-xs text-slate-500">SGST</td>
                    <td className="px-4 py-1.5 text-right font-mono">{formatCurrency(bill.tax_sgst)}</td></tr>
              )}
              {parseFloat(bill.tax_igst) > 0 && (
                <tr><td colSpan={2} className="px-4 py-1.5 text-right text-xs text-slate-500">IGST</td>
                    <td className="px-4 py-1.5 text-right font-mono">{formatCurrency(bill.tax_igst)}</td></tr>
              )}
              <tr className="bg-slate-50 border-t border-slate-200">
                <td colSpan={2} className="px-4 py-2.5 text-right font-semibold text-slate-900">Total</td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">{formatCurrency(bill.total_amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Payments */}
      <Card className="overflow-hidden p-0 mb-4">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-slate-900">Payments</h2>
          <span className="text-xs text-slate-400">{bill.payments.length} payment{bill.payments.length === 1 ? '' : 's'}</span>
        </div>
        {bill.payments.length === 0 ? (
          <div className="text-center py-6 text-sm text-slate-400">No payments recorded yet</div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Date</th>
                  <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Mode</th>
                  <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Reference</th>
                  <th className="text-right text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Amount</th>
                  <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">JE</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {bill.payments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5 text-sm text-slate-600 whitespace-nowrap">{formatDate(p.date)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={p.mode === 'bank' ? 'info' : 'warning'}>{p.mode === 'bank' ? 'Bank' : 'Cash'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-slate-500">{p.reference || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-medium text-emerald-700 whitespace-nowrap">{formatCurrency(p.amount)}</td>
                    <td className="px-4 py-2.5">
                      {p.journal_entry_no ? (
                        <Link to={`/journals/${p.journal_entry}`} className="text-xs text-teal-700 hover:underline font-mono whitespace-nowrap">{p.journal_entry_no}</Link>
                      ) : '—'}
                    </td>
                    <td className="px-2 py-2.5">
                      <button onClick={() => handleDeletePayment(p.id)}
                        className="p-2.5 sm:p-1.5 text-slate-300 hover:text-rose-600 rounded hover:bg-slate-100"
                        title="Void payment">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AttachmentsCard bill={bill} onChange={load} />

      {bill.notes && (
        <Card className="p-4 mb-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Notes</div>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">{bill.notes}</p>
        </Card>
      )}

      {/* Cancel dialog */}
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel this bill?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            Cancelling reverses the bill journal entry. Any recorded payments must be voided first.
          </p>
          <div className="flex flex-wrap gap-2 justify-end pt-4">
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>Keep open</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={busy}>
              {busy && <Loader2 className="animate-spin" size={14} />} Cancel Bill
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this draft bill?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">This cannot be undone. Drafts have no journal entry to reverse.</p>
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

function RecordPaymentSheet({ bill, onRecorded }: { bill: Bill; onRecorded: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState(bill.balance_due)
  const [mode, setMode] = useState<'bank' | 'cash'>('bank')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await recordBillPayment(bill.id, { date, amount, mode, reference, notes })
      toast.success('Payment recorded')
      setOpen(false)
      onRecorded()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to record payment')
    } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => {
      setOpen(o)
      if (o) {
        setAmount(bill.balance_due)
        setReference('')
        setNotes('')
        setMode('bank')
        setDate(new Date().toISOString().slice(0, 10))
      }
    }}>
      <SheetTrigger asChild>
        <Button size="sm"><Wallet size={14} /> Record Payment</Button>
      </SheetTrigger>
      <SheetContent width="md">
        <form onSubmit={submit} className="flex flex-col h-full">
          <SheetHeader>
            <SheetTitle>Record Payment</SheetTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Outstanding balance: <span className="font-mono font-medium">{formatCurrency(bill.balance_due)}</span>
            </p>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date" required>
                  <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Amount" required>
                  <Input type="number" step="0.01" min="0.01" max={bill.balance_due} required value={amount}
                    onChange={(e) => setAmount(e.target.value)} className="text-right font-mono" />
                </Field>
              </div>
              <Field label="Paid from">
                <div className="flex gap-2">
                  {(['bank', 'cash'] as const).map((m) => (
                    <label key={m} className={cn(
                      'flex-1 flex items-center justify-center px-3 py-2 rounded-lg border cursor-pointer text-sm capitalize',
                      mode === m ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-600'
                    )}>
                      <input type="radio" checked={mode === m} onChange={() => setMode(m)} className="hidden" />
                      {m}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Reference" hint="Cheque #, UTR, transaction ID">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Notes">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </Field>
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" size={14} />} Save Payment
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
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

// ─── Attachments ────────────────────────────────────────────────────────────

const ALLOWED_TYPES = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]
const MAX_BYTES = 10 * 1024 * 1024

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function isImage(a: BillAttachment) {
  return a.content_type?.startsWith('image/')
}

function AttachmentsCard({ bill, onChange }: { bill: Bill; onChange: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const attachments = bill.attachments || []

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (list.length === 0) return
    setUploading(true)
    let okCount = 0
    for (const f of list) {
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name}: file too large (max 10 MB)`)
        continue
      }
      if (f.type && !ALLOWED_TYPES.includes(f.type)) {
        toast.error(`${f.name}: unsupported type (${f.type})`)
        continue
      }
      try {
        await uploadBillAttachment(bill.id, f)
        okCount++
      } catch (err) {
        const e = err as { response?: { data?: { detail?: string } } }
        toast.error(`${f.name}: ${e.response?.data?.detail || 'upload failed'}`)
      }
    }
    if (okCount > 0) toast.success(`${okCount} file${okCount === 1 ? '' : 's'} uploaded`)
    setUploading(false)
    onChange()
  }

  async function handleDelete(a: BillAttachment) {
    if (!confirm(`Remove "${a.original_name}"?`)) return
    try {
      await deleteBillAttachment(a.id)
      toast.success('Attachment removed')
      onChange()
    } catch {
      toast.error('Failed to remove')
    }
  }

  return (
    <Card className="overflow-hidden p-0 mb-4">
      <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Paperclip size={14} className="text-slate-400" />
          Attachments
          <span className="text-xs font-normal text-slate-400">({attachments.length})</span>
        </h2>
        <span className="text-xs text-slate-400">PDF, images, docs · max 10 MB each</span>
      </div>

      <div className="p-4">
        {/* Drop zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
          }}
          className={cn(
            'border-2 border-dashed rounded-lg py-6 px-4 flex flex-col items-center justify-center text-center cursor-pointer transition-colors',
            isDragging
              ? 'border-teal-400 bg-teal-50'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
          )}
        >
          {uploading ? (
            <>
              <Loader2 size={20} className="animate-spin text-teal-600 mb-1.5" />
              <p className="text-sm text-slate-600">Uploading…</p>
            </>
          ) : (
            <>
              <UploadCloud size={20} className="text-slate-400 mb-1.5" />
              <p className="text-sm text-slate-600">
                <span className="text-teal-700 font-medium">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Bill PDFs, scanned copies, supporting docs</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ALLOWED_TYPES.join(',')}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {/* Existing attachments */}
        {attachments.length > 0 && (
          <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 p-2.5 border border-slate-200 rounded-lg hover:border-slate-300 group"
              >
                {isImage(a) ? (
                  <a href={a.file_url} target="_blank" rel="noreferrer"
                     className="w-10 h-10 rounded bg-slate-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    <img src={a.file_url} alt={a.original_name} className="w-full h-full object-cover" />
                  </a>
                ) : (
                  <a href={a.file_url} target="_blank" rel="noreferrer"
                     className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-400">
                    {a.content_type?.includes('pdf')
                      ? <FileText size={18} className="text-rose-500" />
                      : a.content_type?.startsWith('image/')
                        ? <ImageIcon size={18} />
                        : <FileIcon size={18} />}
                  </a>
                )}
                <div className="flex-1 min-w-0">
                  <a href={a.file_url} target="_blank" rel="noreferrer"
                     className="block text-sm font-medium text-slate-900 hover:text-teal-700 truncate">
                    {a.original_name}
                  </a>
                  <div className="text-xs text-slate-400">
                    {fmtSize(a.size)} · {formatDate(a.uploaded_at)}
                    {a.uploaded_by_name && ` · ${a.uploaded_by_name}`}
                  </div>
                </div>
                {/* Touch devices never fire :hover, so the row actions have to
                    be visible outright below the desktop breakpoint. */}
                <a
                  href={a.file_url}
                  download={a.original_name}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2.5 sm:p-1.5 flex-shrink-0 text-slate-400 hover:text-teal-600 rounded hover:bg-slate-100 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                  title="Download"
                >
                  <Download size={14} />
                </a>
                <button
                  onClick={() => handleDelete(a)}
                  className="p-2.5 sm:p-1.5 flex-shrink-0 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

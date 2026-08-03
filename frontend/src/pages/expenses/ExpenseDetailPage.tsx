import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Pencil, Send, Trash2, Undo2, FileText,
  UploadCloud, Paperclip, Download, Image as ImageIcon, File as FileIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getExpense, recordExpense, reverseExpense, deleteExpense,
  uploadExpenseAttachment, deleteExpenseAttachment,
  type Expense, type ExpenseAttachmentRow,
} from '../../lib/api'
import { formatCurrency, formatDate, cn } from '../../lib/utils'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../../components/ui/dialog'

const ALLOWED_TYPES = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/gif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]
const MAX_BYTES = 10 * 1024 * 1024

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const expenseId = Number(id)
  const [expense, setExpense] = useState<Expense | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const e = await getExpense(expenseId)
      setExpense(e)
    } catch {
      toast.error('Failed to load expense')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [expenseId])

  async function handleRecord() {
    if (!expense) return
    setBusy(true)
    try {
      const updated = await recordExpense(expense.id)
      setExpense(updated)
      toast.success('Expense recorded · ' + (updated.journal_entry_no || ''))
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to record')
    } finally { setBusy(false) }
  }

  async function handleReverse() {
    if (!expense) return
    if (!confirm('Reverse this expense? It will create a reversal JE and reset to draft.')) return
    setBusy(true)
    try {
      const updated = await reverseExpense(expense.id)
      setExpense(updated)
      toast.success('Expense reversed')
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to reverse')
    } finally { setBusy(false) }
  }

  async function handleDelete() {
    if (!expense) return
    setBusy(true)
    try {
      await deleteExpense(expense.id)
      toast.success('Expense deleted')
      navigate('/expenses')
    } catch {
      toast.error('Failed to delete')
      setBusy(false)
    }
  }

  if (loading || !expense) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline text-teal-600" size={24} /></div>
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <button onClick={() => navigate('/expenses')}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 mb-3">
        <ArrowLeft size={14} /> Back to Expenses
      </button>

      <div className="flex flex-col gap-3 mb-5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <FileText size={18} className="text-slate-400 flex-shrink-0" />
            <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>
              {expense.vendor_name || `Expense #${expense.id}`}
            </h1>
            <Badge variant={expense.status === 'recorded' ? 'success' : 'default'}>
              {expense.status === 'recorded' ? 'Recorded' : 'Draft'}
            </Badge>
            {expense.is_itemized && <Badge variant="info">Itemized</Badge>}
          </div>
          <p className="text-sm text-slate-500">
            {formatDate(expense.expense_date)} · Paid via{' '}
            <span className="font-mono">{expense.paid_through_code}</span> {expense.paid_through_name}
            {expense.reference && <> · Ref {expense.reference}</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {expense.status === 'draft' && (
            <>
              <Button variant="secondary" size="sm" onClick={() => navigate(`/expenses/${expense.id}/edit`)}>
                <Pencil size={14} /> Edit
              </Button>
              <Button size="sm" onClick={handleRecord} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} Record
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete
              </Button>
            </>
          )}
          {expense.status === 'recorded' && (
            <Button variant="secondary" size="sm" onClick={handleReverse} disabled={busy}>
              <Undo2 size={14} /> Reverse
            </Button>
          )}
        </div>
      </div>

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Subtotal</div>
            <div className="text-lg font-semibold text-slate-900 mt-1 font-mono">{formatCurrency(expense.subtotal)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Tax</div>
            <div className="text-lg font-semibold text-slate-700 mt-1 font-mono">
              {formatCurrency(parseFloat(expense.tax_cgst) + parseFloat(expense.tax_sgst) + parseFloat(expense.tax_igst))}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Total</div>
            <div className="text-lg font-semibold text-slate-900 mt-1 font-mono">{formatCurrency(expense.total_amount)}</div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden p-0 mb-4">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-slate-900">Line Items</h2>
          {expense.journal_entry_no && (
            <Link to={`/journals/${expense.journal_entry}`}
                  className="text-xs text-teal-700 hover:underline font-mono">
              JE: {expense.journal_entry_no}
            </Link>
          )}
        </div>
        <div className="table-scroll">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Account</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Description</th>
                <th className="text-right text-xs font-semibold text-slate-500 px-4 py-2 uppercase tracking-wide">Amount</th>
              </tr>
            </thead>
            <tbody>
              {expense.items.map((it) => (
                <tr key={it.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-900">{it.account_name}</div>
                    <div className="text-xs text-slate-400 font-mono">{it.account_code}</div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 text-sm">{it.description || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(it.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-200">
                <td colSpan={2} className="px-4 py-2.5 text-right font-semibold text-slate-900">Total</td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">{formatCurrency(expense.total_amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <AttachmentsCard expense={expense} onChange={load} />

      {expense.notes && (
        <Card className="p-4 mb-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Notes</div>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">{expense.notes}</p>
        </Card>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this draft expense?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">This cannot be undone. Drafts have no JE to reverse.</p>
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

function AttachmentsCard({ expense, onChange }: { expense: Expense; onChange: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const attachments = expense.attachments || []

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (list.length === 0) return
    setUploading(true)
    let okCount = 0
    for (const f of list) {
      if (f.size > MAX_BYTES) { toast.error(`${f.name}: too large`); continue }
      if (f.type && !ALLOWED_TYPES.includes(f.type)) { toast.error(`${f.name}: unsupported type`); continue }
      try { await uploadExpenseAttachment(expense.id, f); okCount++ }
      catch (err) {
        const e = err as { response?: { data?: { detail?: string } } }
        toast.error(`${f.name}: ${e.response?.data?.detail || 'upload failed'}`)
      }
    }
    if (okCount > 0) toast.success(`${okCount} file${okCount === 1 ? '' : 's'} uploaded`)
    setUploading(false)
    onChange()
  }

  async function handleDelete(a: ExpenseAttachmentRow) {
    if (!confirm(`Remove "${a.original_name}"?`)) return
    try { await deleteExpenseAttachment(a.id); toast.success('Removed'); onChange() }
    catch { toast.error('Failed to remove') }
  }

  return (
    <Card className="overflow-hidden p-0 mb-4">
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Paperclip size={14} className="text-slate-400" />
          Receipts & Attachments
          <span className="text-xs font-normal text-slate-400">({attachments.length})</span>
        </h2>
        <span className="text-xs text-slate-400">PDF, images, docs · max 10 MB each</span>
      </div>
      <div className="p-4">
        <div onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files) }}
          className={cn(
            'border-2 border-dashed rounded-lg py-6 px-4 flex flex-col items-center justify-center text-center cursor-pointer transition-colors',
            isDragging ? 'border-teal-400 bg-teal-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
          )}>
          {uploading ? (
            <><Loader2 size={20} className="animate-spin text-teal-600 mb-1.5" />
              <p className="text-sm text-slate-600">Uploading…</p></>
          ) : (
            <><UploadCloud size={20} className="text-slate-400 mb-1.5" />
              <p className="text-sm text-slate-600">
                <span className="text-teal-700 font-medium">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Receipts, scanned bills, supporting docs</p></>
          )}
          <input ref={inputRef} type="file" multiple accept={ALLOWED_TYPES.join(',')}
            className="hidden" onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />
        </div>
        {attachments.length > 0 && (
          <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
            {attachments.map((a) => {
              const isImg = a.content_type?.startsWith('image/')
              return (
                <li key={a.id} className="flex items-center gap-3 p-2.5 border border-slate-200 rounded-lg hover:border-slate-300 group">
                  {isImg ? (
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
                  <a href={a.file_url} download={a.original_name} target="_blank" rel="noreferrer"
                     className="p-2.5 sm:p-1.5 text-slate-400 hover:text-teal-600 rounded hover:bg-slate-100 sm:opacity-0 sm:group-hover:opacity-100"
                     title="Download">
                    <Download size={14} />
                  </a>
                  <button onClick={() => handleDelete(a)}
                    className="p-2.5 sm:p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 sm:opacity-0 sm:group-hover:opacity-100"
                    title="Remove">
                    <Trash2 size={14} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}

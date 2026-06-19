import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Loader2, Pencil, Trash2, Search,
  ChevronRight, ChevronDown, List as ListIcon, GitBranch,
  PowerOff, Power, FileText, BookOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getChartOfAccounts, getAccountCounts,
  createAccount, updateAccount, deleteAccount, toggleAccountActive,
  type Account, type AccountCounts,
} from '../lib/api'
import { useLocation } from '../contexts/LocationContext'
import { cn } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose,
} from '../components/ui/sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../components/ui/dialog'

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const
type AccountType = typeof ACCOUNT_TYPES[number]

const ACCOUNT_SUBTYPES: Record<AccountType, string[]> = {
  ASSET: ['Cash', 'Bank', 'Receivable', 'TDS_Receivable', 'Input_GST'],
  LIABILITY: ['Payable', 'Output_GST', 'TDS_Payable'],
  EQUITY: ['Capital', 'Retained_Earnings'],
  REVENUE: ['Sales', 'Other_Income'],
  EXPENSE: ['Purchases', 'Other_Expense'],
}

const TYPE_PILL: Record<string, { label: string; ring: string; dot: string; bg: string }> = {
  ASSET:     { label: 'Asset',     ring: 'border-sky-200',    dot: 'bg-sky-500',    bg: 'bg-sky-50 text-sky-700' },
  LIABILITY: { label: 'Liability', ring: 'border-rose-200',   dot: 'bg-rose-500',   bg: 'bg-rose-50 text-rose-700' },
  EQUITY:    { label: 'Equity',    ring: 'border-violet-200', dot: 'bg-violet-500', bg: 'bg-violet-50 text-violet-700' },
  REVENUE:   { label: 'Income',    ring: 'border-emerald-200',dot: 'bg-emerald-500',bg: 'bg-emerald-50 text-emerald-700' },
  EXPENSE:   { label: 'Expense',   ring: 'border-amber-200',  dot: 'bg-amber-500',  bg: 'bg-amber-50 text-amber-700' },
}

interface AccountForm {
  account_code: string
  account_name: string
  account_type: AccountType
  account_subtype: string
  parent: string
  description: string
  is_active: boolean
  is_shared: boolean
}

const blankForm: AccountForm = {
  account_code: '', account_name: '', account_type: 'ASSET',
  account_subtype: '', parent: '', description: '', is_active: true,
  is_shared: false,
}

export default function AccountsPage() {
  const { canSeeAll } = useLocation()
  const [view, setView] = useState<'list' | 'tree'>('list')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [counts, setCounts] = useState<AccountCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeType, setActiveType] = useState<'all' | AccountType>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  // 'store' = only this store's own accounts (default);
  // 'store_shared' = this store's accounts + admin-created shared accounts.
  const [locationScope, setLocationScope] = useState<'store' | 'store_shared'>('store')

  const [editing, setEditing] = useState<Account | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [form, setForm] = useState<AccountForm>(blankForm)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)

  async function load() {
    setLoading(true)
    try {
      // The tree is built client-side from this flat list (grouped by
      // category), so a single scoped request powers both views — no separate,
      // unscoped, all-locations tree fetch.
      const [list, c] = await Promise.all([
        getChartOfAccounts({ location_scope: locationScope }),
        getAccountCounts({ location_scope: locationScope }),
      ])
      setAccounts(list)
      setCounts(c)
    } catch {
      toast.error('Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [locationScope])

  function openCreate() {
    setEditing(null)
    setForm(blankForm)
    setSheetOpen(true)
  }

  function openEdit(acc: Account) {
    setEditing(acc)
    setForm({
      account_code: acc.account_code,
      account_name: acc.account_name,
      account_type: acc.account_type as AccountType,
      account_subtype: acc.account_subtype || '',
      parent: acc.parent ? String(acc.parent) : '',
      description: acc.description || '',
      is_active: acc.is_active,
      is_shared: !!acc.is_shared,
    })
    setSheetOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        account_code: form.account_code,
        account_name: form.account_name,
        account_type: form.account_type,
        account_subtype: form.account_subtype,
        parent: form.parent ? Number(form.parent) : null,
        description: form.description,
        is_active: form.is_active,
        // Admin-only. The server ignores any client location and decides:
        // shared → no location & visible everywhere; otherwise → active store.
        is_shared: canSeeAll ? form.is_shared : false,
      }
      if (editing) await updateAccount(editing.id, payload as Partial<Account>)
      else await createAccount(payload as Partial<Account>)
      toast.success(editing ? 'Account updated' : 'Account created')
      setSheetOpen(false)
      load()
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

  async function handleToggleActive(acc: Account) {
    try {
      await toggleAccountActive(acc.id)
      load()
    } catch {
      toast.error('Failed to toggle status')
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      await deleteAccount(deleteTarget.id)
      toast.success('Account deleted')
      setDeleteTarget(null)
      load()
    } catch {
      toast.error('Cannot delete — account may have journal entries or child accounts')
      setDeleteTarget(null)
    }
  }

  // Filtered list view rows
  const filteredList = useMemo(() => {
    const lower = search.toLowerCase()
    return accounts.filter((a) => {
      if (activeType !== 'all' && a.account_type !== activeType) return false
      if (statusFilter === 'active' && !a.is_active) return false
      if (statusFilter === 'inactive' && a.is_active) return false
      if (search && !(
        a.account_name.toLowerCase().includes(lower) ||
        a.account_code.toLowerCase().includes(lower)
      )) return false
      return true
    })
  }, [accounts, activeType, statusFilter, search])

  // Tree view: group the (filtered) flat list by category → sub-category.
  // The store's own accounts have no per-store group hierarchy, so we present
  // a clean category breakdown instead of the shared template tree.
  const categoryTree = useMemo<CategoryGroup[]>(() => {
    const out: CategoryGroup[] = []
    for (const type of ACCOUNT_TYPES) {
      const rows = filteredList.filter((a) => a.account_type === type)
      if (!rows.length) continue
      const bySub = new Map<string, Account[]>()
      for (const a of rows) {
        const key = a.account_subtype || ''
        if (!bySub.has(key)) bySub.set(key, [])
        bySub.get(key)!.push(a)
      }
      const subgroups = Array.from(bySub.entries())
        // Named sub-categories first (alphabetical); the blank "Other" last.
        .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])))
        .map(([sub, items]) => ({
          label: sub ? sub.replace(/_/g, ' ') : 'Other',
          rows: items.sort((x, y) => x.account_code.localeCompare(y.account_code)),
        }))
      out.push({ type, label: TYPE_PILL[type].label, count: rows.length, subgroups })
    }
    return out
  }, [filteredList])

  const subtypes = ACCOUNT_SUBTYPES[form.account_type] || []
  const totalCount = counts?.total ?? 0

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Chart of Accounts</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>
            {totalCount} accounts · {counts?.active ?? 0} active · {counts?.inactive ?? 0} inactive
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setView('list')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                view === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <ListIcon size={14} /> List
            </button>
            <button
              onClick={() => setView('tree')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                view === 'tree' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <GitBranch size={14} /> Hierarchy
            </button>
          </div>
          <Button onClick={openCreate}>
            <Plus size={16} /> New Account
          </Button>
        </div>
      </div>

      {/* Type pill filter */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <TypePill
          label="All"
          count={totalCount}
          active={activeType === 'all'}
          onClick={() => setActiveType('all')}
        />
        {ACCOUNT_TYPES.map((t) => (
          <TypePill
            key={t}
            label={TYPE_PILL[t].label}
            count={counts?.by_type[t] ?? 0}
            active={activeType === t}
            dotClassName={TYPE_PILL[t].dot}
            onClick={() => setActiveType(t)}
          />
        ))}
      </div>

      {/* Search + status filter */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code…"
            className="pl-9 py-1.5"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="all">All status</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <select
          value={locationScope}
          onChange={(e) => setLocationScope(e.target.value as typeof locationScope)}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
          title="Which accounts to show"
        >
          <option value="store">This store</option>
          <option value="store_shared">This store + Shared</option>
        </select>
      </div>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        {view === 'list' ? (
          <ListView
            rows={filteredList}
            loading={loading}
            onEdit={openEdit}
            onDelete={(a) => setDeleteTarget(a)}
            onToggle={handleToggleActive}
          />
        ) : (
          <CategoryTreeView
            groups={categoryTree}
            loading={loading}
            onEdit={openEdit}
            onDelete={(a) => setDeleteTarget(a)}
            onToggle={handleToggleActive}
          />
        )}
      </Card>

      {/* Side drawer for create/edit */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent width="md">
          <form onSubmit={handleSave} className="flex flex-col h-full">
            <SheetHeader>
              <SheetTitle>{editing ? 'Edit Account' : 'New Account'}</SheetTitle>
              {editing && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {editing.account_code} · {editing.documents_count ?? 0} documents
                </p>
              )}
            </SheetHeader>
            <SheetBody>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Account Code" required>
                    <Input
                      required
                      value={form.account_code}
                      onChange={(e) => setForm({ ...form, account_code: e.target.value })}
                      placeholder="e.g. 1110"
                    />
                  </Field>
                  <Field label="Account Type" required>
                    <select
                      required
                      value={form.account_type}
                      onChange={(e) => setForm({ ...form, account_type: e.target.value as AccountType, account_subtype: '' })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>{TYPE_PILL[t].label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Account Name" required>
                  <Input
                    required
                    value={form.account_name}
                    onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                    placeholder="e.g. Cash in Hand"
                  />
                </Field>
                <Field label="Sub-category" hint="Helps reports group similar accounts">
                  <select
                    value={form.account_subtype}
                    onChange={(e) => setForm({ ...form, account_subtype: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">— None —</option>
                    {subtypes.map((st) => (
                      <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Parent Account" hint="Group this account under another">
                  <select
                    value={form.parent}
                    onChange={(e) => setForm({ ...form, parent: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">— No parent —</option>
                    {accounts
                      .filter((a) => a.id !== editing?.id && a.account_type === form.account_type)
                      .map((a) => (
                        <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
                      ))}
                  </select>
                </Field>
                <Field label="Description">
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={3}
                    placeholder="Internal notes about what this account is used for…"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="accent-teal-600 w-4 h-4"
                  />
                  <span className="text-slate-700">Active</span>
                  <span className="text-xs text-slate-400">— inactive accounts are hidden from new transactions</span>
                </label>
                {canSeeAll && (
                  <label className="flex items-start gap-2 text-sm cursor-pointer rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                    <input
                      type="checkbox"
                      checked={form.is_shared}
                      onChange={(e) => setForm({ ...form, is_shared: e.target.checked })}
                      className="accent-teal-600 w-4 h-4 mt-0.5"
                    />
                    <span>
                      <span className="text-slate-700 font-medium">Shared (all stores)</span>
                      <span className="block text-xs text-slate-400">
                        Visible in every store's chart of accounts. Leave off to create
                        this account for the current store only.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </SheetBody>
            <SheetFooter>
              <SheetClose asChild>
                <Button type="button" variant="secondary">Cancel</Button>
              </SheetClose>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editing ? 'Save Changes' : 'Create Account'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete account?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            Delete <span className="font-semibold">{deleteTarget?.account_code} — {deleteTarget?.account_name}</span>?
            {(deleteTarget?.documents_count ?? 0) > 0 && (
              <span className="block mt-2 text-amber-700">
                This account has {deleteTarget?.documents_count} journal entries. Deletion will fail if referenced.
              </span>
            )}
          </p>
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Type pill ──────────────────────────────────────────────────────────────

function TypePill({ label, count, active, dotClassName, onClick }: {
  label: string
  count: number
  active: boolean
  dotClassName?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
        active
          ? 'bg-teal-50 border-teal-200 text-teal-700'
          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
      )}
    >
      {dotClassName && <span className={cn('w-1.5 h-1.5 rounded-full', dotClassName)} />}
      {label}
      <span className={cn('text-[10px] tabular-nums', active ? 'text-teal-600' : 'text-slate-400')}>
        {count}
      </span>
    </button>
  )
}

// ─── Field wrapper ──────────────────────────────────────────────────────────

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

// ─── List view ──────────────────────────────────────────────────────────────

function ListView({
  rows, loading, onEdit, onDelete, onToggle,
}: {
  rows: Account[]
  loading: boolean
  onEdit: (a: Account) => void
  onDelete: (a: Account) => void
  onToggle: (a: Account) => void
}) {
  return (
    <Table>
      <Thead>
        <Tr className="bg-slate-50">
          <Th className="text-left">Account Name</Th>
          <Th className="text-left">Code</Th>
          <Th className="text-left">Type</Th>
          <Th className="text-left">Sub-category</Th>
          <Th className="text-left">Parent</Th>
          <Th className="text-right px-3">Documents</Th>
          <Th className="text-left">Status</Th>
          <Th className="w-[70px]" />
        </Tr>
      </Thead>
      <Tbody>
        {loading ? (
          <tr><td colSpan={8} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
        ) : rows.length === 0 ? (
          <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No accounts match your filters</td></tr>
        ) : rows.map((a) => (
          <Tr key={a.id} className={cn('group', !a.is_active && 'opacity-60')}>
            <Td className="font-medium">
              <button
                onClick={() => onEdit(a)}
                className="text-left hover:text-teal-700 transition-colors"
              >
                {a.account_name}
              </button>
              {a.is_shared && (
                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 uppercase tracking-wide">
                  Shared
                </span>
              )}
            </Td>
            <Td className="font-mono text-xs text-slate-500">{a.account_code}</Td>
            <Td>
              <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium', TYPE_PILL[a.account_type]?.bg)}>
                <span className={cn('w-1.5 h-1.5 rounded-full', TYPE_PILL[a.account_type]?.dot)} />
                {TYPE_PILL[a.account_type]?.label || a.account_type}
              </span>
            </Td>
            <Td className="text-sm text-slate-500">{a.account_subtype?.replace(/_/g, ' ') || '—'}</Td>
            <Td className="text-sm text-slate-500">
              {a.parent_code ? `${a.parent_code} — ${a.parent_name}` : '—'}
            </Td>
            <Td className="text-right font-mono text-sm px-3">
              {a.documents_count ? (
                <Link
                  to={`/reports/ledger/${a.account_code}`}
                  className="text-slate-700 hover:underline hover:text-teal-700"
                  title="Open ledger"
                >
                  {a.documents_count}
                </Link>
              ) : (
                <span className="text-slate-300">0</span>
              )}
            </Td>
            <Td>
              <Badge variant={a.is_active ? 'success' : 'default'}>
                {a.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </Td>
            <Td>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Link
                  to={`/reports/ledger/${a.account_code}`}
                  className="p-1.5 text-slate-400 hover:text-teal-600 rounded hover:bg-slate-100"
                  title="View ledger"
                >
                  <BookOpen size={14} />
                </Link>
                <button
                  onClick={() => onToggle(a)}
                  className="p-1.5 text-slate-400 hover:text-teal-600 rounded hover:bg-slate-100"
                  title={a.is_active ? 'Mark inactive' : 'Mark active'}
                >
                  {a.is_active ? <PowerOff size={14} /> : <Power size={14} />}
                </button>
                <button
                  onClick={() => onEdit(a)}
                  className="p-1.5 text-slate-400 hover:text-teal-600 rounded hover:bg-slate-100"
                  title="Edit"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => onDelete(a)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  )
}

// ─── Tree view (grouped by category) ─────────────────────────────────────────

interface CategoryGroup {
  type: AccountType
  label: string
  count: number
  subgroups: { label: string; rows: Account[] }[]
}

function CategoryTreeView({
  groups, loading, onEdit, onDelete, onToggle,
}: {
  groups: CategoryGroup[]
  loading: boolean
  onEdit: (a: Account) => void
  onDelete: (a: Account) => void
  onToggle: (a: Account) => void
}) {
  if (loading) return <div className="py-12 text-center"><Loader2 className="animate-spin inline text-teal-600" size={24} /></div>
  if (groups.length === 0) return <div className="py-12 text-center text-slate-400 text-sm">No accounts</div>
  return (
    <div className="py-1">
      {groups.map((g) => (
        <CategoryGroupNode key={g.type} group={g} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} />
      ))}
    </div>
  )
}

function CategoryGroupNode({
  group, onEdit, onDelete, onToggle,
}: {
  group: CategoryGroup
  onEdit: (a: Account) => void
  onDelete: (a: Account) => void
  onToggle: (a: Account) => void
}) {
  const [expanded, setExpanded] = useState(true)
  return (
    <>
      <div
        className="flex items-center gap-2 py-2 px-3 bg-slate-50/60 hover:bg-slate-50 cursor-pointer border-b border-slate-100"
        onClick={() => setExpanded((x) => !x)}
      >
        <button className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className={cn('w-1.5 h-1.5 rounded-full', TYPE_PILL[group.type]?.dot)} />
        <span className="text-sm font-semibold text-slate-700">{group.label}</span>
        <span className="text-[10px] tabular-nums text-slate-400">{group.count}</span>
      </div>
      {expanded && group.subgroups.map((sg) => (
        <div key={sg.label}>
          <div
            className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-400"
            style={{ paddingLeft: 42 }}
          >
            {sg.label}
          </div>
          {sg.rows.map((a) => (
            <AccountTreeRow key={a.id} acc={a} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} />
          ))}
        </div>
      ))}
    </>
  )
}

function AccountTreeRow({
  acc, onEdit, onDelete, onToggle,
}: {
  acc: Account
  onEdit: (a: Account) => void
  onDelete: (a: Account) => void
  onToggle: (a: Account) => void
}) {
  return (
    <div
      className="flex items-center gap-2 py-1.5 px-3 hover:bg-slate-50 group cursor-pointer border-b border-slate-100 last:border-0"
      style={{ paddingLeft: 60 }}
      onClick={() => onEdit(acc)}
    >
      <FileText size={14} className={cn('flex-shrink-0', TYPE_PILL[acc.account_type]?.dot.replace('bg-', 'text-'))} />
      <span className="font-mono text-xs text-slate-500 w-20 flex-shrink-0">{acc.account_code}</span>
      <span className={cn('flex-1 text-sm font-medium truncate', !acc.is_active && 'text-slate-400 line-through')}>
        {acc.account_name}
      </span>
      {acc.is_shared && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 uppercase tracking-wide">
          Shared
        </span>
      )}
      {acc.documents_count ? (
        <Link
          to={`/reports/ledger/${acc.account_code}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-slate-400 hover:text-teal-700 tabular-nums"
          title="Open ledger"
        >
          {acc.documents_count} docs
        </Link>
      ) : null}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(acc) }}
        className="p-1 text-slate-300 hover:text-teal-600 opacity-0 group-hover:opacity-100"
        title={acc.is_active ? 'Mark inactive' : 'Mark active'}
      >
        {acc.is_active ? <PowerOff size={13} /> : <Power size={13} />}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onEdit(acc) }}
        className="p-1 text-slate-300 hover:text-teal-600 opacity-0 group-hover:opacity-100"
        title="Edit"
      >
        <Pencil size={13} />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(acc) }}
        className="p-1 text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100"
        title="Delete"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

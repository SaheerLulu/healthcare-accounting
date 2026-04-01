import { useEffect, useState } from 'react'
import { Plus, ChevronRight, ChevronDown, Loader2, Pencil, Trash2, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  getAccountTree,
  getChartOfAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  type Account,
} from '../lib/api'
import { cn } from '../lib/utils'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogClose } from '../components/ui/dialog'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']
const ACCOUNT_SUBTYPES: Record<string, string[]> = {
  ASSET: ['Cash', 'Bank', 'Receivable', 'TDS_Receivable'],
  LIABILITY: ['Payable', 'Output_GST', 'TDS_Payable'],
  EQUITY: ['Capital', 'Retained_Earnings'],
  REVENUE: ['Sales', 'Other_Income'],
  EXPENSE: ['Purchases', 'Other_Expense'],
}

const ACCOUNT_TYPE_VARIANT: Record<string, 'info' | 'error' | 'purple' | 'success' | 'warning'> = {
  ASSET: 'info',
  LIABILITY: 'error',
  EQUITY: 'purple',
  REVENUE: 'success',
  EXPENSE: 'warning',
}

function AccountRow({
  account,
  depth,
  onEdit,
  onDelete,
}: {
  account: Account
  depth: number
  onEdit: (account: Account) => void
  onDelete: (account: Account) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasChildren = account.children && account.children.length > 0

  return (
    <>
      <Tr className="last:border-0 group">
        <Td>
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 20 }}>
            {hasChildren ? (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-500"
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="w-5 h-5" />
            )}
            <span className="text-xs text-slate-500 font-mono">{account.account_code}</span>
          </div>
        </Td>
        <Td className="text-sm font-medium text-slate-900">{account.account_name}</Td>
        <Td>
          <Badge variant={ACCOUNT_TYPE_VARIANT[account.account_type] || 'default'}>
            {account.account_type}
          </Badge>
        </Td>
        <Td className="text-sm text-slate-500 capitalize">
          {account.account_subtype?.replace(/_/g, ' ') || '-'}
        </Td>
        <Td>
          <span className={cn(
            'inline-flex w-2 h-2 rounded-full',
            account.is_leaf ? 'bg-emerald-400' : 'bg-slate-400'
          )} />
        </Td>
        <Td>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onEdit(account)} className="p-1 text-slate-400 hover:text-teal-600" title="Edit">
              <Pencil size={14} />
            </button>
            <button onClick={() => onDelete(account)} className="p-1 text-slate-400 hover:text-red-500" title="Delete">
              <Trash2 size={14} />
            </button>
          </div>
        </Td>
      </Tr>
      {expanded && hasChildren && account.children!.map((child) => (
        <AccountRow key={child.id} account={child} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </>
  )
}

interface AccountForm {
  account_code: string
  account_name: string
  account_type: string
  account_subtype: string
  parent: string
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [flatAccounts, setFlatAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [editAccount, setEditAccount] = useState<Account | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<AccountForm>({ account_code: '', account_name: '', account_type: 'ASSET', account_subtype: '', parent: '' })
  const [deleteConfirm, setDeleteConfirm] = useState<Account | null>(null)
  const [form, setForm] = useState<AccountForm>({
    account_code: '',
    account_name: '',
    account_type: 'ASSET',
    account_subtype: '',
    parent: '',
  })

  async function load() {
    setLoading(true)
    try {
      const [tree, flat] = await Promise.all([getAccountTree(), getChartOfAccounts()])
      setAccounts(tree)
      setFlatAccounts(flat)
    } catch {
      toast.error('Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const subtypes = ACCOUNT_SUBTYPES[form.account_type] || []
  const editSubtypes = ACCOUNT_SUBTYPES[editForm.account_type] || []

  function handleEdit(acc: Account) {
    setEditAccount(acc)
    setEditForm({
      account_code: acc.account_code,
      account_name: acc.account_name,
      account_type: acc.account_type,
      account_subtype: acc.account_subtype || '',
      parent: acc.parent ? String(acc.parent) : '',
    })
    setEditOpen(true)
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editAccount) return
    setSaving(true)
    try {
      await updateAccount(editAccount.id, {
        account_code: editForm.account_code,
        account_name: editForm.account_name,
        account_type: editForm.account_type,
        account_subtype: editForm.account_subtype,
        parent: editForm.parent ? Number(editForm.parent) : null,
      })
      toast.success('Account updated')
      setEditOpen(false)
      setEditAccount(null)
      load()
    } catch {
      toast.error('Failed to update account')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(acc: Account) {
    setDeleteConfirm(acc)
  }

  async function confirmDelete() {
    if (!deleteConfirm) return
    try {
      await deleteAccount(deleteConfirm.id)
      toast.success('Account deleted')
      setDeleteConfirm(null)
      load()
    } catch {
      toast.error('Cannot delete account — it may have journal entries')
      setDeleteConfirm(null)
    }
  }

  function filterTree(nodes: Account[]): Account[] {
    const lowerSearch = search.toLowerCase()
    return nodes.reduce<Account[]>((acc, node) => {
      const matchesSearch = !search ||
        node.account_name.toLowerCase().includes(lowerSearch) ||
        node.account_code.toLowerCase().includes(lowerSearch)
      const matchesType = !typeFilter || node.account_type === typeFilter
      const filteredChildren = node.children ? filterTree(node.children) : []

      if ((matchesSearch && matchesType) || filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children })
      }
      return acc
    }, [])
  }

  const filteredAccounts = (search || typeFilter) ? filterTree(accounts) : accounts

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await createAccount({
        account_code: form.account_code,
        account_name: form.account_name,
        account_type: form.account_type,
        account_subtype: form.account_subtype,
        parent: form.parent ? Number(form.parent) : null,
      })
      toast.success('Account created')
      setOpen(false)
      setForm({ account_code: '', account_name: '', account_type: 'ASSET', account_subtype: '' , parent: '' })
      load()
    } catch {
      toast.error('Failed to create account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Chart of Accounts</h1>
          <p className="text-sm text-slate-500 mt-0.5">{flatAccounts.length} accounts</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus size={16} />
              Add Account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Account</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSave} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Account Code *</label>
                <Input
                  required
                  value={form.account_code}
                  onChange={(e) => setForm({ ...form, account_code: e.target.value })}
                  placeholder="e.g. 1001"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Account Name *</label>
                <Input
                  required
                  value={form.account_name}
                  onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                  placeholder="e.g. Cash in Hand"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Account Type *</label>
                  <select
                    required
                    value={form.account_type}
                    onChange={(e) => setForm({ ...form, account_type: e.target.value, account_subtype: '' })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 capitalize"
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t} value={t} className="capitalize">{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Subtype</label>
                  <select
                    value={form.account_subtype}
                    onChange={(e) => setForm({ ...form, account_subtype: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">-- None --</option>
                    {subtypes.map((st) => (
                      <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Parent Account</label>
                <select
                  value={form.parent}
                  onChange={(e) => setForm({ ...form, parent: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">-- No Parent --</option>
                  {flatAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.account_code} - {acc.account_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  type="submit"
                  disabled={saving}
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Save Account
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code..."
            className="pl-9 py-1.5" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 capitalize">
          <option value="">All Types</option>
          {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {(search || typeFilter) && (
          <button onClick={() => { setSearch(''); setTypeFilter('') }}
            className="text-xs text-slate-500 hover:text-slate-900 underline">Clear</button>
        )}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th>Code</Th>
              <Th>Account Name</Th>
              <Th>Type</Th>
              <Th>Subtype</Th>
              <Th>Active</Th>
              <Th className="w-20" />
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-400">
                  <Loader2 size={24} className="animate-spin inline text-teal-600" />
                </td>
              </tr>
            ) : filteredAccounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-400 text-sm">
                  No accounts found
                </td>
              </tr>
            ) : (
              filteredAccounts.map((acc) => (
                <AccountRow key={acc.id} account={acc} depth={0} onEdit={handleEdit} onDelete={handleDelete} />
              ))
            )}
          </Tbody>
        </Table>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Account</DialogTitle></DialogHeader>
          <form onSubmit={handleEditSave} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Account Code *</label>
              <Input required value={editForm.account_code} onChange={(e) => setEditForm({ ...editForm, account_code: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Account Name *</label>
              <Input required value={editForm.account_name} onChange={(e) => setEditForm({ ...editForm, account_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Account Type *</label>
                <select required value={editForm.account_type}
                  onChange={(e) => setEditForm({ ...editForm, account_type: e.target.value, account_subtype: '' })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 capitalize">
                  {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Subtype</label>
                <select value={editForm.account_subtype}
                  onChange={(e) => setEditForm({ ...editForm, account_subtype: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">-- None --</option>
                  {editSubtypes.map((st) => <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Parent Account</label>
              <select value={editForm.parent} onChange={(e) => setEditForm({ ...editForm, parent: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">-- No Parent --</option>
                {flatAccounts.filter((a) => a.id !== editAccount?.id).map((acc) => (
                  <option key={acc.id} value={acc.id}>{acc.account_code} - {acc.account_name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 size={14} className="animate-spin" />} Update Account
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Account</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            Are you sure you want to delete <span className="font-semibold">{deleteConfirm?.account_code} - {deleteConfirm?.account_name}</span>?
            This cannot be undone.
          </p>
          <div className="flex gap-3 justify-end pt-4">
            <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

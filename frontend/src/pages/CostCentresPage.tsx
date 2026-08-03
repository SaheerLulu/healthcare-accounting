import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Loader2, Layers } from 'lucide-react'
import { toast } from 'sonner'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import {
  listCostCategories, createCostCategory, updateCostCategory, deleteCostCategory,
  listCostCentres, createCostCentre, updateCostCentre, deleteCostCentre,
  type CostCategory, type CostCentre,
} from '../lib/api'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'

export default function CostCentresPage() {
  const [categories, setCategories] = useState<CostCategory[]>([])
  const [centres, setCentres] = useState<CostCentre[]>([])
  const [loading, setLoading] = useState(true)
  const [editingCategory, setEditingCategory] = useState<CostCategory | null>(null)
  const [editingCentre, setEditingCentre] = useState<CostCentre | null>(null)
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [showCentreForm, setShowCentreForm] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [cats, cs] = await Promise.all([
        listCostCategories(),
        listCostCentres(),
      ])
      setCategories(cats)
      setCentres(cs)
    } catch {
      toast.error('Failed to load cost centres')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function removeCategory(c: CostCategory) {
    if (!confirm(`Delete category "${c.name}" and all its centres?`)) return
    try { await deleteCostCategory(c.id); toast.success('Deleted'); load() }
    catch { toast.error('Failed') }
  }
  async function removeCentre(c: CostCentre) {
    if (!confirm(`Delete cost centre "${c.name}"?`)) return
    try { await deleteCostCentre(c.id); toast.success('Deleted'); load() }
    catch { toast.error('Failed') }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <Layers size={18} style={{ color: 'var(--brand)' }} />
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Cost Centres
          </h1>
          <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
            · Tally-style departmental allocation master
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => { setEditingCategory(null); setShowCategoryForm(true) }}>
            <Plus size={14} /> Category
          </Button>
          <Button onClick={() => { setEditingCentre(null); setShowCentreForm(true) }}
            disabled={categories.length === 0}>
            <Plus size={14} /> Cost Centre
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <Loader2 size={20} className="animate-spin inline" style={{ color: 'var(--brand)' }} />
        </div>
      ) : (
        <>
          {/* Categories */}
          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Categories ({categories.length})</h2>
            </div>
            {categories.length === 0 ? (
              <div className="text-center py-6 text-sm" style={{ color: 'var(--ink-3)' }}>
                No categories yet — add one to start grouping cost centres
              </div>
            ) : (
              <div className="table-scroll">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}>
                    <tr>
                      <th className="text-left text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Name</th>
                      <th className="text-left text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Description</th>
                      <th className="text-center text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Centres</th>
                      <th className="text-center text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Active</th>
                      <th className="w-24" />
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((c) => (
                      <tr key={c.id} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
                        <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--ink)' }}>{c.name}</td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--ink-2)' }}>{c.description || '—'}</td>
                        <td className="px-4 py-2.5 text-center mono" style={{ color: 'var(--ink-2)' }}>
                          {c.centre_count ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <Badge variant={c.is_active ? 'success' : 'default'}>
                            {c.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              className="p-1.5 rounded transition-colors"
                              style={{ color: 'var(--ink-3)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--brand)'; e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.backgroundColor = 'transparent' }}
                              onClick={() => { setEditingCategory(c); setShowCategoryForm(true) }}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              className="p-1.5 rounded transition-colors"
                              style={{ color: 'var(--ink-3)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.backgroundColor = 'transparent' }}
                              onClick={() => removeCategory(c)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Centres */}
          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Cost Centres ({centres.length})</h2>
            </div>
            {centres.length === 0 ? (
              <div className="text-center py-6 text-sm" style={{ color: 'var(--ink-3)' }}>
                No cost centres yet
              </div>
            ) : (
              <div className="table-scroll">
                <table className="w-full text-sm min-w-[680px]">
                  <thead className="border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}>
                    <tr>
                      <th className="text-left text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Centre</th>
                      <th className="text-left text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Code</th>
                      <th className="text-left text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Category</th>
                      <th className="text-left text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Parent</th>
                      <th className="text-center text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Active</th>
                      <th className="w-24" />
                    </tr>
                  </thead>
                  <tbody>
                    {centres.map((c) => (
                      <tr key={c.id} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
                        <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--ink)' }}>{c.name}</td>
                        <td className="px-4 py-2.5 mono text-xs" style={{ color: 'var(--ink-3)' }}>{c.code || '—'}</td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--ink-2)' }}>{c.category_name || '—'}</td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--ink-2)' }}>{c.parent_name || '—'}</td>
                        <td className="px-4 py-2.5 text-center">
                          <Badge variant={c.is_active ? 'success' : 'default'}>
                            {c.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              className="p-1.5 rounded transition-colors"
                              style={{ color: 'var(--ink-3)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--brand)'; e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.backgroundColor = 'transparent' }}
                              onClick={() => { setEditingCentre(c); setShowCentreForm(true) }}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              className="p-1.5 rounded transition-colors"
                              style={{ color: 'var(--ink-3)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.backgroundColor = 'transparent' }}
                              onClick={() => removeCentre(c)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <CategoryForm
        open={showCategoryForm}
        onOpenChange={setShowCategoryForm}
        editing={editingCategory}
        onSaved={load}
      />
      <CentreForm
        open={showCentreForm}
        onOpenChange={setShowCentreForm}
        editing={editingCentre}
        categories={categories}
        centres={centres}
        onSaved={load}
      />
    </div>
  )
}

function CategoryForm({ open, onOpenChange, editing, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: CostCategory | null
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [allocateRev, setAllocateRev] = useState(true)
  const [allocateNonRev, setAllocateNonRev] = useState(true)
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(editing?.name || '')
      setDescription(editing?.description || '')
      setAllocateRev(editing?.allocate_revenue ?? true)
      setAllocateNonRev(editing?.allocate_non_revenue ?? true)
      setActive(editing?.is_active ?? true)
    }
  }, [open, editing])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const data = {
        name: name.trim(), description,
        allocate_revenue: allocateRev,
        allocate_non_revenue: allocateNonRev,
        is_active: active,
      }
      if (editing) await updateCostCategory(editing.id, data)
      else await createCostCategory(data)
      toast.success(editing ? 'Updated' : 'Created')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      const e = err as { response?: { data?: Record<string, unknown> } }
      toast.error(JSON.stringify(e.response?.data ?? 'Failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${editing.name}` : 'New Category'}
      onSubmit={submit}
      saving={saving}
    >
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Description">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Toggle label="Allocate to Revenue" checked={allocateRev} onChange={setAllocateRev} />
        <Toggle label="Allocate to Non-Revenue" checked={allocateNonRev} onChange={setAllocateNonRev} />
      </div>
      <Toggle label="Active" checked={active} onChange={setActive} />
    </FormDialog>
  )
}

function CentreForm({ open, onOpenChange, editing, categories, centres, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: CostCentre | null
  categories: CostCategory[]
  centres: CostCentre[]
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [category, setCategory] = useState<number | ''>('')
  const [parent, setParent] = useState<number | ''>('')
  const [description, setDescription] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(editing?.name || '')
      setCode(editing?.code || '')
      setCategory(editing?.category ?? (categories[0]?.id ?? ''))
      setParent(editing?.parent ?? '')
      setDescription(editing?.description || '')
      setActive(editing?.is_active ?? true)
    }
  }, [open, editing, categories])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !category) return
    setSaving(true)
    try {
      const data = {
        name: name.trim(), code,
        category: Number(category),
        parent: parent === '' ? null : Number(parent),
        description, is_active: active,
      }
      if (editing) await updateCostCentre(editing.id, data)
      else await createCostCentre(data)
      toast.success(editing ? 'Updated' : 'Created')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      const e = err as { response?: { data?: Record<string, unknown> } }
      toast.error(JSON.stringify(e.response?.data ?? 'Failed'))
    } finally {
      setSaving(false)
    }
  }

  const eligibleParents = centres.filter((c) =>
    c.category === category && (!editing || c.id !== editing.id)
  )

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${editing.name}` : 'New Cost Centre'}
      onSubmit={submit}
      saving={saving}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Code">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. OPD" />
        </Field>
      </div>
      <Field label="Category" required>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : '')}
          className="w-full h-9 px-3 text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
          style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
        >
          <option value="">— Select —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Parent (optional)">
        <select
          value={parent}
          onChange={(e) => setParent(e.target.value ? Number(e.target.value) : '')}
          className="w-full h-9 px-3 text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
          style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
        >
          <option value="">— None —</option>
          {eligibleParents.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Description">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Toggle label="Active" checked={active} onChange={setActive} />
    </FormDialog>
  )
}

function FormDialog({ open, onOpenChange, title, onSubmit, saving, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  onSubmit: (e: React.FormEvent) => void
  saving: boolean
  children: React.ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadeIn" style={{ background: 'rgba(12,30,37,0.45)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 animate-slideUp max-h-[85dvh] overflow-y-auto"
          style={{ background: 'var(--surface-0)', border: '1px solid var(--line)', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-start justify-between mb-3">
            <Dialog.Title className="text-base font-semibold" style={{ color: 'var(--ink)' }}>{title}</Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-[var(--color-hover-bg)]" aria-label="Close">
              <X className="w-4 h-4" style={{ color: 'var(--ink-3)' }} />
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="space-y-3">
            {children}
            <div className="flex justify-end gap-2 pt-3 border-t mt-4" style={{ borderColor: 'var(--line)' }}>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 size={14} className="animate-spin" />} Save
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-2)' }}>
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </span>
      {children}
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ color: 'var(--ink)' }}>{label}</span>
    </label>
  )
}

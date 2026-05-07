import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Plus, Loader2, Layers } from 'lucide-react'
import { toast } from 'sonner'
import {
  listCostCentres, listCostCategories, createCostCentre, createCostCategory,
  type CostCentre, type CostCategory,
} from '../../lib/api'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

const DEFAULT_CATEGORY = 'Department'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Currently selected cost-centre id (null when unset). */
  currentId: number | null
  /** Free-form label (legacy, used while master is empty). */
  currentLabel: string
  /** Called with the new selection. Pass id=null+label='' to clear. */
  onPick: (selection: { id: number | null; label: string }) => void
}

export function CostCenterPopup({ open, onOpenChange, currentId, currentLabel, onPick }: Props) {
  const [centres, setCentres] = useState<CostCentre[]>([])
  const [categories, setCategories] = useState<CostCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => {
    if (!open) return
    setNewName('')
    setLoading(true)
    Promise.all([listCostCentres({ active_only: 'true' }), listCostCategories({ active_only: 'true' })])
      .then(([cs, cats]) => {
        setCentres(cs)
        setCategories(cats)
      })
      .catch(() => toast.error('Failed to load cost centres'))
      .finally(() => setLoading(false))
  }, [open])

  // Group centres by category for display.
  const grouped = useMemo(() => {
    const map = new Map<string, CostCentre[]>()
    for (const c of centres) {
      const key = c.category_name || `Category #${c.category}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [centres])

  function commit(c: CostCentre | null) {
    onPick({ id: c?.id ?? null, label: c?.name ?? '' })
    onOpenChange(false)
  }

  async function ensureCategory(): Promise<number | null> {
    let cat = categories.find((c) => c.name === DEFAULT_CATEGORY)
    if (cat) return cat.id
    try {
      cat = await createCostCategory({ name: DEFAULT_CATEGORY, is_active: true })
      setCategories((p) => [...p, cat!])
      return cat.id
    } catch {
      toast.error('Failed to create default cost category')
      return null
    }
  }

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const catId = await ensureCategory()
      if (!catId) return
      const created = await createCostCentre({
        name, category: catId, is_active: true,
      })
      setCentres((p) => [...p, created])
      onPick({ id: created.id, label: created.name })
      setNewName('')
      onOpenChange(false)
      toast.success(`Created cost centre: ${created.name}`)
    } catch (err) {
      const e = err as { response?: { data?: Record<string, unknown> } }
      const data = e.response?.data
      const msg = data
        ? Object.entries(data)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
            .join(' • ')
        : 'Failed to create'
      toast.error(msg)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 animate-fadeIn"
          style={{ background: 'rgba(12,30,37,0.45)' }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 animate-slideUp"
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--line)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          }}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <Dialog.Title className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                <Layers size={14} style={{ color: 'var(--brand)' }} />
                Cost Centre
              </Dialog.Title>
              <Dialog.Description className="text-xs mt-0.5" style={{ color: 'var(--ink-2)' }}>
                Allocate this voucher to a department / project. Currently:{' '}
                <span className="font-mono font-semibold" style={{ color: 'var(--brand)' }}>
                  {currentLabel || (currentId ? `#${currentId}` : '— none —')}
                </span>
              </Dialog.Description>
            </div>
            <Dialog.Close className="p-1 rounded hover:bg-[var(--color-hover-bg)]" aria-label="Close">
              <X className="w-4 h-4" style={{ color: 'var(--ink-3)' }} />
            </Dialog.Close>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <Loader2 size={20} className="animate-spin inline" style={{ color: 'var(--brand)' }} />
            </div>
          ) : grouped.length > 0 ? (
            <div className="max-h-[40vh] overflow-y-auto -mx-1 mb-3">
              {grouped.map(([catName, list]) => (
                <div key={catName} className="mb-2">
                  <div
                    className="px-3 py-1 mono uppercase text-[10px] tracking-wider"
                    style={{ color: 'var(--ink-3)' }}
                  >
                    {catName}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 px-1">
                    {list.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => commit(c)}
                        className="px-3 py-1.5 rounded-md text-sm text-left hover:translate-y-[-1px] transition-transform"
                        style={{
                          background: c.id === currentId ? 'rgba(15,157,154,0.10)' : 'var(--surface-1)',
                          border: `1px solid ${c.id === currentId ? 'rgba(15,157,154,0.30)' : 'var(--line)'}`,
                          color: c.id === currentId ? 'var(--brand)' : 'var(--ink)',
                          fontWeight: c.id === currentId ? 600 : 400,
                        }}
                      >
                        {c.name}
                        {c.code && (
                          <span className="ml-1 mono text-[10px]" style={{ color: 'var(--ink-3)' }}>
                            {c.code}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-sm" style={{ color: 'var(--ink-3)' }}>
              No cost centres yet — add the first one below.
            </div>
          )}

          <div className="border-t pt-3 mb-3" style={{ borderColor: 'var(--line)' }}>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Add new (creates under "{DEFAULT_CATEGORY}")
            </label>
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreate() } }}
                placeholder="e.g. RADIOLOGY"
                className="flex-1"
                autoFocus
              />
              <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
              </Button>
            </div>
          </div>

          <div className="flex justify-between pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
            <Button type="button" variant="ghost" onClick={() => commit(null)} disabled={!currentId && !currentLabel}>
              Clear
            </Button>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

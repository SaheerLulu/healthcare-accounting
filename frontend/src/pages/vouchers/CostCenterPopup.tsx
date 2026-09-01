import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
/** The centre grid is two columns wide — ↑↓ therefore move by two. */
const GRID_COLS = 2

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

  // Roving tabindex over the centre grid — one tab stop for the whole list.
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const newNameRef = useRef<HTMLInputElement>(null)
  // Set on open, consumed once the centres land: the list is what the user
  // came for, so it takes focus ahead of the "add new" box behind it.
  const pendingFocusRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setNewName('')
    setLoading(true)
    pendingFocusRef.current = true
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

  /** The grid in visual order — the index space the arrow keys walk. */
  const flat = useMemo(() => grouped.flatMap(([, list]) => list), [grouped])

  const focusOption = useCallback((idx: number) => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-cc-idx="${idx}"]`)
      ?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const sel = flat.findIndex((c) => c.id === currentId)
    const idx = sel >= 0 ? sel : 0
    setActive(idx)
    if (!pendingFocusRef.current || loading || flat.length === 0) return
    // Never yank focus off something the user already moved to (or typed in).
    const el = document.activeElement as HTMLElement | null
    if (el && el !== document.body && el !== newNameRef.current) return
    if (newNameRef.current?.value) return
    pendingFocusRef.current = false
    focusOption(idx)
  }, [open, loading, flat, currentId, focusOption])

  function commit(c: CostCentre | null) {
    onPick({ id: c?.id ?? null, label: c?.name ?? '' })
    onOpenChange(false)
  }

  function moveTo(next: number) {
    if (flat.length === 0) return
    const clamped = Math.max(0, Math.min(flat.length - 1, next))
    setActive(clamped)
    focusOption(clamped)
  }

  /**
   * Arrow keys, Home/End and type-ahead over the grid. Without this a shop
   * with twenty cost centres costs twenty Tab presses to reach the last one.
   */
  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); moveTo(active + 1); return
      case 'ArrowLeft': e.preventDefault(); moveTo(active - 1); return
      case 'ArrowDown': e.preventDefault(); moveTo(active + GRID_COLS); return
      case 'ArrowUp': e.preventDefault(); moveTo(active - GRID_COLS); return
      case 'Home': e.preventDefault(); moveTo(0); return
      case 'End': e.preventDefault(); moveTo(flat.length - 1); return
      default:
    }
    // Type-ahead: the listbox convention, and the cheapest "filter" there is —
    // one letter jumps to the next centre starting with it.
    if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey || e.key === ' ') return
    const k = e.key.toLowerCase()
    const startsWith = (c: CostCentre) => c.name.toLowerCase().startsWith(k)
    const ahead = flat.findIndex((c, i) => i > active && startsWith(c))
    const found = ahead >= 0 ? ahead : flat.findIndex(startsWith)
    if (found >= 0) {
      e.preventDefault()
      moveTo(found)
    }
  }

  /**
   * Delete clears the cost centre — the footer button's chord.
   *
   * NOT Alt+X: that chord is Export for the whole app (ShortcutHelp documents
   * it globally, and eight registers bind it), and a second meaning that only
   * holds inside this dialog is exactly the drift a keyboard user cannot
   * unlearn per screen. Delete collides with nothing.
   */
  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Delete' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    // Inside the "add new" box Delete is forward-delete. Text editing wins.
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    e.preventDefault()
    // Keep the press off the editor behind the dialog.
    e.stopPropagation()
    if (currentId || currentLabel) commit(null)
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

  // Running index across the groups, so the flat arrow-key order matches the
  // order the grid is actually read in.
  let optionIdx = -1

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 animate-fadeIn"
          style={{ background: 'rgba(12,30,37,0.45)' }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl p-4 sm:p-6 animate-slideUp max-h-[85dvh] overflow-y-auto overscroll-contain"
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--line)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          }}
          onKeyDown={onDialogKeyDown}
          /**
           * Radix focuses the first tabbable child, which here is the close X.
           * Start in the "add new" box instead — an empty master has nothing
           * else to offer — and the effect above hands focus to the selected
           * centre as soon as the list arrives.
           */
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            newNameRef.current?.focus()
          }}
        >
          <div className="flex items-start justify-between mb-4">
            <div className="min-w-0">
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
            <Dialog.Close className="shrink-0 p-1 rounded hover:bg-[var(--color-hover-bg)]" aria-label="Close">
              <X className="w-4 h-4" style={{ color: 'var(--ink-3)' }} />
            </Dialog.Close>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <Loader2 size={20} className="animate-spin inline" style={{ color: 'var(--brand)' }} />
            </div>
          ) : grouped.length > 0 ? (
            <div
              ref={listRef}
              role="listbox"
              aria-label="Cost centres"
              onKeyDown={onListKeyDown}
              className="max-h-[40vh] overflow-y-auto -mx-1 mb-3"
            >
              {grouped.map(([catName, list]) => {
                const groupId = `cc-group-${catName.replace(/\s+/g, '-')}`
                return (
                  <div key={catName} className="mb-2" role="presentation">
                    <div
                      id={groupId}
                      className="px-3 py-1 mono uppercase text-[10px] tracking-wider"
                      style={{ color: 'var(--ink-3)' }}
                    >
                      {catName}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 px-1" role="group" aria-labelledby={groupId}>
                      {list.map((c) => {
                        optionIdx += 1
                        const idx = optionIdx
                        const isCurrent = c.id === currentId
                        return (
                          <button
                            key={c.id}
                            type="button"
                            role="option"
                            aria-selected={isCurrent}
                            data-cc-idx={idx}
                            tabIndex={idx === active ? 0 : -1}
                            onFocus={() => setActive(idx)}
                            onClick={() => commit(c)}
                            className="px-3 py-1.5 rounded-md text-sm text-left hover:translate-y-[-1px] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                            style={{
                              background: isCurrent ? 'rgba(15,157,154,0.10)' : 'var(--surface-1)',
                              border: `1px solid ${isCurrent ? 'rgba(15,157,154,0.30)' : 'var(--line)'}`,
                              color: isCurrent ? 'var(--brand)' : 'var(--ink)',
                              fontWeight: isCurrent ? 600 : 400,
                            }}
                          >
                            {c.name}
                            {c.code && (
                              <span className="ml-1 mono text-[10px]" style={{ color: 'var(--ink-3)' }}>
                                {c.code}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-6 text-sm" style={{ color: 'var(--ink-3)' }}>
              No cost centres yet — add the first one below.
            </div>
          )}

          <div className="border-t pt-3 mb-3" style={{ borderColor: 'var(--line)' }}>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }} htmlFor="cc-new-name">
              Add new (creates under "{DEFAULT_CATEGORY}")
            </label>
            <div className="flex gap-2">
              <Input
                id="cc-new-name"
                ref={newNameRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreate() } }}
                placeholder="e.g. RADIOLOGY"
                className="flex-1"
              />
              {/* No `chord` keycap: Enter creates a centre only from inside
                  the field to its left. The popup hands focus to the centre
                  listbox as soon as it loads, and Enter there picks the
                  focused centre — advertising it here would promise a
                  popup-wide chord that does not exist. */}
              <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
              </Button>
            </div>
          </div>

          <div className="flex justify-between pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => commit(null)}
              disabled={!currentId && !currentLabel}
              chord="Delete"
            >
              Clear
            </Button>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} chord="Esc">
              Cancel
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

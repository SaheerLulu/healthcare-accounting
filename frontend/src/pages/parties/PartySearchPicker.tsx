import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, Check, History } from 'lucide-react'
import type { Party } from '../../lib/api'
import { cn } from '../../lib/utils'

const RECENT_KEY_PREFIX = 'partypicker.recent.'
const RECENT_MAX = 5

function readRecent(key: string): number[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY_PREFIX + key)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'number') : []
  } catch {
    return []
  }
}
function writeRecent(key: string, ids: number[]) {
  try { localStorage.setItem(RECENT_KEY_PREFIX + key, JSON.stringify(ids.slice(0, RECENT_MAX))) } catch { /* ignore */ }
}

interface Props {
  parties: Party[]
  value: number | ''
  onChange: (id: number | '') => void
  /** Used to scope recent-parties cache (e.g. "Supplier" or "Customer"). */
  storageKey: string
  placeholder?: string
  disabled?: boolean
}

export function PartySearchPicker({ parties, value, onChange, storageKey, placeholder, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [recentIds, setRecentIds] = useState<number[]>(() => readRecent(storageKey))
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  const selected = useMemo(
    () => (value ? parties.find((p) => p.id === value) : null),
    [parties, value]
  )

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return parties
    const prefix: Party[] = []
    const sub: Party[] = []
    for (const p of parties) {
      const name = p.name.toLowerCase()
      if (name.startsWith(q)) prefix.push(p)
      else if (name.includes(q)) sub.push(p)
    }
    return [...prefix, ...sub]
  }, [parties, query])

  const recentParties = useMemo(() => {
    if (query) return []
    const map = new Map(parties.map((p) => [p.id, p]))
    const out: Party[] = []
    for (const id of recentIds) {
      const p = map.get(id)
      if (p) out.push(p)
    }
    return out
  }, [parties, recentIds, query])

  const navList = useMemo(() => {
    if (query) return filtered
    const recentSet = new Set(recentParties.map((p) => p.id))
    return [...recentParties, ...filtered.filter((p) => !recentSet.has(p.id))]
  }, [recentParties, filtered, query])

  useEffect(() => { setHighlight(0) }, [query, open])

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    function recalc() {
      const r = triggerRef.current?.getBoundingClientRect()
      if (!r) return
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 280) })
    }
    recalc()
    window.addEventListener('scroll', recalc, true)
    window.addEventListener('resize', recalc)
    return () => {
      window.removeEventListener('scroll', recalc, true)
      window.removeEventListener('resize', recalc)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  function commit(p: Party | null) {
    if (!p) {
      onChange('')
      setOpen(false)
      setQuery('')
      return
    }
    onChange(p.id)
    setOpen(false)
    setQuery('')
    setRecentIds((prev) => {
      const next = [p.id, ...prev.filter((id) => id !== p.id)].slice(0, RECENT_MAX)
      writeRecent(storageKey, next)
      return next
    })
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, navList.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(navList[highlight] || null)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border rounded-lg text-left transition-colors',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        style={{
          backgroundColor: 'var(--surface-0)',
          borderColor: open ? 'var(--brand)' : 'var(--line)',
          boxShadow: open ? '0 0 0 3px rgba(15,157,154,0.18)' : undefined,
          color: 'var(--ink)',
        }}
      >
        {selected ? (
          <span className="truncate" style={{ color: 'var(--ink)' }}>{selected.name}</span>
        ) : (
          <span style={{ color: 'var(--ink-3)' }}>{placeholder || 'Search…'}</span>
        )}
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} style={{ color: 'var(--ink-3)' }} />
      </button>

      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[60] rounded-lg border shadow-lg overflow-hidden dropdown-animate"
          style={{
            top: pos.top, left: pos.left, width: pos.width,
            backgroundColor: 'var(--surface-0)',
            borderColor: 'var(--line)',
          }}
        >
          <div className="relative border-b" style={{ borderColor: 'var(--line)' }}>
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Type letters to narrow… (↑↓ Enter)"
              className="w-full pl-9 pr-3 py-2 text-sm bg-transparent focus:outline-none"
              style={{ color: 'var(--ink)' }}
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {/* "None" option to clear */}
            {(value || query === '') && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); commit(null) }}
                className="w-full text-left px-3 py-1.5 text-sm transition-colors"
                style={{ color: 'var(--ink-3)', fontStyle: 'italic' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                — None —
              </button>
            )}
            {recentParties.length > 0 && (
              <>
                <BandLabel>Recent</BandLabel>
                {recentParties.map((p, i) => (
                  <PartyRow
                    key={`r-${p.id}`}
                    party={p}
                    selected={value === p.id}
                    highlighted={i === highlight}
                    onSelect={() => commit(p)}
                  />
                ))}
                {filtered.length > 0 && <div className="border-t my-0.5" style={{ borderColor: 'var(--line)' }} />}
              </>
            )}
            {(query ? filtered : filtered.filter((p) => !recentIds.includes(p.id))).map((p, i) => {
              const idx = (recentParties.length || 0) + i
              return (
                <PartyRow
                  key={p.id}
                  party={p}
                  selected={value === p.id}
                  highlighted={idx === highlight}
                  onSelect={() => commit(p)}
                />
              )
            })}
            {navList.length === 0 && (
              <div className="text-center py-6 text-xs" style={{ color: 'var(--ink-3)' }}>No matching parties</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

function BandLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1 mono text-[10px] uppercase tracking-wider"
      style={{ color: 'var(--ink-3)' }}
    >
      <History size={10} />
      {children}
    </div>
  )
}

function PartyRow({ party, selected, highlighted, onSelect }: {
  party: Party
  selected: boolean
  highlighted: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onSelect() }}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors"
      style={{
        backgroundColor: highlighted ? 'rgba(15,157,154,0.10)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!highlighted) e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)'
      }}
      onMouseLeave={(e) => {
        if (!highlighted) e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      <span className="flex-1 truncate" style={{ color: 'var(--ink)' }}>{party.name}</span>
      {selected && <Check size={14} className="flex-shrink-0" style={{ color: 'var(--brand)' }} />}
    </button>
  )
}

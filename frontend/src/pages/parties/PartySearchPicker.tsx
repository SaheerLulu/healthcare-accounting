import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  /** Accessible name for the trigger when the surrounding <Field> label is not
   *  programmatically associated with it. */
  ariaLabel?: string
}

export function PartySearchPicker({ parties, value, onChange, storageKey, placeholder, disabled, ariaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [recentIds, setRecentIds] = useState<number[]>(() => readRecent(storageKey))
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  // Stable ids so the rows can be addressed by aria-activedescendant: the
  // search box keeps focus while ↑↓ move the highlight, so that attribute is
  // the only way a screen reader learns which party is currently selected.
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const optionId = (idx: number) => `${baseId}-opt-${idx}`

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

  /** The non-recent band, i.e. everything the "Recent" group does not already show. */
  const rest = useMemo(() => {
    if (query) return filtered
    const recentSet = new Set(recentParties.map((p) => p.id))
    return filtered.filter((p) => !recentSet.has(p.id))
  }, [filtered, recentParties, query])

  const showNone = !!value || query === ''

  /**
   * One array in exact render order — including the "— None —" row, which was
   * previously mouse-only: with no entry in the nav list there was no keyboard
   * route to clearing a party once one had been picked.
   */
  const options = useMemo<(Party | null)[]>(
    () => [...(showNone ? [null] : []), ...recentParties, ...rest],
    [showNone, recentParties, rest]
  )
  // Where the parties start — "None" is skipped on open so a reflexive Enter
  // still picks the first party rather than clearing the field.
  const firstPartyIndex = showNone ? 1 : 0

  useEffect(() => {
    setHighlight(Math.min(firstPartyIndex, Math.max(0, options.length - 1)))
  }, [query, open, firstPartyIndex, options.length])

  // Keep the highlighted row inside the scroll pane — the list is capped at
  // max-h-64, so without this the highlight walks out of sight.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight, options.length])

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    function recalc() {
      const r = triggerRef.current?.getBoundingClientRect()
      if (!r) return
      // The 280px floor overhangs the right edge on a phone, so the panel is
      // held inside a 12px gutter instead of being pushed off-screen. On wide
      // viewports neither clamp ever bites and the panel tracks the trigger.
      const gutter = 12
      const width = Math.min(Math.max(r.width, 280), window.innerWidth - gutter * 2)
      const left = Math.max(gutter, Math.min(r.left, window.innerWidth - gutter - width))
      setPos({ top: r.bottom + 4, left, width })
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

  /**
   * Close and hand focus back to the trigger. Closing unmounts the portal that
   * holds the focused search box, so without this focus lands on <body> and the
   * next Tab restarts at the top of the document instead of continuing to the
   * next field of the voucher.
   */
  function closePicker() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function commit(p: Party | null) {
    if (!p) {
      onChange('')
      setQuery('')
      closePicker()
      return
    }
    onChange(p.id)
    setQuery('')
    setRecentIds((prev) => {
      const next = [p.id, ...prev.filter((id) => id !== p.id)].slice(0, RECENT_MAX)
      writeRecent(storageKey, next)
      return next
    })
    closePicker()
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      // The panel is portalled to document.body, so without this the same
      // keypress also reaches the page-level Escape handler behind it.
      e.stopPropagation()
      closePicker()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, options.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      setHighlight(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      setHighlight(Math.max(0, options.length - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (highlight < 0 || highlight >= options.length) return
      commit(options[highlight])
    }
  }

  /** ArrowDown / ArrowUp open the list; a printable key opens and filters. */
  function onTriggerKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (open || disabled) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setQuery('')
      setOpen(true)
      return
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      // Type-to-search: the first letter both opens the list and narrows it.
      e.preventDefault()
      setQuery(e.key)
      setOpen(true)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
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
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            closePicker()
          }}
          className="fixed z-[60] max-w-[calc(100vw-1.5rem)] rounded-lg border shadow-lg overflow-hidden dropdown-animate"
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
              aria-label={ariaLabel || placeholder || 'Search parties'}
              role="combobox"
              aria-expanded
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-activedescendant={highlight < options.length ? optionId(highlight) : undefined}
              className="w-full pl-9 pr-3 py-2 text-sm bg-transparent focus:outline-none"
              style={{ color: 'var(--ink)' }}
            />
          </div>
          <div ref={listRef} id={listboxId} role="listbox" aria-label="Parties" className="max-h-64 overflow-y-auto">
            {/* "None" option to clear */}
            {showNone && (
              <button
                id={optionId(0)}
                data-idx={0}
                type="button"
                role="option"
                aria-selected={!value}
                tabIndex={-1}
                // onClick, not onMouseDown: it answers Enter and Space too, so
                // the row works for the keyboard as well as the pointer. The
                // mousedown default is suppressed only to stop the search box
                // blurring out from under the click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(null)}
                className="w-full text-left px-3 py-2 sm:py-1.5 text-sm transition-colors"
                style={{
                  color: 'var(--ink-3)',
                  fontStyle: 'italic',
                  backgroundColor: highlight === 0 ? 'rgba(15,157,154,0.10)' : 'transparent',
                }}
                onMouseEnter={(e) => { if (highlight !== 0) e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)' }}
                onMouseLeave={(e) => { if (highlight !== 0) e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                — None —
              </button>
            )}
            {recentParties.length > 0 && (
              <>
                <BandLabel>Recent</BandLabel>
                {recentParties.map((p, i) => {
                  const idx = firstPartyIndex + i
                  return (
                    <PartyRow
                      key={`r-${p.id}`}
                      id={optionId(idx)}
                      idx={idx}
                      party={p}
                      selected={value === p.id}
                      highlighted={idx === highlight}
                      onSelect={() => commit(p)}
                    />
                  )
                })}
                {rest.length > 0 && <div className="border-t my-0.5" style={{ borderColor: 'var(--line)' }} />}
              </>
            )}
            {rest.map((p, i) => {
              const idx = firstPartyIndex + recentParties.length + i
              return (
                <PartyRow
                  key={p.id}
                  id={optionId(idx)}
                  idx={idx}
                  party={p}
                  selected={value === p.id}
                  highlighted={idx === highlight}
                  onSelect={() => commit(p)}
                />
              )
            })}
            {recentParties.length + rest.length === 0 && (
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

function PartyRow({ id, idx, party, selected, highlighted, onSelect }: {
  id: string
  idx: number
  party: Party
  selected: boolean
  highlighted: boolean
  onSelect: () => void
}) {
  return (
    <button
      id={id}
      data-idx={idx}
      type="button"
      role="option"
      aria-selected={selected}
      // The search box stays the only tab stop in the panel — ↑↓ + Enter are
      // the whole contract, and Tab should leave the panel rather than walk
      // every party in the ledger.
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      className="w-full flex items-center gap-2 px-3 py-2 sm:py-1.5 text-sm text-left transition-colors"
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

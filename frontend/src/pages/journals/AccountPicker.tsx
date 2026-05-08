import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, Check, History, Plus, type LucideIcon } from 'lucide-react'
import type { Account } from '../../lib/api'
import { cn } from '../../lib/utils'

const TYPE_DOT: Record<string, string> = {
  ASSET: 'bg-sky-500',
  LIABILITY: 'bg-rose-500',
  EQUITY: 'bg-violet-500',
  REVENUE: 'bg-emerald-500',
  EXPENSE: 'bg-amber-500',
}

const RECENT_KEY = 'accountpicker.recent'
const RECENT_MAX = 5

function readRecent(): number[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'number') : []
  } catch {
    return []
  }
}

function writeRecent(ids: number[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_MAX)))
  } catch { /* ignore */ }
}

export function AccountPicker({
  accounts, value, onChange, disabled, onAltC,
}: {
  accounts: Account[]
  value: number | null
  onChange: (id: number) => void
  disabled?: boolean
  /** Optional: bubbles Alt+C from inside the dropdown so parent can open
   *  a "create ledger" modal without losing voucher state. */
  onAltC?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [recentIds, setRecentIds] = useState<number[]>(readRecent)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  const selected = useMemo(
    () => accounts.find((a) => a.id === value) || null,
    [accounts, value]
  )

  // Eligible = active leaves only.
  const eligible = useMemo(
    () => accounts.filter((a) =>
      a.is_active !== false && (a.children == null || a.children.length === 0 || a.is_leaf)
    ),
    [accounts]
  )

  // Sort: prefix matches first (alphabetical), then substring matches.
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return eligible
    const prefix: Account[] = []
    const sub: Account[] = []
    for (const a of eligible) {
      const name = a.account_name.toLowerCase()
      const code = a.account_code.toLowerCase()
      if (name.startsWith(q) || code.startsWith(q)) prefix.push(a)
      else if (name.includes(q) || code.includes(q)) sub.push(a)
    }
    return [...prefix, ...sub]
  }, [eligible, query])

  // Recent accounts band — only when query is empty.
  const recentAccounts = useMemo(() => {
    if (query) return []
    const map = new Map(eligible.map((a) => [a.id, a]))
    const out: Account[] = []
    for (const id of recentIds) {
      const a = map.get(id)
      if (a) out.push(a)
    }
    return out
  }, [eligible, recentIds, query])

  // Combined list for keyboard navigation: recent first, then filtered (deduped).
  const navList = useMemo(() => {
    if (query) return filtered
    const recentSet = new Set(recentAccounts.map((a) => a.id))
    return [...recentAccounts, ...filtered.filter((a) => !recentSet.has(a.id))]
  }, [recentAccounts, filtered, query])

  // Reset highlight when navList changes.
  useEffect(() => { setHighlight(0) }, [query, open])

  // Compute viewport-anchored position whenever the dropdown is open.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    function recalc() {
      const r = triggerRef.current?.getBoundingClientRect()
      if (!r) return
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    recalc()
    window.addEventListener('scroll', recalc, true)
    window.addEventListener('resize', recalc)
    return () => {
      window.removeEventListener('scroll', recalc, true)
      window.removeEventListener('resize', recalc)
    }
  }, [open])

  // Outside-click + escape close.
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      // Alt+C bubbles to the parent so it can open a Create Ledger modal.
      if (onAltC && e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        onAltC()
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [open, onAltC])

  function commitSelection(a: Account) {
    onChange(a.id)
    setOpen(false)
    setQuery('')
    setRecentIds((prev) => {
      const next = [a.id, ...prev.filter((id) => id !== a.id)].slice(0, RECENT_MAX)
      writeRecent(next)
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
      const a = navList[highlight]
      if (a) commitSelection(a)
      return
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
          <span className="flex items-center gap-2 min-w-0">
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', TYPE_DOT[selected.account_type])} />
            <span className="truncate" style={{ color: 'var(--ink)' }}>{selected.account_name}</span>
            <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--ink-3)' }}>{selected.account_code}</span>
          </span>
        ) : (
          <span style={{ color: 'var(--ink-3)' }}>Select ledger…</span>
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
          <div className="max-h-72 overflow-y-auto">
            {recentAccounts.length > 0 && (
              <>
                <BandLabel icon={History}>Recent</BandLabel>
                {recentAccounts.map((a, i) => (
                  <Row
                    key={`r-${a.id}`}
                    account={a}
                    selected={value === a.id}
                    highlighted={i === highlight}
                    onSelect={() => commitSelection(a)}
                  />
                ))}
                {filtered.length > 0 && (
                  <div className="border-t my-0.5" style={{ borderColor: 'var(--line)' }} />
                )}
              </>
            )}
            {(query ? filtered : filtered.filter((a) => !recentIds.includes(a.id))).map((a, i) => {
              const idx = (recentAccounts.length || 0) + i
              return (
                <Row
                  key={a.id}
                  account={a}
                  selected={value === a.id}
                  highlighted={idx === highlight}
                  onSelect={() => commitSelection(a)}
                />
              )
            })}
            {navList.length === 0 && (
              <div className="text-center py-6 text-xs" style={{ color: 'var(--ink-3)' }}>
                {accounts.length === 0
                  ? 'No accounts available'
                  : query
                    ? 'No matching accounts'
                    : 'No active leaf accounts of this type'}
              </div>
            )}
          </div>
          {onAltC && (
            <div
              className="border-t px-3 py-1.5 flex items-center justify-between"
              style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface-1)' }}
            >
              <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                Press <kbd className="mono font-semibold" style={{ color: 'var(--brand)' }}>Alt+C</kbd> to create a new ledger
              </span>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setOpen(false); onAltC() }}
                className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
                style={{ color: 'var(--brand)' }}
              >
                <Plus size={11} /> New
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}

function BandLabel({ icon: Icon, children }: {
  icon: LucideIcon
  children: React.ReactNode
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1 mono text-[10px] uppercase tracking-wider"
      style={{ color: 'var(--ink-3)' }}
    >
      <Icon size={10} />
      {children}
    </div>
  )
}

function Row({ account, selected, highlighted, onSelect }: {
  account: Account
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
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', TYPE_DOT[account.account_type])} />
      <span className="font-mono text-xs w-14 flex-shrink-0" style={{ color: 'var(--ink-3)' }}>{account.account_code}</span>
      <span className="flex-1 truncate" style={{ color: 'var(--ink)' }}>{account.account_name}</span>
      <span className="text-[10px] uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--ink-3)' }}>{account.account_type}</span>
      {selected && <Check size={14} className="flex-shrink-0" style={{ color: 'var(--brand)' }} />}
    </button>
  )
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, Check } from 'lucide-react'
import type { Account } from '../../lib/api'
import { cn } from '../../lib/utils'

const TYPE_DOT: Record<string, string> = {
  ASSET: 'bg-sky-500',
  LIABILITY: 'bg-rose-500',
  EQUITY: 'bg-violet-500',
  REVENUE: 'bg-emerald-500',
  EXPENSE: 'bg-amber-500',
}

export function AccountPicker({
  accounts, value, onChange, disabled,
}: {
  accounts: Account[]
  value: number | null
  onChange: (id: number) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  const selected = useMemo(
    () => accounts.find((a) => a.id === value) || null,
    [accounts, value]
  )

  const filtered = useMemo(() => {
    const lower = query.toLowerCase()
    const eligible = accounts.filter((a) =>
      a.is_active !== false && (!a.children || a.children.length === 0 || a.is_leaf)
    )
    if (!lower) return eligible
    return eligible.filter((a) =>
      a.account_name.toLowerCase().includes(lower) ||
      a.account_code.toLowerCase().includes(lower)
    )
  }, [accounts, query])

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

  useEffect(() => {
    if (!open) return
    // Defer focus so the portal node mounts before we move focus into it.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border rounded-lg bg-white text-left',
          'hover:border-slate-300 transition-colors',
          open ? 'border-teal-500 ring-2 ring-teal-100' : 'border-slate-200',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', TYPE_DOT[selected.account_type])} />
            <span className="truncate text-slate-900">{selected.account_name}</span>
            <span className="text-xs text-slate-400 font-mono flex-shrink-0">{selected.account_code}</span>
          </span>
        ) : (
          <span className="text-slate-400">Select an account…</span>
        )}
        <ChevronDown size={14} className={cn('text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[60] rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden dropdown-animate"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="relative border-b border-slate-100">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search accounts by name or code…"
              className="w-full pl-9 pr-3 py-2 text-sm focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400">
                {accounts.length === 0
                  ? 'No accounts available'
                  : query
                    ? 'No matching accounts'
                    : 'No active leaf accounts of this type'}
              </div>
            ) : filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { onChange(a.id); setOpen(false); setQuery('') }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 text-left',
                  value === a.id && 'bg-teal-50'
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', TYPE_DOT[a.account_type])} />
                <span className="font-mono text-xs text-slate-400 w-14 flex-shrink-0">{a.account_code}</span>
                <span className="flex-1 truncate text-slate-900">{a.account_name}</span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wide flex-shrink-0">{a.account_type}</span>
                {value === a.id && <Check size={14} className="text-teal-600 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

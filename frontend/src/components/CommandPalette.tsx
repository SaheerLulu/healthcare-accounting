import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { Search, ArrowRight, Receipt, BookOpen, FileBarChart, History } from 'lucide-react'
import { getJournalEntries, type JournalEntry } from '../lib/api'
import { voucherList } from '../pages/vouchers/voucherConfig'
import { useHotkeys, type HotkeyHandler } from '../contexts/HotkeyContext'

interface Item {
  id: string
  label: string
  hint?: string
  badge?: string
  group: 'voucher' | 'report' | 'master' | 'recent'
  to: string
}

const STATIC: Item[] = [
  ...voucherList.map((v): Item => ({
    id: `voucher-${v.type}`,
    label: `${v.label} Voucher`,
    hint: v.description,
    badge: v.fKey,
    group: 'voucher',
    to: v.routePath,
  })),
  { id: 'rep-daybook', label: 'Day Book', group: 'report', to: '/reports/daybook' },
  { id: 'rep-trial', label: 'Trial Balance', group: 'report', to: '/reports/trial-balance' },
  { id: 'rep-pl', label: 'Profit & Loss', group: 'report', to: '/reports/profit-loss' },
  { id: 'rep-bs', label: 'Balance Sheet', group: 'report', to: '/reports/balance-sheet' },
  { id: 'rep-recv', label: 'Outstanding Receivables', group: 'report', to: '/receivables' },
  { id: 'rep-pay', label: 'Outstanding Payables', group: 'report', to: '/payables' },
  { id: 'rep-cash', label: 'Cash Book', group: 'report', to: '/reports/cash-book' },
  { id: 'rep-bank', label: 'Bank Book', group: 'report', to: '/reports/bank-book' },
  { id: 'rep-gst', label: 'GST Computation', group: 'report', to: '/reports/gst-computation' },
  { id: 'rep-hsn', label: 'HSN Summary', group: 'report', to: '/reports/hsn-summary' },
  { id: 'rep-stock', label: 'Stock Summary', group: 'report', to: '/reports/stock-summary' },
  { id: 'mst-coa', label: 'Chart of Accounts', group: 'master', to: '/accounts' },
  { id: 'mst-sup', label: 'Suppliers', group: 'master', to: '/parties/suppliers' },
  { id: 'mst-cust', label: 'Customers', group: 'master', to: '/parties/customers' },
  { id: 'mst-bank', label: 'Bank Accounts', group: 'master', to: '/banking' },
  { id: 'mst-asset', label: 'Fixed Assets', group: 'master', to: '/fixed-assets' },
  { id: 'mst-loan', label: 'Loans & EMI', group: 'master', to: '/loans' },
  { id: 'mst-cheq', label: 'Cheques', group: 'master', to: '/banking/cheques' },
  { id: 'mst-petty', label: 'Petty Cash', group: 'master', to: '/banking/petty-cash' },
]

const GROUP_LABEL: Record<Item['group'], string> = {
  voucher: 'Vouchers',
  report: 'Reports',
  master: 'Masters',
  recent: 'Recent',
}
const GROUP_ICON: Record<Item['group'], typeof Receipt> = {
  voucher: Receipt,
  report: FileBarChart,
  master: BookOpen,
  recent: History,
}

const voucherLabel = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

export function CommandPalette() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [recents, setRecents] = useState<Item[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Open palette on Ctrl+K
  const handlers = useMemo<HotkeyHandler[]>(() => [
    { chord: 'Ctrl+K', preventDefault: true, handler: () => setOpen(true) },
  ], [])
  useHotkeys(handlers)

  // Lazy-load recents when opening.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setHighlight(0)
    let cancelled = false
    getJournalEntries({ is_posted: 'true' })
      .then((res) => {
        if (cancelled) return
        const recent: Item[] = (res.results || []).slice(0, 5).map((e: JournalEntry) => ({
          id: `recent-${e.id}`,
          label: e.narration || e.entry_no,
          hint: `${voucherLabel(e.voucher_type)} · ${e.date}`,
          group: 'recent',
          to: `/journals/${e.id}`,
        }))
        setRecents(recent)
      })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 50)
      return () => window.clearTimeout(id)
    }
  }, [open])

  // Filter logic: prefix-match first, then substring. Recents only when no query.
  const filtered = useMemo<Item[]>(() => {
    const q = query.toLowerCase().trim()
    const pool = q ? STATIC : [...recents, ...STATIC]
    if (!q) return pool
    const prefix: Item[] = []
    const sub: Item[] = []
    for (const it of pool) {
      const l = it.label.toLowerCase()
      if (l.startsWith(q)) prefix.push(it)
      else if (l.includes(q) || (it.hint && it.hint.toLowerCase().includes(q))) sub.push(it)
    }
    return [...prefix, ...sub]
  }, [query, recents])

  // Reset highlight as filter changes.
  useEffect(() => { setHighlight(0) }, [query, open])

  const commit = useCallback((it: Item) => {
    navigate(it.to)
    setOpen(false)
  }, [navigate])

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = filtered[highlight]
      if (it) commit(it)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Group rows for display, preserving filtered order within groups.
  const groups: { label: string; items: Item[]; offset: number }[] = []
  if (filtered.length > 0) {
    const seen: Record<Item['group'], Item[]> = { voucher: [], report: [], master: [], recent: [] }
    for (const it of filtered) seen[it.group].push(it)
    let offset = 0
    const order: Item['group'][] = ['recent', 'voucher', 'report', 'master']
    for (const g of order) {
      if (seen[g].length === 0) continue
      groups.push({ label: GROUP_LABEL[g], items: seen[g], offset })
      offset += seen[g].length
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 animate-fadeIn"
          style={{ background: 'rgba(12,30,37,0.45)' }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-[18vh] z-50 w-[92vw] max-w-2xl -translate-x-1/2 rounded-xl overflow-hidden animate-slideUp"
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--line)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.20)',
          }}
        >
          <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
          <div className="relative border-b" style={{ borderColor: 'var(--line)' }}>
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Type to search vouchers, reports, masters…"
              className="w-full pl-11 pr-4 py-3.5 bg-transparent text-sm focus:outline-none"
              style={{ color: 'var(--ink)' }}
            />
            <kbd
              className="absolute right-4 top-1/2 -translate-y-1/2 mono text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--line)', color: 'var(--ink-3)' }}
            >
              Esc
            </kbd>
          </div>
          <div className="max-h-[55vh] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
                No matches
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.label}>
                  <div
                    className="px-4 py-1.5 mono text-[10px] uppercase tracking-wider flex items-center gap-1.5"
                    style={{ color: 'var(--ink-3)', background: 'var(--surface-1)' }}
                  >
                    {(() => { const Icon = GROUP_ICON[g.items[0].group]; return <Icon size={10} /> })()}
                    {g.label}
                  </div>
                  {g.items.map((it, i) => {
                    const idx = g.offset + i
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onMouseEnter={() => setHighlight(idx)}
                        onMouseDown={(e) => { e.preventDefault(); commit(it) }}
                        className="w-full px-4 py-2 flex items-center gap-3 text-sm text-left"
                        style={{
                          background: idx === highlight ? 'rgba(15,157,154,0.08)' : 'transparent',
                          color: 'var(--ink)',
                        }}
                      >
                        <span className="flex-1 truncate">{it.label}</span>
                        {it.hint && (
                          <span className="text-xs truncate" style={{ color: 'var(--ink-3)' }}>
                            {it.hint}
                          </span>
                        )}
                        {it.badge && (
                          <span
                            className="mono text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{
                              background: 'rgba(15,157,154,0.10)',
                              color: 'var(--brand)',
                              border: '1px solid rgba(15,157,154,0.20)',
                            }}
                          >
                            {it.badge}
                          </span>
                        )}
                        {idx === highlight && (
                          <ArrowRight size={12} style={{ color: 'var(--brand)' }} />
                        )}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
          <div
            className="px-4 py-2 flex items-center gap-3 text-[11px] border-t"
            style={{ background: 'var(--surface-1)', color: 'var(--ink-3)', borderColor: 'var(--line)' }}
          >
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>Esc close</span>
            <span className="ml-auto">
              <kbd className="mono font-semibold" style={{ color: 'var(--brand)' }}>Ctrl+K</kbd> to reopen
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

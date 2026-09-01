import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, ChevronDown, ChevronRight, Filter, Landmark, Banknote } from 'lucide-react'
import { toast } from 'sonner'
import { getDaybook, type DaybookDay, type DaybookEntry } from '../../lib/api'
import { formatCurrency, formatDate, cn } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'
import { usePageKeyboard, type PageAction } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'
import { voucherList } from '../vouchers/voucherConfig'

const voucherLabel = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * The entry strip holds its own buttons (the voucher number, "Open voucher").
 * Enter on one of those is the button's business — without this guard the key
 * would also bubble to the row and toggle the drill-down behind it.
 */
function rowKeys(handler: (e: ReactKeyboardEvent) => void) {
  return (e: ReactKeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target !== e.currentTarget) {
      if ((e.target as HTMLElement).closest('button, a')) return
    }
    handler(e)
  }
}

const VOUCHER_BG: Record<string, string> = {
  JOURNAL: 'bg-slate-100 text-slate-700',
  PURCHASE: 'bg-amber-50 text-amber-700',
  SALE: 'bg-emerald-50 text-emerald-700',
  PAYMENT: 'bg-rose-50 text-rose-700',
  RECEIPT: 'bg-sky-50 text-sky-700',
  CONTRA: 'bg-violet-50 text-violet-700',
  CREDIT_NOTE: 'bg-emerald-50 text-emerald-700',
  DEBIT_NOTE: 'bg-amber-50 text-amber-700',
}

/**
 * The one definition of the Day Book's columns.
 *
 * The header strip, every entry row and the expanded drill-down all lay out
 * on these tracks. They used to be three separate flex rows whose widths were
 * typed out by hand and had drifted apart, which is what threw 'via' and
 * 'narration' out of line with their headings.
 *
 * Tracks: 1 chevron · 2 entry no · 3 type · 4 via · 5 narration · 6 debit · 7 credit.
 * The drill-down spans 2/6 for the account and lands its amounts on 6 and 7 —
 * update those spans and DAYBOOK_MIN_W below if a column is ever added.
 */
const DAYBOOK_GRID = {
  display: 'grid',
  gridTemplateColumns: '1rem 9rem 6.75rem 6.75rem minmax(10rem, 1fr) 7rem 7rem',
  columnGap: '0.75rem',
  alignItems: 'center',
} as const

// Sum of the fixed tracks + gaps + px-4 + narration's 10rem floor. Below this
// the narration track would win the fight for space and every column right of
// it would slide, so the day block scrolls sideways instead.
const DAYBOOK_MIN_W = '54rem'

/** What useListKeyboardNav hands a row: roving tabindex, role, key handler. */
type ListRowProps = ReturnType<ReturnType<typeof useListKeyboardNav>['rowProps']>

/**
 * Expansion is owned by the page, not the row: the roving cursor runs across
 * every entry of every day, so the page needs to know which entry a chord is
 * on, and a re-filtered list must not carry a stale "open" flag on a row that
 * now shows a different voucher.
 */
function DaybookEntryRow({ entry, expanded, onToggle, rowProps }: {
  entry: DaybookEntry
  expanded: boolean
  onToggle: () => void
  rowProps: ListRowProps
}) {
  const navigate = useNavigate()
  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0)
  const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0)
  // Cash/Bank involvement, surfaced at the header level so money-movement
  // entries are spottable without expanding the lines. Fixed order, so the
  // two badges don't swap places between rows with journal-line order.
  const modes = (['Cash', 'Bank'] as const).filter((m) =>
    entry.lines.some((l) => l.account_subtype === m)
  )

  return (
    <div className="border-b last:border-b-0" style={{ borderColor: 'var(--line)' }}>
      <div
        className="px-4 py-2.5 cursor-pointer transition-colors"
        style={DAYBOOK_GRID}
        onClick={onToggle}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)' }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
        aria-expanded={expanded}
        aria-label={`${entry.entry_no}, ${voucherLabel(entry.voucher_type)}, ${entry.narration || 'no narration'}`}
        {...rowProps}
        onKeyDown={rowKeys(rowProps.onKeyDown)}
      >
        <span style={{ color: 'var(--ink-3)' }}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); navigate(`/journals/${entry.id}`) }}
          className="text-sm font-mono text-left truncate hover:underline"
          style={{ color: 'var(--brand)' }}
        >
          {entry.entry_no}
        </button>
        <span>
          <span
            className={cn(
              'inline-flex px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap',
              VOUCHER_BG[entry.voucher_type] || 'bg-slate-100 text-slate-600'
            )}
          >
            {voucherLabel(entry.voucher_type)}
          </span>
        </span>
        {/* Holds its track open when there are no badges, so an entry that
            touches neither cash nor bank doesn't shift narration left. */}
        <span className="inline-flex gap-1">
          {modes.map((m) => (
            <span
              key={m}
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap',
                m === 'Bank' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'
              )}
              title={`Entry touches a ${m.toLowerCase()} account`}
            >
              {m === 'Bank' ? <Landmark size={10} /> : <Banknote size={10} />}
              {m}
            </span>
          ))}
        </span>
        {/* The source-document chip rides inside the narration cell rather than
            sitting beside it as an eighth, unheaded column — that stray item is
            what used to move narration's right edge from row to row. min-w-0 is
            load-bearing: a grid item's automatic minimum is its content, so
            without it the narration refuses to shrink and pushes the amounts. */}
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-sm truncate" title={entry.narration || undefined} style={{ color: 'var(--ink)' }}>
            {entry.narration || '—'}
          </span>
          {entry.reference_type ? (
            <span
              className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 whitespace-nowrap flex-shrink-0"
              style={{ color: 'var(--ink-2)' }}
              title="Pharmacy source document this entry was generated from"
            >
              {entry.reference_type}{entry.reference_id ? ` #${entry.reference_id}` : ''}
            </span>
          ) : null}
        </span>
        <span className="text-sm font-mono text-right" style={{ color: 'var(--ink)' }}>{formatCurrency(totalDebit)}</span>
        <span className="text-sm font-mono text-right" style={{ color: 'var(--ink)' }}>{formatCurrency(totalCredit)}</span>
      </div>
      {expanded && (
        <div className="pb-3" style={{ background: 'var(--surface-1)' }}>
          {/* Laid out on the same tracks as the row above, so each line's debit
              and credit sit directly under the entry's totals. It used to be a
              separate auto-layout table indented by px-12, which lined up with
              nothing — and carried its own scroll rail nested inside the day's. */}
          <div className="px-4 pt-1.5 text-[11px]" style={{ ...DAYBOOK_GRID, color: 'var(--ink-3)' }}>
            <span style={{ gridColumn: '2 / 6' }}>Account</span>
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
          </div>
          {entry.lines.map((line, i) => (
            <div key={i} className="px-4 py-0.5 text-xs" style={DAYBOOK_GRID}>
              <span className="min-w-0 truncate" style={{ gridColumn: '2 / 6', color: 'var(--ink-2)' }}>
                <span className="font-mono mr-2" style={{ color: 'var(--ink-3)' }}>{line.account_code}</span>
                {line.account_name}
              </span>
              <span className="text-right font-mono" style={{ color: 'var(--ink)' }}>
                {Number(line.debit) > 0 ? formatCurrency(line.debit) : '—'}
              </span>
              <span className="text-right font-mono" style={{ color: 'var(--ink)' }}>
                {Number(line.credit) > 0 ? formatCurrency(line.credit) : '—'}
              </span>
            </div>
          ))}
          <div className="flex justify-end mt-2 px-4">
            <button
              type="button"
              onClick={() => navigate(`/journals/${entry.id}`)}
              className="text-xs hover:underline"
              style={{ color: 'var(--brand)' }}
            >
              Open voucher →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DaybookPage() {
  const navigate = useNavigate()
  const today = new Date().toISOString().split('T')[0]
  const [days, setDays] = useState<DaybookDay[]>([])
  const [summary, setSummary] = useState({ total_entries: 0, total_debit: '0.00', total_credit: '0.00' })
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set())
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set())
  const dateFromRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await getDaybook({ start_date: dateFrom, end_date: dateTo })
      setDays(res.days)
      setSummary(res.summary)
      setFetched(true)
    } catch {
      toast.error('Failed to load daybook')
    } finally {
      setLoading(false)
    }
  }

  // Auto-load today on mount.
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])
  // Reload when range changes.
  useEffect(() => {
    if (!fetched) return
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo])

  // Filter days/entries by activeTypes.
  const filteredDays = useMemo(() => {
    if (activeTypes.size === 0) return days
    return days
      .map((d) => ({ ...d, entries: d.entries.filter((e) => activeTypes.has(e.voucher_type)) }))
      .filter((d) => d.entries.length > 0)
  }, [days, activeTypes])

  const filteredSummary = useMemo(() => {
    if (activeTypes.size === 0) return summary
    let entries = 0, dr = 0, cr = 0
    for (const d of filteredDays) {
      for (const e of d.entries) {
        entries++
        for (const l of e.lines) { dr += Number(l.debit); cr += Number(l.credit) }
      }
    }
    return { total_entries: entries, total_debit: dr.toFixed(2), total_credit: cr.toFixed(2) }
  }, [filteredDays, activeTypes, summary])

  function toggleType(type: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  // ─── Keyboard ────────────────────────────────────────────────────────────
  // One flat cursor over every entry of every day: the register reads as a
  // single chronological list, so ↑↓ crossing a day boundary is what a user
  // expects. `flatEntries` is that list; its index is what the roving
  // tabindex and Enter (= toggle the drill-down) address.
  const flatEntries = useMemo(
    () => filteredDays.flatMap((d) => d.entries),
    [filteredDays],
  )

  const toggleEntry = (id: number) => setExpandedEntries((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const list = useListKeyboardNav({
    count: flatEntries.length,
    onActivate: (i) => toggleEntry(flatEntries[i].id),
  })

  // Entries are rendered day by day, so each one needs its position in the
  // flat cursor.
  const entryIndex = useMemo(() => {
    const m = new Map<number, number>()
    flatEntries.forEach((e, i) => m.set(e.id, i))
    return m
  }, [flatEntries])

  // 1–8 keep their existing meaning (toggle a voucher-type filter). Only the
  // first carries a visible hint — eight identical rows would crowd out
  // everything else in the bar, and the chips themselves print their keycap.
  const typeActions: PageAction[] = voucherList.map((v, i) => ({
    chord: String(i + 1),
    label: i === 0 ? 'Filter type (1–8)' : v.label,
    run: () => toggleType(v.type),
    hidden: i > 0,
    allowDefault: true,
  }))

  usePageKeyboard({
    actions: [
      { chord: 'Alt+R', label: 'Refresh', run: load, when: !loading },
      { chord: 'Alt+C', label: 'Clear filters', run: () => setActiveTypes(new Set()), when: activeTypes.size > 0 },
      ...typeActions,
    ],
    searchRef: dateFromRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Day Book</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>
          Chronological register of all transactions · F2 jumps to date · 1–8 toggle voucher filters
        </p>
      </div>

      {/* Date range */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>From</label>
          <Input
            ref={dateFromRef}
            data-autofocus
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full sm:w-auto px-2.5 py-1.5"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full sm:w-auto px-2.5 py-1.5"
          />
        </div>
        <Button variant="secondary" chord="Alt+R" className="w-full sm:w-auto" onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Refresh
        </Button>
      </div>

      {/* Voucher-type chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter size={12} style={{ color: 'var(--ink-3)' }} />
        <span className="text-xs mono uppercase tracking-wider mr-2" style={{ color: 'var(--ink-3)' }}>Filter</span>
        {voucherList.map((v, i) => {
          const active = activeTypes.has(v.type)
          return (
            <button
              key={v.type}
              type="button"
              onClick={() => toggleType(v.type)}
              aria-pressed={active}
              aria-keyshortcuts={String(i + 1)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-xs font-medium transition-colors'
              )}
              style={{
                background: active ? 'rgba(15,157,154,0.12)' : 'var(--surface-0)',
                border: `1px solid ${active ? 'rgba(15,157,154,0.35)' : 'var(--line)'}`,
                color: active ? 'var(--brand)' : 'var(--ink-2)',
              }}
            >
              <kbd
                className="mono text-[9px] font-bold px-1 rounded"
                style={{
                  background: 'var(--surface-1)',
                  color: active ? 'var(--brand)' : 'var(--ink-3)',
                  border: '1px solid var(--line)',
                }}
              >
                {i + 1}
              </kbd>
              {v.label}
            </button>
          )
        })}
        {activeTypes.size > 0 && (
          <button
            type="button"
            onClick={() => setActiveTypes(new Set())}
            aria-keyshortcuts="Alt+C"
            className="text-xs hover:underline ml-1"
            style={{ color: 'var(--ink-2)' }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Filters and the date range rewrite the register while focus stays on
          a chip or a date field, so the result is announced. */}
      <div className="sr-only" role="status" aria-live="polite">
        {loading
          ? 'Loading day book…'
          : fetched
            ? `${filteredSummary.total_entries} entries across ${filteredDays.length} days`
            : ''}
      </div>

      {fetched && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm" style={{ color: 'var(--ink-2)' }}>
          <span>Entries: <span className="font-semibold" style={{ color: 'var(--ink)' }}>{filteredSummary.total_entries}</span></span>
          <span>Total Debit: <span className="font-mono font-semibold" style={{ color: 'var(--ink)' }}>{formatCurrency(filteredSummary.total_debit)}</span></span>
          <span>Total Credit: <span className="font-mono font-semibold" style={{ color: 'var(--ink)' }}>{formatCurrency(filteredSummary.total_credit)}</span></span>
        </div>
      )}

      {loading && days.length === 0 && (
        <div className="text-center py-12"><Loader2 size={24} className="animate-spin inline" style={{ color: 'var(--brand)' }} /></div>
      )}

      {!loading && fetched && filteredDays.length === 0 && (
        <Card className="p-8 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
          {activeTypes.size > 0
            ? 'No transactions match the selected voucher types in this range'
            : 'No transactions in the selected period'}
        </Card>
      )}

      {/* Focus moves through every entry of every day, so the whole stack is
          one keyboard list — the container ref has to sit above the days. */}
      <div className="space-y-5" {...list.containerProps}>
      {filteredDays.map((day) => (
        <Card key={day.date} className="overflow-hidden p-0">
          {/* The entry rows are a fixed column grid — debit/credit have to line
              up down the day — so narrow viewports scroll it sideways rather
              than crushing the columns. */}
          <div className="table-scroll">
            <div className="daybook-grid" style={{ minWidth: DAYBOOK_MIN_W }}>
              <div className="px-4 py-2.5 border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{formatDate(day.date)}</span>
                  <Badge variant="default" className="text-xs">
                    {day.entries.length} {day.entries.length === 1 ? 'entry' : 'entries'}
                  </Badge>
                </div>
                {/* Same tracks as the rows below — the labels no longer carry
                    their own widths, so they cannot drift out of step with the
                    cells. pl-2 / pl-1.5 match the padding inside the pills, so
                    each heading sits over its value's first letter. */}
                <div className="mt-1.5 text-[11px]" style={{ ...DAYBOOK_GRID, color: 'var(--ink-3)' }}>
                  <span />
                  <span>Entry No</span>
                  <span className="pl-2">Type</span>
                  <span className="pl-1.5">Via</span>
                  <span>Narration</span>
                  <span className="text-right">Debit</span>
                  <span className="text-right">Credit</span>
                </div>
              </div>
              {day.entries.map((entry) => (
                <DaybookEntryRow
                  key={entry.id}
                  entry={entry}
                  expanded={expandedEntries.has(entry.id)}
                  onToggle={() => toggleEntry(entry.id)}
                  rowProps={list.rowProps(entryIndex.get(entry.id) ?? 0)}
                />
              ))}
            </div>
          </div>
        </Card>
      ))}
      </div>
    </div>
  )
}

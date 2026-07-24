import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, ChevronDown, ChevronRight, Filter, Landmark, Banknote } from 'lucide-react'
import { toast } from 'sonner'
import { getDaybook, type DaybookDay, type DaybookEntry } from '../../lib/api'
import { formatCurrency, formatDate, cn } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'
import { useHintRegister, useHotkeys, type HotkeyHandler } from '../../contexts/HotkeyContext'
import { voucherList } from '../vouchers/voucherConfig'

const voucherLabel = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

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

function DaybookEntryRow({ entry }: { entry: DaybookEntry }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0)
  const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0)
  // Cash/Bank involvement, surfaced at the header level so money-movement
  // entries are spottable without expanding the lines.
  const modes = [...new Set(entry.lines.map((l) => l.account_subtype).filter((s) => s === 'Cash' || s === 'Bank'))] as string[]

  return (
    <div className="border-b last:border-b-0" style={{ borderColor: 'var(--line)' }}>
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
        onClick={() => setExpanded((e) => !e)}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)' }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
      >
        <span style={{ color: 'var(--ink-3)' }}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); navigate(`/journals/${entry.id}`) }}
          className="text-sm font-mono w-36 text-left hover:underline"
          style={{ color: 'var(--brand)' }}
        >
          {entry.entry_no}
        </button>
        <span
          className={cn('inline-flex px-2 py-0.5 rounded text-xs font-medium', VOUCHER_BG[entry.voucher_type] || 'bg-slate-100 text-slate-600')}
          style={{ minWidth: 92, textAlign: 'center' }}
        >
          {voucherLabel(entry.voucher_type)}
        </span>
        <span className="inline-flex gap-1" style={{ minWidth: 48 }}>
          {modes.map((m) => (
            <span
              key={m}
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                m === 'Bank' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'
              )}
              title={`Entry touches a ${m.toLowerCase()} account`}
            >
              {m === 'Bank' ? <Landmark size={10} /> : <Banknote size={10} />}
              {m}
            </span>
          ))}
        </span>
        <span className="text-sm flex-1 truncate" style={{ color: 'var(--ink)' }}>{entry.narration || '—'}</span>
        {entry.reference_type ? (
          <span
            className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100"
            style={{ color: 'var(--ink-2)' }}
            title="Pharmacy source document this entry was generated from"
          >
            {entry.reference_type}{entry.reference_id ? ` #${entry.reference_id}` : ''}
          </span>
        ) : null}
        <span className="text-sm font-mono w-28 text-right" style={{ color: 'var(--ink)' }}>{formatCurrency(totalDebit)}</span>
        <span className="text-sm font-mono w-28 text-right" style={{ color: 'var(--ink)' }}>{formatCurrency(totalCredit)}</span>
      </div>
      {expanded && (
        <div className="px-12 pb-3" style={{ background: 'var(--surface-1)' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: 'var(--ink-2)' }}>
                <th className="text-left pb-1 font-medium pt-1">Account</th>
                <th className="text-right pb-1 font-medium">Debit</th>
                <th className="text-right pb-1 font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line, i) => (
                <tr key={i}>
                  <td className="py-0.5" style={{ color: 'var(--ink-2)' }}>
                    <span className="font-mono mr-2" style={{ color: 'var(--ink-3)' }}>{line.account_code}</span>
                    {line.account_name}
                  </td>
                  <td className="py-0.5 text-right font-mono" style={{ color: 'var(--ink)' }}>
                    {Number(line.debit) > 0 ? formatCurrency(line.debit) : '—'}
                  </td>
                  <td className="py-0.5 text-right font-mono" style={{ color: 'var(--ink)' }}>
                    {Number(line.credit) > 0 ? formatCurrency(line.credit) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end mt-2">
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
  const today = new Date().toISOString().split('T')[0]
  const [days, setDays] = useState<DaybookDay[]>([])
  const [summary, setSummary] = useState({ total_entries: 0, total_debit: '0.00', total_credit: '0.00' })
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set())
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

  // ─── Hotkeys ─────────────────────────────────────────────────────────────
  const handlers = useMemo<HotkeyHandler[]>(() => {
    const list: HotkeyHandler[] = [
      { chord: 'F2', preventDefault: true, handler: () => dateFromRef.current?.focus() },
    ]
    voucherList.forEach((v, i) => {
      list.push({
        chord: String(i + 1),
        preventDefault: false,
        handler: () => toggleType(v.type),
      })
    })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useHotkeys(handlers)

  useHintRegister([
    { chord: 'F2', label: 'Date Range' },
    { chord: '1–8', label: 'Filter Type' },
    { chord: 'Click', label: 'Drill Down' },
  ])

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Day Book</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>
          Chronological register of all transactions · F2 jumps to date · 1–8 toggle voucher filters
        </p>
      </div>

      {/* Date range */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>From</label>
          <Input
            ref={dateFromRef}
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-auto px-2.5 py-1.5"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-auto px-2.5 py-1.5"
          />
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
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
            onClick={() => setActiveTypes(new Set())}
            className="text-xs hover:underline ml-1"
            style={{ color: 'var(--ink-2)' }}
          >
            Clear
          </button>
        )}
      </div>

      {fetched && (
        <div className="flex items-center gap-6 text-sm" style={{ color: 'var(--ink-2)' }}>
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

      {filteredDays.map((day) => (
        <Card key={day.date} className="overflow-hidden p-0">
          <div className="px-4 py-2.5 border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{formatDate(day.date)}</span>
              <Badge variant="default" className="text-xs">
                {day.entries.length} {day.entries.length === 1 ? 'entry' : 'entries'}
              </Badge>
            </div>
            <div className="flex gap-3 mt-1.5 text-[11px]" style={{ color: 'var(--ink-3)' }}>
              <span className="w-4" />
              <span className="w-36">Entry No</span>
              <span style={{ minWidth: 92 }}>Type</span>
              <span style={{ minWidth: 48 }}>Via</span>
              <span className="flex-1">Narration</span>
              <span className="w-28 text-right">Debit</span>
              <span className="w-28 text-right">Credit</span>
            </div>
          </div>
          {day.entries.map((entry) => (
            <DaybookEntryRow key={entry.id} entry={entry} />
          ))}
        </Card>
      ))}
    </div>
  )
}

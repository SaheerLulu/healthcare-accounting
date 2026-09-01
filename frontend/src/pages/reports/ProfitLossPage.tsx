import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getProfitLoss, type PLReport, type PLSection } from '../../lib/api'
import { formatCurrency, getCurrentFY, cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Table, Tbody, Tr, Td } from '../../components/ui/table'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

/** The roving-tabindex props the page hands down to each section's rows. */
type RowProps = ReturnType<typeof useListKeyboardNav>['rowProps']

export default function ProfitLossPage() {
  const navigate = useNavigate()
  const fy = getCurrentFY()
  const [report, setReport] = useState<PLReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [dateFrom, setDateFrom] = useState(fy.start)
  const [dateTo, setDateTo] = useState(fy.end)
  const fromRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await getProfitLoss({ start_date: dateFrom, end_date: dateTo })
      setReport(res)
    } catch {
      toast.error('Failed to load Profit & Loss report')
    } finally {
      setLoading(false)
    }
  }

  const grossProfit = report ? Number(report.gross_profit) : 0
  const netProfit = report ? Number(report.net_profit) : 0
  const otherExpensesShown = report && report.other_expenses.items.length > 0

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // Revenue / Direct / Indirect / Other are four cards but one statement, so
  // they share ONE row cursor: F3 lands on the first row of the report and ↑↓
  // read straight down across the section breaks instead of stopping dead at
  // the end of a card. Tab still steps clean past the whole thing, and Enter
  // drills into that account's ledger.
  const items = useMemo(
    () => (report
      ? [
          ...report.revenue.items,
          ...report.direct_expenses.items,
          ...report.indirect_expenses.items,
          ...report.other_expenses.items,
        ]
      : []),
    [report],
  )
  // Where each section's first row sits in the page-wide cursor.
  const directOffset = report ? report.revenue.items.length : 0
  const indirectOffset = directOffset + (report ? report.direct_expenses.items.length : 0)
  const otherOffset = indirectOffset + (report ? report.indirect_expenses.items.length : 0)

  const openLedger = (code: string) =>
    navigate(`/reports/ledger/${encodeURIComponent(code)}?from=${dateFrom}&to=${dateTo}`)

  const list = useListKeyboardNav({
    count: items.length,
    onActivate: (i) => openLedger(items[i].account_code),
  })

  const hasRows = items.length > 0

  const isDefaultRange = dateFrom === fy.start && dateTo === fy.end
  const resetRange = () => { setDateFrom(fy.start); setDateTo(fy.end) }

  usePageKeyboard({
    actions: [
      { chord: 'Alt+R', label: 'Run report', run: load, when: !loading },
      { chord: 'Alt+C', label: 'Reset period', run: resetRange, when: !isDefaultRange },
    ],
    searchRef: fromRef,
    onFocusList: hasRows ? list.focusList : undefined,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Profit & Loss</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
          Revenue, direct expenses, gross profit, indirect expenses, net profit.
        </p>
      </div>

      {/* Period filters — a form, so Enter in either date runs the report */}
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => { e.preventDefault(); load() }}
      >
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="pl-from" className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>From</label>
          <Input id="pl-from" ref={fromRef} data-autofocus type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-auto" />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="pl-to" className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>To</label>
          <Input id="pl-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-auto" />
        </div>
        <Button type="submit" className="w-full sm:w-auto" disabled={loading} chord="Alt+R">
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
      </form>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--brand)' }} />
        </div>
      )}

      {!loading && !report && (
        <Card className="flex items-center justify-center py-20 text-sm" style={{ color: 'var(--ink-3)' }}>
          Select date range and run report.
        </Card>
      )}

      {!loading && report && (
        <div className="flex flex-col gap-4" {...list.containerProps}>
          {/* Revenue */}
          <Section
            title="Revenue"
            tone="success"
            section={report.revenue}
            totalLabel="Total Revenue"
            emptyLabel="No revenue entries"
            onOpenAccount={openLedger}
            offset={0}
            rowProps={list.rowProps}
          />

          {/* Direct Expenses */}
          <Section
            title="Direct Expenses"
            tone="danger"
            section={report.direct_expenses}
            totalLabel="Total Direct Expenses"
            emptyLabel="No direct expense entries (no COGS or direct-cost postings yet)"
            onOpenAccount={openLedger}
            offset={directOffset}
            rowProps={list.rowProps}
          />

          {/* Gross Profit subtotal */}
          <SubtotalBlock
            label={grossProfit >= 0 ? 'Gross Profit' : 'Gross Loss'}
            sublabel="Revenue − Direct Expenses"
            value={report.gross_profit}
            positive={grossProfit >= 0}
          />

          {/* Indirect Expenses */}
          <Section
            title="Indirect Expenses"
            tone="danger"
            section={report.indirect_expenses}
            totalLabel="Total Indirect Expenses"
            emptyLabel="No indirect expense entries"
            onOpenAccount={openLedger}
            offset={indirectOffset}
            rowProps={list.rowProps}
          />

          {/* Other Expenses — only rendered when there's something to show */}
          {otherExpensesShown && (
            <Section
              title="Other Expenses"
              tone="warning"
              section={report.other_expenses}
              totalLabel="Total Other Expenses"
              emptyLabel=""
              onOpenAccount={openLedger}
              offset={otherOffset}
              rowProps={list.rowProps}
            />
          )}

          {/* Net Profit */}
          <SubtotalBlock
            label={netProfit >= 0 ? 'Net Profit' : 'Net Loss'}
            sublabel={`Gross Profit − Indirect ${otherExpensesShown ? '− Other ' : ''}Expenses`}
            value={report.net_profit}
            positive={netProfit >= 0}
            emphasized
            dateRange={`${report.start_date} → ${report.end_date}`}
          />
        </div>
      )}
    </div>
  )
}

const TONES = {
  success: {
    bg: 'rgba(31,138,76,0.08)',
    border: 'rgba(31,138,76,0.20)',
    color: 'var(--success)',
    footBorder: 'rgba(31,138,76,0.30)',
  },
  danger: {
    bg: 'rgba(192,57,43,0.06)',
    border: 'rgba(192,57,43,0.18)',
    color: 'var(--danger)',
    footBorder: 'rgba(192,57,43,0.30)',
  },
  warning: {
    bg: 'rgba(229,153,40,0.08)',
    border: 'rgba(229,153,40,0.22)',
    color: 'var(--warning)',
    footBorder: 'rgba(229,153,40,0.30)',
  },
} as const

function Section({ title, tone, section, totalLabel, emptyLabel, onOpenAccount, offset, rowProps }: {
  title: string
  tone: keyof typeof TONES
  section: PLSection
  totalLabel: string
  emptyLabel: string
  onOpenAccount: (code: string) => void
  /** Where this section's first row sits in the page-wide row cursor. */
  offset: number
  rowProps: RowProps
}) {
  const t = TONES[tone]

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-5 py-3 border-b" style={{ background: t.bg, borderColor: t.border }}>
        <h2 className="text-sm font-semibold" style={{ color: t.color }}>{title}</h2>
      </div>
      <Table label={title}>
        <Tbody>
          {section.items.map((row, i) => (
            <Tr
              key={i}
              className="cursor-pointer"
              aria-label={`${row.account_code} ${row.account_name}, ${formatCurrency(row.amount)} — open ledger`}
              onClick={() => onOpenAccount(row.account_code)}
              {...rowProps(offset + i)}
            >
              <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>{row.account_code}</Td>
              <Td style={{ color: 'var(--ink-2)' }}>{row.account_name}</Td>
              <Td className="text-right mono" style={{ color: 'var(--ink)' }}>{formatCurrency(row.amount)}</Td>
            </Tr>
          ))}
          {section.items.length === 0 && emptyLabel && (
            <Tr>
              <Td colSpan={3} className="py-6 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
                {emptyLabel}
              </Td>
            </Tr>
          )}
        </Tbody>
        <tfoot>
          <tr style={{ borderTop: `2px solid ${t.footBorder}`, background: t.bg }}>
            <td colSpan={2} className="py-3 px-5 text-sm font-semibold" style={{ color: t.color }}>
              {totalLabel}
            </td>
            <td className="py-3 px-5 text-right mono font-bold" style={{ color: t.color }}>
              {formatCurrency(section.total)}
            </td>
          </tr>
        </tfoot>
      </Table>
    </Card>
  )
}

function SubtotalBlock({ label, sublabel, value, positive, emphasized, dateRange }: {
  label: string
  sublabel: string
  value: string
  positive: boolean
  emphasized?: boolean
  dateRange?: string
}) {
  const fg = positive ? (emphasized ? 'var(--brand)' : 'var(--ink)') : 'var(--danger)'
  const bg = positive
    ? (emphasized ? 'rgba(15,157,154,0.08)' : 'var(--surface-1)')
    : 'rgba(192,57,43,0.06)'
  const border = positive
    ? (emphasized ? 'var(--brand)' : 'var(--line)')
    : 'rgba(192,57,43,0.30)'
  return (
    <div
      className={cn('rounded-xl p-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-0')}
      style={{
        background: bg,
        border: `${emphasized ? '2px' : '1px'} solid ${border}`,
      }}
    >
      <div>
        <p
          className={cn('uppercase mono', emphasized ? 'text-xs font-semibold' : 'text-[11px] font-medium')}
          style={{ color: fg, letterSpacing: emphasized ? '0.1em' : '0.08em' }}
        >
          {label}
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-3)' }}>
          {sublabel}
        </p>
        {dateRange && (
          <p className="text-[10px] mt-0.5 mono" style={{ color: 'var(--ink-3)' }}>
            {dateRange}
          </p>
        )}
      </div>
      <p
        className={cn(emphasized ? 'text-2xl font-bold kpi-value' : 'text-lg font-semibold', 'mono')}
        style={{ color: fg }}
      >
        {formatCurrency(value)}
      </p>
    </div>
  )
}

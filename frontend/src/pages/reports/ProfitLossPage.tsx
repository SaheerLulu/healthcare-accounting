import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getProfitLoss, type PLReport, type PLSection } from '../../lib/api'
import { formatCurrency, getCurrentFY, cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Table, Tbody, Tr, Td } from '../../components/ui/table'

export default function ProfitLossPage() {
  const fy = getCurrentFY()
  const [report, setReport] = useState<PLReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [dateFrom, setDateFrom] = useState(fy.start)
  const [dateTo, setDateTo] = useState(fy.end)

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

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Profit & Loss</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
          Revenue, direct expenses, gross profit, indirect expenses, net profit.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
      </div>

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
        <div className="flex flex-col gap-4">
          {/* Revenue */}
          <Section
            title="Revenue"
            tone="success"
            section={report.revenue}
            totalLabel="Total Revenue"
            emptyLabel="No revenue entries"
          />

          {/* Direct Expenses */}
          <Section
            title="Direct Expenses"
            tone="danger"
            section={report.direct_expenses}
            totalLabel="Total Direct Expenses"
            emptyLabel="No direct expense entries (no COGS or direct-cost postings yet)"
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
          />

          {/* Other Expenses — only rendered when there's something to show */}
          {otherExpensesShown && (
            <Section
              title="Other Expenses"
              tone="warning"
              section={report.other_expenses}
              totalLabel="Total Other Expenses"
              emptyLabel=""
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

function Section({ title, tone, section, totalLabel, emptyLabel }: {
  title: string
  tone: keyof typeof TONES
  section: PLSection
  totalLabel: string
  emptyLabel: string
}) {
  const t = TONES[tone]
  return (
    <Card className="overflow-hidden p-0">
      <div className="px-5 py-3 border-b" style={{ background: t.bg, borderColor: t.border }}>
        <h2 className="text-sm font-semibold" style={{ color: t.color }}>{title}</h2>
      </div>
      <Table>
        <Tbody>
          {section.items.map((row, i) => (
            <Tr key={i}>
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
      className={cn('rounded-xl p-5 flex items-center justify-between')}
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

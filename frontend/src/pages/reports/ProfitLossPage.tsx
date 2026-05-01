import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getProfitLoss, type PLReport } from '../../lib/api'
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

  const netProfit = report ? Number(report.net_profit) : 0

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Profit & Loss</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>Income statement for the selected period.</p>
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
          <Card className="overflow-hidden p-0">
            <div
              className="px-5 py-3 border-b"
              style={{ background: 'rgba(31,138,76,0.08)', borderColor: 'rgba(31,138,76,0.20)' }}
            >
              <h2 className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Revenue</h2>
            </div>
            <Table>
              <Tbody>
                {report.revenue.items.map((row, i) => (
                  <Tr key={i}>
                    <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>{row.account_code}</Td>
                    <Td style={{ color: 'var(--ink-2)' }}>{row.account_name}</Td>
                    <Td className="text-right mono" style={{ color: 'var(--ink)' }}>{formatCurrency(row.amount)}</Td>
                  </Tr>
                ))}
                {report.revenue.items.length === 0 && (
                  <Tr><Td colSpan={3} className="py-6 text-center text-sm" style={{ color: 'var(--ink-3)' }}>No revenue entries</Td></Tr>
                )}
              </Tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid rgba(31,138,76,0.30)', background: 'rgba(31,138,76,0.08)' }}>
                  <td colSpan={2} className="py-3 px-5 text-sm font-semibold" style={{ color: 'var(--success)' }}>Total Revenue</td>
                  <td className="py-3 px-5 text-right mono font-bold" style={{ color: 'var(--success)' }}>{formatCurrency(report.revenue.total)}</td>
                </tr>
              </tfoot>
            </Table>
          </Card>

          {/* Expenses */}
          <Card className="overflow-hidden p-0">
            <div
              className="px-5 py-3 border-b"
              style={{ background: 'rgba(192,57,43,0.06)', borderColor: 'rgba(192,57,43,0.18)' }}
            >
              <h2 className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>Expenses</h2>
            </div>
            <Table>
              <Tbody>
                {report.expenses.items.map((row, i) => (
                  <Tr key={i}>
                    <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>{row.account_code}</Td>
                    <Td style={{ color: 'var(--ink-2)' }}>{row.account_name}</Td>
                    <Td className="text-right mono" style={{ color: 'var(--ink)' }}>{formatCurrency(row.amount)}</Td>
                  </Tr>
                ))}
                {report.expenses.items.length === 0 && (
                  <Tr><Td colSpan={3} className="py-6 text-center text-sm" style={{ color: 'var(--ink-3)' }}>No expense entries</Td></Tr>
                )}
              </Tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid rgba(192,57,43,0.30)', background: 'rgba(192,57,43,0.06)' }}>
                  <td colSpan={2} className="py-3 px-5 text-sm font-semibold" style={{ color: 'var(--danger)' }}>Total Expenses</td>
                  <td className="py-3 px-5 text-right mono font-bold" style={{ color: 'var(--danger)' }}>{formatCurrency(report.expenses.total)}</td>
                </tr>
              </tfoot>
            </Table>
          </Card>

          {/* Net Profit */}
          <div
            className={cn('rounded-xl p-5 flex items-center justify-between')}
            style={{
              background: netProfit >= 0 ? 'rgba(15,157,154,0.08)' : 'rgba(192,57,43,0.06)',
              border: `2px solid ${netProfit >= 0 ? 'var(--brand)' : 'rgba(192,57,43,0.30)'}`,
            }}
          >
            <div>
              <p
                className="text-xs font-semibold uppercase mono"
                style={{
                  color: netProfit >= 0 ? 'var(--brand)' : 'var(--danger)',
                  letterSpacing: '0.1em',
                }}
              >
                {netProfit >= 0 ? 'Net Profit' : 'Net Loss'}
              </p>
              <p className="text-xs mt-0.5 mono" style={{ color: 'var(--ink-3)' }}>
                {report.start_date} → {report.end_date}
              </p>
            </div>
            <p
              className="text-2xl font-bold mono kpi-value"
              style={{ color: netProfit >= 0 ? 'var(--brand)' : 'var(--danger)' }}
            >
              {formatCurrency(report.net_profit)}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

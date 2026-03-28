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
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Profit & Loss</h1>
        <p className="text-sm text-slate-500 mt-0.5">Income statement for the selected period</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="w-auto" />
        </div>
        <Button variant="primary" onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-teal-600" />
        </div>
      )}

      {!loading && !report && (
        <Card className="flex items-center justify-center py-20 text-slate-400 text-sm">
          Select date range and run report
        </Card>
      )}

      {!loading && report && (
        <div className="flex flex-col gap-4">
          {/* Revenue */}
          <Card className="overflow-hidden">
            <div className="px-5 py-3 bg-emerald-50 border-b border-emerald-100">
              <h2 className="text-sm font-semibold text-emerald-800">Revenue</h2>
            </div>
            <Table>
              <Tbody>
                {report.revenue.items.map((row, i) => (
                  <Tr key={i}>
                    <Td className="font-mono text-xs text-slate-500">{row.account_code}</Td>
                    <Td className="text-slate-500">{row.account_name}</Td>
                    <Td className="text-right font-mono text-slate-900">{formatCurrency(row.amount)}</Td>
                  </Tr>
                ))}
                {report.revenue.items.length === 0 && (
                  <Tr><Td colSpan={3} className="py-6 text-center text-slate-400 text-sm">No revenue entries</Td></Tr>
                )}
              </Tbody>
              <tfoot>
                <tr className="border-t-2 border-emerald-200 bg-emerald-50">
                  <td colSpan={2} className="py-3 px-5 text-sm font-semibold text-emerald-800">Total Revenue</td>
                  <td className="py-3 px-5 text-right font-mono font-bold text-emerald-800">{formatCurrency(report.revenue.total)}</td>
                </tr>
              </tfoot>
            </Table>
          </Card>

          {/* Expenses */}
          <Card className="overflow-hidden">
            <div className="px-5 py-3 bg-red-50 border-b border-red-100">
              <h2 className="text-sm font-semibold text-red-800">Expenses</h2>
            </div>
            <Table>
              <Tbody>
                {report.expenses.items.map((row, i) => (
                  <Tr key={i}>
                    <Td className="font-mono text-xs text-slate-500">{row.account_code}</Td>
                    <Td className="text-slate-500">{row.account_name}</Td>
                    <Td className="text-right font-mono text-slate-900">{formatCurrency(row.amount)}</Td>
                  </Tr>
                ))}
                {report.expenses.items.length === 0 && (
                  <Tr><Td colSpan={3} className="py-6 text-center text-slate-400 text-sm">No expense entries</Td></Tr>
                )}
              </Tbody>
              <tfoot>
                <tr className="border-t-2 border-red-200 bg-red-50">
                  <td colSpan={2} className="py-3 px-5 text-sm font-semibold text-red-800">Total Expenses</td>
                  <td className="py-3 px-5 text-right font-mono font-bold text-red-800">{formatCurrency(report.expenses.total)}</td>
                </tr>
              </tfoot>
            </Table>
          </Card>

          {/* Net Profit */}
          <div className={cn(
            'rounded-xl border-2 p-5 flex items-center justify-between',
            netProfit >= 0
              ? 'bg-teal-50 border-teal-600'
              : 'bg-red-50 border-red-200'
          )}>
            <div>
              <p className={cn('text-xs font-semibold uppercase tracking-wide',
                netProfit >= 0 ? 'text-teal-600' : 'text-red-500')}>
                {netProfit >= 0 ? 'Net Profit' : 'Net Loss'}
              </p>
              <p className={cn('text-xs mt-0.5',
                netProfit >= 0 ? 'text-slate-400' : 'text-red-400')}>
                {report.start_date} to {report.end_date}
              </p>
            </div>
            <p className={cn('text-2xl font-bold font-mono',
              netProfit >= 0 ? 'text-teal-600' : 'text-red-700')}>
              {formatCurrency(report.net_profit)}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

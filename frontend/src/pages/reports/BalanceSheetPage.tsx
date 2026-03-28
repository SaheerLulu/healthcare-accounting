import { useState } from 'react'
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { getBalanceSheet, type BSReport, type BSGroupSection } from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card, CardContent } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Table, Tbody, Tr, Td } from '../../components/ui/table'

function Section({
  title,
  section,
  color,
}: {
  title: string
  section: BSGroupSection
  color: 'blue' | 'red' | 'purple'
}) {
  const headerColors = {
    blue: 'bg-blue-50 border-blue-100 text-blue-800',
    red: 'bg-red-50 border-red-100 text-red-800',
    purple: 'bg-purple-50 border-purple-100 text-purple-800',
  }
  const footerColors = {
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    red: 'border-red-200 bg-red-50 text-red-800',
    purple: 'border-purple-200 bg-purple-50 text-purple-800',
  }

  return (
    <Card className="overflow-hidden">
      <div className={`px-5 py-3 border-b ${headerColors[color]}`}>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <Table>
        <Tbody>
          {section.items.map((item, i) => (
            <Tr key={i}>
              <Td className="font-mono text-xs text-slate-500">{item.account_code}</Td>
              <Td className="text-slate-500">{item.account_name}</Td>
              <Td className="text-right font-mono text-slate-900">{formatCurrency(item.balance)}</Td>
            </Tr>
          ))}
          {section.items.length === 0 && (
            <Tr><Td colSpan={3} className="py-6 text-center text-slate-400 text-sm">No entries</Td></Tr>
          )}
        </Tbody>
        <tfoot>
          <tr className={`border-t-2 ${footerColors[color]}`}>
            <td colSpan={2} className="py-3 px-5 text-sm font-semibold">Total {title}</td>
            <td className="py-3 px-5 text-right font-mono font-bold">{formatCurrency(section.total)}</td>
          </tr>
        </tfoot>
      </Table>
    </Card>
  )
}

export default function BalanceSheetPage() {
  const [report, setReport] = useState<BSReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [asOf, setAsOf] = useState(new Date().toISOString().split('T')[0])

  async function load() {
    setLoading(true)
    try {
      const res = await getBalanceSheet({ date: asOf })
      setReport(res)
    } catch {
      toast.error('Failed to load balance sheet')
    } finally {
      setLoading(false)
    }
  }

  const balanced = report ? report.is_balanced : false

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Balance Sheet</h1>
          <p className="text-sm text-slate-500 mt-0.5">Financial position at a point in time</p>
        </div>
        {report && (
          <Badge variant={balanced ? 'success' : 'error'} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold">
            {balanced ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
            {balanced ? 'Balanced' : 'Not Balanced'}
          </Badge>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">As of</label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
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
          Select a date and run report
        </Card>
      )}

      {!loading && report && (
        <div className="flex flex-col gap-4">
          <Section title="Assets" section={report.assets} color="blue" />
          <Section title="Liabilities" section={report.liabilities} color="red" />
          <Section title="Equity" section={report.equity} color="purple" />

          {/* Summary */}
          <Card>
            <CardContent>
              <div className="flex items-center justify-between py-2 border-b border-slate-200">
                <span className="text-sm font-medium text-slate-500">Total Assets</span>
                <span className="font-mono font-semibold text-blue-700">{formatCurrency(report.assets.total)}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-slate-500">Total Liabilities + Equity</span>
                <span className="font-mono font-semibold text-slate-900">{formatCurrency(report.total_liabilities_equity)}</span>
              </div>
              {!balanced && (
                <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle size={12} /> Balance sheet does not balance. Check your entries.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

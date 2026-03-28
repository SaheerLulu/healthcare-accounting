import { useState } from 'react'
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { getTrialBalance, type TrialBalanceRow } from '../../lib/api'
import { formatCurrency, getCurrentFY, cn } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'

export default function TrialBalancePage() {
  const fy = getCurrentFY()
  const [rows, setRows] = useState<TrialBalanceRow[]>([])
  const [totalDebit, setTotalDebit] = useState(0)
  const [totalCredit, setTotalCredit] = useState(0)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(fy.start)
  const [dateTo, setDateTo] = useState(fy.end)

  async function load() {
    setLoading(true)
    try {
      const res = await getTrialBalance({ start_date: dateFrom, end_date: dateTo })
      setRows(res.rows)
      setTotalDebit(Number(res.total_debit))
      setTotalCredit(Number(res.total_credit))
      setFetched(true)
    } catch {
      toast.error('Failed to load trial balance')
    } finally {
      setLoading(false)
    }
  }

  const balanced = Math.abs(totalDebit - totalCredit) < 0.01

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Trial Balance</h1>
          <p className="text-sm text-slate-500 mt-0.5">All accounts with debit and credit balances</p>
        </div>
        {fetched && (
          <Badge variant={balanced ? 'success' : 'error'}>
            {balanced ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
            {balanced ? 'Balanced' : 'Not Balanced'}
          </Badge>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="w-auto px-2.5 py-1.5" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="w-auto px-2.5 py-1.5" />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Account Code</Th>
              <Th className="text-left">Account Name</Th>
              <Th className="text-left">Type</Th>
              <Th className="text-right">Debit</Th>
              <Th className="text-right">Credit</Th>
              <Th className="text-right">Balance</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : !fetched ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">Select date range and run report</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No data found</td></tr>
            ) : (
              rows.map((row, i) => (
                <Tr key={i}>
                  <Td className="font-mono text-xs text-slate-500">{row.account_code}</Td>
                  <Td className="font-medium">{row.account_name}</Td>
                  <Td className="text-slate-500 capitalize">{row.account_type}</Td>
                  <Td className="text-right font-mono">
                    {Number(row.debit) > 0 ? formatCurrency(row.debit) : '-'}
                  </Td>
                  <Td className="text-right font-mono">
                    {Number(row.credit) > 0 ? formatCurrency(row.credit) : '-'}
                  </Td>
                  <Td className={cn("text-right font-mono font-medium",
                    Number(row.balance) >= 0 ? '' : 'text-red-600')}>
                    {formatCurrency(row.balance)}
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
          {fetched && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={3} className="py-3 px-4 text-sm text-slate-500">Totals</td>
                <td className={cn("py-3 px-4 text-right font-mono", balanced ? 'text-slate-900' : 'text-red-600')}>
                  {formatCurrency(totalDebit)}
                </td>
                <td className={cn("py-3 px-4 text-right font-mono", balanced ? 'text-slate-900' : 'text-red-600')}>
                  {formatCurrency(totalCredit)}
                </td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">
                  {formatCurrency(totalDebit - totalCredit)}
                </td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
    </div>
  )
}

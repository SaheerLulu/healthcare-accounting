import { useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { getTrialBalance, type TrialBalanceRow } from '../../lib/api'
import { formatCurrency, getCurrentFY, cn } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { AlertBanner } from '../../components/ui/AlertBanner'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'

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
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Trial Balance</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>All accounts with debit and credit balances.</p>
        </div>
      </div>

      {fetched && (
        <AlertBanner
          tone={balanced ? 'success' : 'danger'}
          title={
            <span className="inline-flex items-center gap-1.5">
              {balanced ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {balanced ? 'Balanced' : 'Not Balanced'}
            </span>
          }
        >
          {balanced
            ? `Debits and credits match at ${formatCurrency(totalDebit)}.`
            : `Difference: ${formatCurrency(totalDebit - totalCredit)} — investigate before relying on these numbers.`}
        </AlertBanner>
      )}

      {/* Period filters */}
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

      {loading ? (
        <SkeletonTable rows={8} cols={6} />
      ) : !fetched ? (
        <EmptyState
          icon={ScrollText}
          title="Run the trial balance"
          description="Select a date range and click Run Report to compute debit / credit totals across the chart of accounts."
          actionLabel="Run Report"
          onAction={load}
        />
      ) : rows.length === 0 ? (
        <EmptyState variant="no-data" title="No data for this range" description="Try widening your date range or post journal entries first." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">Account Code</Th>
                <Th className="text-left">Account Name</Th>
                <Th className="text-left">Type</Th>
                <Th className="text-right">Debit</Th>
                <Th className="text-right">Credit</Th>
                <Th className="text-right">Balance</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row, i) => (
                <Tr key={i}>
                  <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>{row.account_code}</Td>
                  <Td className="font-medium" style={{ color: 'var(--ink)' }}>{row.account_name}</Td>
                  <Td className="capitalize" style={{ color: 'var(--ink-2)' }}>{row.account_type}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink)' }}>
                    {Number(row.debit) > 0 ? formatCurrency(row.debit) : '—'}
                  </Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink)' }}>
                    {Number(row.credit) > 0 ? formatCurrency(row.credit) : '—'}
                  </Td>
                  <Td
                    className={cn('text-right mono font-medium')}
                    style={{ color: Number(row.balance) >= 0 ? 'var(--ink)' : 'var(--danger)' }}
                  >
                    {formatCurrency(row.balance)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--color-grey-light)' }} className="font-semibold">
                <td colSpan={3} className="py-3 px-4 text-sm" style={{ color: 'var(--ink-2)' }}>Totals</td>
                <td className="py-3 px-4 text-right mono" style={{ color: balanced ? 'var(--ink)' : 'var(--danger)' }}>
                  {formatCurrency(totalDebit)}
                </td>
                <td className="py-3 px-4 text-right mono" style={{ color: balanced ? 'var(--ink)' : 'var(--danger)' }}>
                  {formatCurrency(totalCredit)}
                </td>
                <td className="py-3 px-4 text-right mono" style={{ color: 'var(--ink)' }}>
                  {formatCurrency(totalDebit - totalCredit)}
                </td>
              </tr>
            </tfoot>
          </Table>
        </Card>
      )}
    </div>
  )
}

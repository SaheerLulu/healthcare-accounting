import { useState } from 'react'
import { Download, Loader2, ReceiptText } from 'lucide-react'
import { toast } from 'sonner'
import api, { getExpenseRegister, type ExpenseRegisterRow, type RegisterTotals } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentFY } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'

export default function ExpenseRegisterPage() {
  const fy = getCurrentFY()
  const [rows, setRows] = useState<ExpenseRegisterRow[]>([])
  const [totals, setTotals] = useState<RegisterTotals | null>(null)
  const [nonGstCount, setNonGstCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(fy.start)
  const [dateTo, setDateTo] = useState(fy.end)

  async function load() {
    setLoading(true)
    try {
      const res = await getExpenseRegister({ start_date: dateFrom, end_date: dateTo })
      setRows(res.rows)
      setTotals(res.totals)
      setNonGstCount(res.non_gst_count)
      setFetched(true)
    } catch {
      toast.error('Failed to load expense register')
    } finally {
      setLoading(false)
    }
  }

  async function exportAs(fmt: 'csv' | 'xlsx') {
    try {
      const res = await api.get('/reports/expense-register/', {
        params: { start_date: dateFrom, end_date: dateTo, export: fmt },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Expense_Register_${dateFrom}_${dateTo}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed')
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Expense Register</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Direct expenses and vendor bills with GST/ITC columns, head-wise.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => exportAs('csv')} disabled={rows.length === 0}>
            <Download size={15} />CSV
          </Button>
          <Button variant="secondary" onClick={() => exportAs('xlsx')} disabled={rows.length === 0}>
            <Download size={15} />Excel
          </Button>
        </div>
      </div>

      {/* Period filters */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-none">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-auto" />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-none">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-auto" />
        </div>
        <Button onClick={load} disabled={loading} className="w-full sm:w-auto">
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
        {fetched && nonGstCount > 0 && (
          <span className="text-xs" style={{ color: 'var(--ink-2)' }} title="Salary, interest and similar heads normally carry no GST">
            {nonGstCount} non-GST voucher{nonGstCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={9} />
      ) : !fetched ? (
        <EmptyState
          icon={ReceiptText}
          title="Run the expense register"
          description="Select a date range and click Run Report to list recorded expenses and posted vendor bills with their GST components."
          actionLabel="Run Report"
          onAction={load}
        />
      ) : rows.length === 0 ? (
        <EmptyState variant="no-data" title="No expenses in this range" description="Record expenses or post vendor bills first." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">Date</Th>
                <Th className="text-left">Voucher No</Th>
                <Th className="text-left">Source</Th>
                <Th className="text-left">Head</Th>
                <Th className="text-left">Supplier</Th>
                <Th className="text-left">GSTIN</Th>
                <Th className="text-right">Taxable</Th>
                <Th className="text-right">CGST</Th>
                <Th className="text-right">SGST</Th>
                <Th className="text-right">IGST</Th>
                <Th className="text-right">Total</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r, i) => (
                <Tr key={i}>
                  <Td style={{ color: 'var(--ink-2)' }}>{formatDate(r.date)}</Td>
                  <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>{r.voucher_no}</Td>
                  <Td>
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                      style={r.source === 'Bill'
                        ? { backgroundColor: '#e0f2fe', color: '#0369a1' }
                        : { backgroundColor: '#f1f5f9', color: '#475569' }}
                    >
                      {r.source}
                    </span>
                  </Td>
                  <Td className="max-w-[180px] truncate" style={{ color: 'var(--ink)' }} title={r.head}>{r.head}</Td>
                  <Td className="max-w-[160px] truncate" style={{ color: 'var(--ink-2)' }} title={r.party_name}>{r.party_name}</Td>
                  <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>{r.gstin || '-'}</Td>
                  <Td className="text-right mono">{formatCurrency(r.taxable_value)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(r.cgst)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(r.sgst)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(r.igst)}</Td>
                  <Td className="text-right mono font-medium">{formatCurrency(r.total)}</Td>
                </Tr>
              ))}
            </Tbody>
            {totals && (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--color-grey-light)' }} className="font-semibold">
                  <td colSpan={6} className="py-3 px-4 text-sm" style={{ color: 'var(--ink-2)' }}>Totals ({rows.length} vouchers)</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.taxable_value)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.cgst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.sgst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.igst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.total ?? '0')}</td>
                </tr>
              </tfoot>
            )}
          </Table>
        </Card>
      )}
    </div>
  )
}

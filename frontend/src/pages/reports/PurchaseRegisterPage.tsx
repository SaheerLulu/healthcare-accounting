import { useState } from 'react'
import { Download, Loader2, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import api, { getPurchaseRegister, type PurchaseRegisterRow, type RegisterTotals } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentFY } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'

export default function PurchaseRegisterPage() {
  const fy = getCurrentFY()
  const [rows, setRows] = useState<PurchaseRegisterRow[]>([])
  const [totals, setTotals] = useState<RegisterTotals | null>(null)
  const [counts, setCounts] = useState({ registered: 0, unregistered: 0 })
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(fy.start)
  const [dateTo, setDateTo] = useState(fy.end)

  async function load() {
    setLoading(true)
    try {
      const res = await getPurchaseRegister({ start_date: dateFrom, end_date: dateTo })
      setRows(res.rows)
      setTotals(res.totals)
      setCounts({ registered: res.registered_count, unregistered: res.unregistered_count })
      setFetched(true)
    } catch {
      toast.error('Failed to load purchase register')
    } finally {
      setLoading(false)
    }
  }

  async function exportAs(fmt: 'csv' | 'xlsx') {
    try {
      const res = await api.get('/reports/purchase-register/', {
        params: { start_date: dateFrom, end_date: dateTo, export: fmt },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Purchase_Register_${dateFrom}_${dateTo}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed')
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Purchase Register</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Supplier-invoice-wise inventory purchases with GST split. Inter-store transfers excluded.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => exportAs('csv')} disabled={rows.length === 0}>
            <Download size={15} />CSV
          </Button>
          <Button variant="secondary" onClick={() => exportAs('xlsx')} disabled={rows.length === 0}>
            <Download size={15} />Excel
          </Button>
        </div>
      </div>

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
        {fetched && (
          <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
            {counts.registered} registered · {counts.unregistered} unregistered supplier invoices
          </span>
        )}
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={9} />
      ) : !fetched ? (
        <EmptyState
          icon={ShoppingCart}
          title="Run the purchase register"
          description="Select a date range and click Run Report to list supplier invoices with taxable value and GST split."
          actionLabel="Run Report"
          onAction={load}
        />
      ) : rows.length === 0 ? (
        <EmptyState variant="no-data" title="No purchases in this range" description="Try widening your date range." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">Supplier GSTIN</Th>
                <Th className="text-left">Supplier</Th>
                <Th className="text-left">Invoice No</Th>
                <Th className="text-left">Date</Th>
                <Th className="text-right">Taxable Value</Th>
                <Th className="text-right">CGST</Th>
                <Th className="text-right">SGST</Th>
                <Th className="text-right">IGST</Th>
                <Th className="text-right">Invoice Value</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r, i) => (
                <Tr key={i}>
                  <Td className="mono text-xs" style={{ color: r.registered ? 'var(--ink-3)' : 'var(--danger)' }}>
                    {r.supplier_gstin}
                  </Td>
                  <Td className="font-medium max-w-[200px] truncate" style={{ color: 'var(--ink)' }} title={r.supplier_name}>
                    {r.supplier_name}
                  </Td>
                  <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>{r.invoice_no}</Td>
                  <Td style={{ color: 'var(--ink-2)' }}>{formatDate(r.invoice_date)}</Td>
                  <Td className="text-right mono">{formatCurrency(r.taxable_value)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(r.cgst)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(r.sgst)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(r.igst)}</Td>
                  <Td className="text-right mono font-medium">{formatCurrency(r.invoice_value)}</Td>
                </Tr>
              ))}
            </Tbody>
            {totals && (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--color-grey-light)' }} className="font-semibold">
                  <td colSpan={4} className="py-3 px-4 text-sm" style={{ color: 'var(--ink-2)' }}>Totals ({rows.length} invoices)</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.taxable_value)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.cgst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.sgst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.igst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.invoice_value ?? '0')}</td>
                </tr>
              </tfoot>
            )}
          </Table>
        </Card>
      )}
    </div>
  )
}

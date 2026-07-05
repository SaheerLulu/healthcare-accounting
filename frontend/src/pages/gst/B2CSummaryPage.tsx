import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { getB2CSummary, type B2CSummaryRow, type RegisterTotals } from '../../lib/api'
import { formatCurrency, getCurrentPeriod } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { useLocation } from '../../contexts/LocationContext'

export default function B2CSummaryPage() {
  const [rows, setRows] = useState<B2CSummaryRow[]>([])
  const [totals, setTotals] = useState<RegisterTotals | null>(null)
  const [b2clExcluded, setB2clExcluded] = useState(0)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const data = await getB2CSummary(period)
      setRows(data.rows)
      setTotals(data.totals)
      setB2clExcluded(data.b2cl_excluded)
    } catch {
      toast.error('Failed to load B2C summary')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (period) load() }, [period, activeLocationId])

  async function exportCsv() {
    try {
      const res = await api.get('/gst/reports/b2c-summary/', {
        params: { period, export: 'csv' }, responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `B2C_Summary_${period}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed')
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>B2C Summary</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>
            GSTR-1 Table 7 (B2C Others) — rate-wise consolidated unregistered sales, net of B2C credit notes
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
          <Download size={15} />
          Export CSV
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
        {b2clExcluded > 0 && (
          <span
            className="px-2 py-1 rounded text-[11px] font-medium"
            style={{ backgroundColor: '#fff8e6', color: '#92600a' }}
            title="Inter-state invoices above the B2C-Large threshold belong in Table 5 (B2CL), not this summary"
          >
            {b2clExcluded} B2C-Large invoice{b2clExcluded > 1 ? 's' : ''} excluded (Table 5)
          </span>
        )}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">GST Rate</Th>
              <Th className="text-left">PoS</Th>
              <Th className="text-left">Supply Type</Th>
              <Th className="text-right">Taxable Value</Th>
              <Th className="text-right">CGST</Th>
              <Th className="text-right">SGST</Th>
              <Th className="text-right">IGST</Th>
              <Th className="text-right">Total Tax</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No B2C supplies in this period</td></tr>
            ) : (
              rows.map((r, i) => (
                <Tr key={i}>
                  <Td className="font-mono font-medium">{Number(r.rate)}%</Td>
                  <Td className="font-mono text-xs text-slate-500">{r.place_of_supply}</Td>
                  <Td className="text-slate-500 text-xs">{r.supply_type === 'inter_state' ? 'Inter-state' : 'Intra-state'}</Td>
                  <Td className="text-right font-mono">{formatCurrency(r.taxable_value)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(r.cgst)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(r.sgst)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(r.igst)}</Td>
                  <Td className="text-right font-mono">{formatCurrency(r.total_tax)}</Td>
                </Tr>
              ))
            )}
          </Tbody>
          {rows.length > 0 && totals && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={3} className="py-3 px-4 text-sm text-slate-500">Totals</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.taxable_value)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.cgst)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.sgst)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.igst)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.total_tax)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
    </div>
  )
}

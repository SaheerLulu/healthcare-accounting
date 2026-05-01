import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getHSNSummary, type HSNSummaryRow } from '../../lib/api'
import { formatCurrency, getCurrentPeriod } from '../../lib/utils'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { useLocation } from '../../contexts/LocationContext'

export default function HSNSummaryPage() {
  const [rows, setRows] = useState<HSNSummaryRow[]>([])
  const [totals, setTotals] = useState({ taxable: '0', tax: '0' })
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = { period }
      const data = await getHSNSummary(params)
      setRows(data.rows)
      setTotals({ taxable: data.total_taxable, tax: data.total_tax })
    } catch {
      toast.error('Failed to load HSN summary')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (period) load() }, [period, activeLocationId])

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>HSN Summary</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>HSN-code level aggregation</p>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">HSN Code</Th>
              <Th className="text-left">Description</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">Taxable</Th>
              <Th className="text-right">CGST</Th>
              <Th className="text-right">SGST</Th>
              <Th className="text-right">IGST</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No HSN data available</td></tr>
            ) : rows.map((r, i) => (
              <Tr key={i}>
                <Td className="font-mono text-xs text-teal-600">{r.hsn_code}</Td>
                <Td className="text-slate-500 max-w-xs truncate">{r.description}</Td>
                <Td className="text-right font-mono text-slate-500">{r.quantity}</Td>
                <Td className="text-right font-mono text-slate-500">{r.rate}%</Td>
                <Td className="text-right font-mono">{formatCurrency(r.taxable_value)}</Td>
                <Td className="text-right font-mono text-slate-500">{formatCurrency(r.cgst)}</Td>
                <Td className="text-right font-mono text-slate-500">{formatCurrency(r.sgst)}</Td>
                <Td className="text-right font-mono text-slate-500">{formatCurrency(r.igst)}</Td>
              </Tr>
            ))}
          </Tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={4} className="py-3 px-4 text-sm text-slate-500">Totals</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.taxable)}</td>
                <td colSpan={3} className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.tax)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
    </div>
  )
}

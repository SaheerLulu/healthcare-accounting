import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { getHSNSummary, type HSNSummaryRow } from '../../lib/api'
import { formatCurrency, getCurrentPeriod } from '../../lib/utils'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { useLocation } from '../../contexts/LocationContext'

const SEGMENTS = ['ALL', 'B2B', 'B2C'] as const

export default function HSNSummaryPage() {
  const [rows, setRows] = useState<HSNSummaryRow[]>([])
  const [totals, setTotals] = useState({ taxable: '0', tax: '0' })
  const [segTotals, setSegTotals] = useState<Record<string, { taxable: string; tax: string }>>({})
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]>('ALL')
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = { period }
      if (segment !== 'ALL') params.segment = segment
      const data = await getHSNSummary(params)
      setRows(data.rows)
      setTotals({ taxable: data.total_taxable, tax: data.total_tax })
      setSegTotals(data.segment_totals || {})
    } catch {
      toast.error('Failed to load HSN summary')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (period) load() }, [period, segment, activeLocationId])

  async function exportCsv() {
    try {
      const params: Record<string, string> = { period, export: 'csv' }
      if (segment !== 'ALL') params.segment = segment
      const res = await api.get('/reports/hsn-summary/', { params, responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `HSN_Summary_${period}${segment !== 'ALL' ? `_${segment}` : ''}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed')
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>HSN Summary</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>
          GSTR-1 Table 12 — HSN-wise outward supplies, B2B / B2C tabs, net of credit notes
        </p>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--line)' }}>
          {SEGMENTS.map((s) => (
            <button
              key={s}
              onClick={() => setSegment(s)}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={segment === s
                ? { backgroundColor: 'var(--color-primary, #0d9488)', color: '#fff' }
                : { backgroundColor: 'var(--surface-0)', color: 'var(--ink-2)' }}
            >
              {s === 'ALL' ? 'All' : s}
            </button>
          ))}
        </div>
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border disabled:opacity-40"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
        >
          <Download size={13} /> Export CSV (Table 12)
        </button>
      </div>

      {/* Per-segment totals — B2B and B2C are filed as separate tabs */}
      {(segTotals.B2B || segTotals.B2C) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['B2B', 'B2C'] as const).map((s) => (
            segTotals[s] ? (
              <Card key={s} className="p-3">
                <div className="text-[11px] font-medium text-slate-400">{s} taxable / tax</div>
                <div className="text-sm font-semibold font-mono mt-0.5">
                  {formatCurrency(segTotals[s].taxable)}
                  <span className="text-slate-400 font-normal"> / {formatCurrency(segTotals[s].tax)}</span>
                </div>
              </Card>
            ) : null
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">HSN Code</Th>
              <Th className="text-left">Tab</Th>
              <Th className="text-left">Description</Th>
              <Th className="text-left">UQC</Th>
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
              <tr><td colSpan={10} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-12 text-slate-400 text-sm">No HSN data available — generate GSTR-1 for this period first</td></tr>
            ) : rows.map((r, i) => (
              <Tr key={i}>
                <Td className="font-mono text-xs text-teal-600">{r.hsn_code}</Td>
                <Td>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                    style={r.segment === 'B2B'
                      ? { backgroundColor: '#e0f2fe', color: '#0369a1' }
                      : { backgroundColor: '#f1f5f9', color: '#475569' }}
                  >
                    {r.segment}
                  </span>
                </Td>
                <Td className="text-slate-500 max-w-xs truncate">{r.description}</Td>
                <Td className="text-slate-500 text-xs">{r.uqc}</Td>
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
                <td colSpan={6} className="py-3 px-4 text-sm text-slate-500">Totals</td>
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

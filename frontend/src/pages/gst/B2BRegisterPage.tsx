import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { getB2BRegister, type B2BRegisterRow, type RegisterTotals } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentPeriod } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { useLocation } from '../../contexts/LocationContext'

export default function B2BRegisterPage() {
  const [rows, setRows] = useState<B2BRegisterRow[]>([])
  const [totals, setTotals] = useState<RegisterTotals | null>(null)
  const [invoiceCount, setInvoiceCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const data = await getB2BRegister(period)
      setRows(data.rows)
      setTotals(data.totals)
      setInvoiceCount(data.invoice_count)
    } catch {
      toast.error('Failed to load B2B register')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (period) load() }, [period, activeLocationId])

  async function exportCsv() {
    try {
      const res = await api.get('/gst/reports/b2b-register/', {
        params: { period, export: 'csv' }, responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `B2B_Register_${period}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed')
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>B2B Register</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>
            GSTR-1 Table 4 — registered-buyer invoices, one row per GST rate — {invoiceCount} invoices
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
          <Download size={15} />
          Export CSV
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 sm:gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">GSTIN</Th>
              <Th className="text-left">Party</Th>
              <Th className="text-left">Invoice No</Th>
              <Th className="text-left">Date</Th>
              <Th className="text-right">Invoice Value</Th>
              <Th className="text-left">PoS</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">Taxable Value</Th>
              <Th className="text-right">CGST</Th>
              <Th className="text-right">SGST</Th>
              <Th className="text-right">IGST</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={11} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-12 text-slate-400 text-sm">No B2B supplies in this period</td></tr>
            ) : (
              rows.map((r, i) => (
                <Tr key={i}>
                  <Td className="font-mono text-xs text-slate-500">{r.gstin}</Td>
                  <Td className="text-slate-700 max-w-[180px] truncate" title={r.party_name}>{r.party_name}</Td>
                  <Td className="font-mono text-xs text-teal-600">{r.invoice_no}</Td>
                  <Td className="text-slate-500">{formatDate(r.invoice_date)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(r.invoice_value)}</Td>
                  <Td className="font-mono text-xs text-slate-500" title={r.supply_type === 'inter_state' ? 'Inter-state' : 'Intra-state'}>{r.place_of_supply}</Td>
                  <Td className="text-right font-mono text-slate-500">{Number(r.rate)}%</Td>
                  <Td className="text-right font-mono">{formatCurrency(r.taxable_value)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(r.cgst)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(r.sgst)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(r.igst)}</Td>
                </Tr>
              ))
            )}
          </Tbody>
          {rows.length > 0 && totals && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={7} className="py-3 px-4 text-sm text-slate-500">Totals ({rows.length} rate lines)</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.taxable_value)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.cgst)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.sgst)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.igst)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
    </div>
  )
}

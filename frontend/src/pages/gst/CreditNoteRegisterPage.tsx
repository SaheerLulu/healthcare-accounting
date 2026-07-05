import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { getCreditNoteRegister, type CreditNoteRegisterRow, type RegisterTotals } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentPeriod } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { useLocation } from '../../contexts/LocationContext'

export default function CreditNoteRegisterPage() {
  const [rows, setRows] = useState<CreditNoteRegisterRow[]>([])
  const [totals, setTotals] = useState<RegisterTotals | null>(null)
  const [noteCount, setNoteCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const data = await getCreditNoteRegister(period)
      setRows(data.rows)
      setTotals(data.totals)
      setNoteCount(data.note_count)
    } catch {
      toast.error('Failed to load credit note register')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (period) load() }, [period, activeLocationId])

  async function exportCsv() {
    try {
      const res = await api.get('/gst/reports/credit-notes/', {
        params: { period, export: 'csv' }, responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Credit_Note_Register_${period}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed')
    }
  }

  const timeBarred = rows.filter((r) => r.is_time_barred).length

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Credit Note Register</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>
            GSTR-1 Table 9B — sales-return credit notes (CDNR / CDNUR) — {noteCount} notes
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
        {timeBarred > 0 && (
          <span
            className="px-2 py-1 rounded text-[11px] font-medium"
            style={{ backgroundColor: '#fde8e8', color: '#c0392b' }}
            title="Declared after 30 November of the FY following the original supply — GST adjustment not allowed under §34(2)"
          >
            {timeBarred} time-barred under §34(2)
          </span>
        )}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Note No</Th>
              <Th className="text-left">Date</Th>
              <Th className="text-left">Party</Th>
              <Th className="text-left">GSTIN</Th>
              <Th className="text-left">Original Invoice</Th>
              <Th className="text-left">Type</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">Taxable Value</Th>
              <Th className="text-right">CGST</Th>
              <Th className="text-right">SGST</Th>
              <Th className="text-right">IGST</Th>
              <Th className="text-right">Total</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={12} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={12} className="text-center py-12 text-slate-400 text-sm">No credit notes in this period</td></tr>
            ) : (
              rows.map((r, i) => (
                <Tr key={i}>
                  <Td className="font-mono text-xs text-teal-600">{r.note_no}</Td>
                  <Td className="text-slate-500">{formatDate(r.note_date)}</Td>
                  <Td className="text-slate-700 max-w-[160px] truncate" title={r.party_name}>{r.party_name}</Td>
                  <Td className="font-mono text-xs text-slate-500">{r.gstin || '-'}</Td>
                  <Td className="font-mono text-xs text-slate-500">{r.original_invoice_no || '-'}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={r.note_type === 'CDNR'
                          ? { backgroundColor: '#e0f2fe', color: '#0369a1' }
                          : { backgroundColor: '#f1f5f9', color: '#475569' }}
                      >
                        {r.note_type}
                      </span>
                      {r.is_time_barred && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                          style={{ backgroundColor: '#fde8e8', color: '#c0392b' }}
                          title="Time-barred under §34(2)"
                        >
                          barred
                        </span>
                      )}
                    </span>
                  </Td>
                  <Td className="text-right font-mono text-slate-500">{Number(r.rate)}%</Td>
                  <Td className="text-right font-mono">{formatCurrency(r.taxable_value)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(r.cgst)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(r.sgst)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(r.igst)}</Td>
                  <Td className="text-right font-mono">{formatCurrency(r.total)}</Td>
                </Tr>
              ))
            )}
          </Tbody>
          {rows.length > 0 && totals && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={7} className="py-3 px-4 text-sm text-slate-500">Totals (reduce outward liability)</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.taxable_value)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.cgst)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.sgst)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.igst)}</td>
                <td className="py-3 px-4"></td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
    </div>
  )
}

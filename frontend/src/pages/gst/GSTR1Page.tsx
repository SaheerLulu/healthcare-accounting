import { useEffect, useState } from 'react'
import { Loader2, Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { generateGSTR1, getGSTR1Entries, type GSTR1Entry } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentPeriod } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { useLocation } from '../../contexts/LocationContext'

export default function GSTR1Page() {
  const [entries, setEntries] = useState<GSTR1Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (period) params.period = period
      const data = await getGSTR1Entries(params)
      setEntries(data)
    } catch {
      toast.error('Failed to load GSTR-1 entries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [period, activeLocationId])

  async function handleGenerate() {
    if (!activeLocationId) {
      toast.error('Select a specific location to generate GSTR-1')
      return
    }
    setGenerating(true)
    try {
      await generateGSTR1(period, activeLocationId)
      toast.success('GSTR-1 generated successfully')
      load()
    } catch {
      toast.error('Failed to generate GSTR-1')
    } finally {
      setGenerating(false)
    }
  }

  function exportCSV() {
    if (entries.length === 0) { toast.error('No data to export'); return }
    const headers = ['Invoice No', 'Date', 'Customer GSTIN', 'Type', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total']
    const rows = entries.map((e) => [
      e.invoice_no,
      e.invoice_date,
      e.customer_gstin,
      e.invoice_type,
      e.taxable_value,
      e.cgst,
      e.sgst,
      e.igst,
      e.total_gst,
    ])
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `GSTR1_${period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalTaxable = entries.reduce((s, e) => s + Number(e.taxable_value), 0)
  const totalCGST = entries.reduce((s, e) => s + Number(e.cgst), 0)
  const totalSGST = entries.reduce((s, e) => s + Number(e.sgst), 0)
  const totalIGST = entries.reduce((s, e) => s + Number(e.igst), 0)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">GSTR-1</h1>
          <p className="text-sm text-slate-500 mt-0.5">Outward supplies return — {entries.length} invoices</p>
        </div>
        <Button variant="secondary" onClick={exportCSV}>
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
        <Button onClick={handleGenerate} disabled={generating}>
          {generating ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Generate
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Invoice No</Th>
              <Th className="text-left">Date</Th>
              <Th className="text-left">Customer GSTIN</Th>
              <Th className="text-left">Type</Th>
              <Th className="text-right">Taxable Value</Th>
              <Th className="text-right">CGST</Th>
              <Th className="text-right">SGST</Th>
              <Th className="text-right">IGST</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No GSTR-1 entries. Generate to populate.</td></tr>
            ) : (
              entries.map((e) => (
                <Tr key={e.id}>
                  <Td className="font-mono text-xs text-teal-600">{e.invoice_no}</Td>
                  <Td className="text-slate-500">{formatDate(e.invoice_date)}</Td>
                  <Td className="font-mono text-xs text-slate-500">{e.customer_gstin || '-'}</Td>
                  <Td className="capitalize text-slate-500">{e.invoice_type}</Td>
                  <Td className="text-right font-mono">{formatCurrency(e.taxable_value)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(e.cgst)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(e.sgst)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(e.igst)}</Td>
                </Tr>
              ))
            )}
          </Tbody>
          {entries.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={4} className="py-3 px-4 text-sm text-slate-500">Totals ({entries.length} invoices)</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totalTaxable)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totalCGST)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totalSGST)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totalIGST)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
    </div>
  )
}

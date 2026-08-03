import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { generateGSTR2B, getGSTR2BEntries, toggleGSTR2BITC, type GSTR2BEntry } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentPeriod, cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { useLocation } from '../../contexts/LocationContext'

export default function GSTR2BPage() {
  const [entries, setEntries] = useState<GSTR2BEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (period) params.period = period
      const data = await getGSTR2BEntries(params)
      setEntries(data)
    } catch {
      toast.error('Failed to load GSTR-2B entries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [period, activeLocationId])

  async function handleGenerate() {
    if (!activeLocationId) {
      toast.error('Select a specific location to generate GSTR-2B')
      return
    }
    setGenerating(true)
    try {
      await generateGSTR2B(period, activeLocationId)
      toast.success('GSTR-2B generated successfully')
      load()
    } catch {
      toast.error('Failed to generate GSTR-2B')
    } finally {
      setGenerating(false)
    }
  }

  async function handleToggleITC(id: number) {
    try {
      const updated = await toggleGSTR2BITC(id)
      setEntries(entries.map(e => e.id === id ? updated : e))
      toast.success('ITC eligibility updated')
    } catch {
      toast.error('Failed to update ITC eligibility')
    }
  }

  function getMatchVariant(status: string) {
    const map: Record<string, 'success' | 'warning' | 'error' | 'orange' | 'default'> = {
      matched: 'success',
      unmatched: 'warning',
      missing: 'error',
      mismatch: 'orange',
    }
    return map[status] || 'default'
  }

  const totalTaxable = entries.reduce((s, e) => s + Number(e.taxable_value), 0)
  const totalGST = entries.reduce((s, e) => s + Number(e.total_gst), 0)

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>GSTR-2B</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Auto-populated purchase register — {entries.length} invoices</p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 mb-5 flex-wrap">
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
              <Th className="text-left">Supplier</Th>
              <Th className="text-left">GSTIN</Th>
              <Th className="text-left">Invoice</Th>
              <Th className="text-left">Date</Th>
              <Th className="text-right">Taxable</Th>
              <Th className="text-right">GST</Th>
              <Th className="text-center">ITC</Th>
              <Th className="text-left">Match</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No GSTR-2B entries. Generate to populate.</td></tr>
            ) : entries.map((e) => (
              <Tr key={e.id}>
                <Td className="font-medium">{e.supplier_name}</Td>
                <Td className="font-mono text-xs text-slate-500">{e.supplier_gstin}</Td>
                <Td className="font-mono text-xs text-teal-600">{e.invoice_no}</Td>
                <Td className="text-slate-500">{formatDate(e.invoice_date)}</Td>
                <Td className="text-right font-mono">{formatCurrency(e.taxable_value)}</Td>
                <Td className="text-right font-mono text-slate-500">{formatCurrency(e.total_gst)}</Td>
                <Td className="text-center">
                  <button onClick={() => handleToggleITC(e.id)}
                    className={cn('p-2.5 sm:p-1 rounded', e.itc_eligible ? 'text-emerald-600 bg-emerald-50' : 'text-red-500 bg-red-50')}>
                    {e.itc_eligible ? <Check size={14} /> : <X size={14} />}
                  </button>
                </Td>
                <Td><Badge variant={getMatchVariant(e.match_status)}>{e.match_status}</Badge></Td>
              </Tr>
            ))}
          </Tbody>
          {entries.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={4} className="py-3 px-4 text-sm text-slate-500">Totals ({entries.length} invoices)</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totalTaxable)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totalGST)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
    </div>
  )
}

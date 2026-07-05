import { useEffect, useState } from 'react'
import { FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import api, { generateGSTR3B, getGSTR3BSummaries, type GSTR3BSummary } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentPeriod } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card, CardHeader, CardContent } from '../../components/ui/card'
import { useLocation } from '../../contexts/LocationContext'

function SummaryCard({ summary }: { summary: GSTR3BSummary }) {
  const netPayable = Number(summary.total_net_payable)
  const totalITC = Number(summary.total_itc)

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-slate-900">Period: {summary.period}</span>
          <span className="ml-3 text-xs text-slate-500">Location #{summary.location_id}</span>
        </div>
        <span className="text-xs text-slate-400">Generated: {formatDate(summary.created_at)}</span>
      </CardHeader>

      <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Outward Supplies */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Outward Supplies</p>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Taxable Supplies</span>
              <span className="font-mono font-medium text-slate-900">{formatCurrency(summary.outward_taxable)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Zero Rated</span>
              <span className="font-mono font-medium text-slate-900">{formatCurrency(summary.outward_zero_rated)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500" title="3.1(c) — exempt/nil-rated outward supplies (consultation income etc.)">Exempt / Nil-rated</span>
              <span className="font-mono font-medium text-slate-900">{formatCurrency(summary.outward_exempt)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Total Outward GST</span>
              <span className="font-mono font-medium text-slate-900">{formatCurrency(summary.total_outward_gst)}</span>
            </div>
          </div>
        </div>

        {/* ITC */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Input Tax Credit (ITC)</p>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">IGST</span>
              <span className="font-mono font-medium text-slate-900">{formatCurrency(summary.itc_igst)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">CGST</span>
              <span className="font-mono font-medium text-slate-900">{formatCurrency(summary.itc_cgst)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">SGST</span>
              <span className="font-mono font-medium text-slate-900">{formatCurrency(summary.itc_sgst)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-slate-200 pt-2 mt-1">
              <span className="text-slate-500 font-medium">Total ITC</span>
              <span className="font-mono font-semibold text-emerald-700">{formatCurrency(totalITC)}</span>
            </div>
          </div>
        </div>

        {/* Net Payable */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Net Tax Payable</p>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">IGST</span>
              <span className="font-mono font-medium text-slate-900">{formatCurrency(summary.net_payable_igst)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">CGST</span>
              <span className="font-mono font-medium text-slate-900">{formatCurrency(summary.net_payable_cgst)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">SGST</span>
              <span className="font-mono font-medium text-slate-900">{formatCurrency(summary.net_payable_sgst)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-slate-200 pt-2 mt-1">
              <span className="text-slate-500 font-medium">Total Payable</span>
              <span className="font-mono font-semibold text-red-700">{formatCurrency(netPayable)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function GSTR3BPage() {
  const [summaries, setSummaries] = useState<GSTR3BSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (period) params.period = period
      const res = await getGSTR3BSummaries(params)
      setSummaries(res.results)
    } catch {
      toast.error('Failed to load GSTR-3B summaries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [period, activeLocationId])

  async function handleGenerate() {
    if (!activeLocationId) {
      toast.error('Select a specific location to generate GSTR-3B')
      return
    }
    setGenerating(true)
    try {
      await generateGSTR3B(period, activeLocationId)
      toast.success('GSTR-3B generated successfully')
      load()
    } catch {
      toast.error('Failed to generate GSTR-3B')
    } finally {
      setGenerating(false)
    }
  }

  async function downloadWorkingPapers() {
    setExporting(true)
    try {
      const res = await api.get('/gst/working-papers/', {
        params: { period }, responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `GST_Working_Papers_${period}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to build working papers')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>GSTR-3B</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Monthly summary return</p>
        </div>
        <Button
          variant="secondary"
          onClick={downloadWorkingPapers}
          disabled={exporting}
          title="One Excel workbook with GSTR-3B, B2B/B2C registers, HSN, documents issued, credit notes, purchase and expense registers"
        >
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
          Working Papers
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
        <Button
          variant="primary"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Generate
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-teal-600" />
        </div>
      ) : summaries.length === 0 ? (
        <Card className="flex items-center justify-center py-20 text-slate-400 text-sm">
          No GSTR-3B data. Select period and generate.
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {summaries.map((s) => <SummaryCard key={s.id} summary={s} />)}
        </div>
      )}
    </div>
  )
}

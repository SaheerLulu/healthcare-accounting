import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import api, { generateGSTR3B, getGSTR3BSummaries, type GSTR3BSummary } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentPeriod } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card, CardHeader, CardContent } from '../../components/ui/card'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useLocation } from '../../contexts/LocationContext'

/**
 * A label carrying the GST clause the figure maps to.
 *
 * That mapping is the whole compliance value of this card, and it used to live
 * in a `title` on a plain <span> — hover-only, so a keyboard user could read
 * "Taxable Value" and never learn it is 3.1(a). It is plain visible text now,
 * tied to the label by aria-describedby. Deliberately NOT focusable: it reveals
 * nothing and activates nothing, and a card carries eight or nine of these, so
 * making each one a tab stop would bury every operable control on the screen
 * behind ~18 presses that do nothing.
 */
function ClauseLabel({ text, note, className }: { text: string; note?: string; className?: string }) {
  const id = useId()
  if (!note) return <span className={className}>{text}</span>
  return (
    <span className="min-w-0">
      <span aria-describedby={id} className={className}>{text}</span>
      <span id={id} className="block text-[11px] leading-snug text-slate-400 mt-0.5 max-w-[20rem]">
        {note}
      </span>
    </span>
  )
}

function Row({ label, value, title, indent, strong }: {
  label: string
  value: string | number
  title?: string
  indent?: boolean
  strong?: boolean
}) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <ClauseLabel text={label} note={title} className={indent ? 'text-slate-400 pl-3' : 'text-slate-500'} />
      <span className={strong ? 'font-mono font-semibold text-slate-900' : 'font-mono font-medium text-slate-900'}>
        {formatCurrency(value)}
      </span>
    </div>
  )
}

function SummaryCard({ summary }: { summary: GSTR3BSummary }) {
  const netPayable = Number(summary.total_net_payable)
  const totalITC = Number(summary.total_itc)
  const rcmLiability = Number(summary.rcm_igst) + Number(summary.rcm_cgst) + Number(summary.rcm_sgst)
  const rcmITC = Number(summary.rcm_itc_igst) + Number(summary.rcm_itc_cgst) + Number(summary.rcm_itc_sgst)
  // Table 4(A) per head = 4(A)(5) all-other + 4(A)(3) RCM — this is what the
  // net payable was computed against, so the card reconciles line by line.
  const itcIgst = Number(summary.itc_igst) + Number(summary.rcm_itc_igst)
  const itcCgst = Number(summary.itc_cgst) + Number(summary.rcm_itc_cgst)
  const itcSgst = Number(summary.itc_sgst) + Number(summary.rcm_itc_sgst)

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
            <Row label="Taxable Value" value={summary.outward_taxable}
              title="3.1(a) — taxable value of outward supplies, net of credit notes" />
            <Row label="IGST" value={summary.outward_igst}
              title="IGST on 3.1(a) outward supplies" />
            <Row label="CGST" value={summary.outward_cgst}
              title="CGST on 3.1(a) outward supplies" />
            <Row label="SGST" value={summary.outward_sgst}
              title="SGST on 3.1(a) outward supplies" />
            <Row label="Zero Rated" value={summary.outward_zero_rated}
              title="3.1(b) — zero-rated outward supplies (exports/SEZ)" />
            <Row label="Exempt / Nil-rated" value={summary.outward_exempt}
              title="3.1(c) — exempt/nil-rated outward supplies (consultation income etc.)" />
            {rcmLiability > 0 && (
              <Row label="RCM Inward GST" value={rcmLiability}
                title="3.1(d) — inward supplies liable to reverse charge; payable in cash, claimable as ITC under 4(A)(3)" />
            )}
            <div className="border-t border-slate-200 pt-2 mt-1">
              <Row label="Total Outward GST" value={summary.total_outward_gst} strong
                title="IGST + CGST + SGST on 3.1(a) outward supplies" />
            </div>
          </div>
        </div>

        {/* ITC */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Input Tax Credit (ITC)</p>
          <div className="flex flex-col gap-2">
            <Row label="IGST" value={itcIgst} />
            <Row label="CGST" value={itcCgst} />
            <Row label="SGST" value={itcSgst} />
            {rcmITC > 0 && (
              <Row label="of which RCM ITC" value={rcmITC} indent
                title="4(A)(3) — ITC on inward supplies liable to reverse charge, included in the head-wise figures above" />
            )}
            <div className="flex justify-between gap-3 text-sm border-t border-slate-200 pt-2 mt-1">
              <ClauseLabel
                text="Total ITC"
                note="Table 4(A) — ITC available (all other ITC + RCM ITC)"
                className="text-slate-500 font-medium"
              />
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

const WORKING_PAPERS_CONTENTS =
  'One Excel workbook with GSTR-3B, B2B/B2C registers, HSN, documents issued, credit notes, purchase and expense registers'

export default function GSTR3BPage() {
  const navigate = useNavigate()
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

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // The period drives both actions on this screen, so it takes F2 and the
  // arrival focus. PeriodPicker forwards its ref to the MONTH select — the
  // entry point of the pair — so that element is the F2 target and, via
  // `data-autofocus`, what PageTransition's post-navigation focus pass lands
  // on. usePageKeyboard only calls focus()/select?.(), both safe on a <select>.
  // The return is rendered as cards, not rows, so there is no F3 list.
  const periodRef = useRef<HTMLInputElement | null>(null)
  const bindPeriod = useCallback((el: HTMLSelectElement | null) => {
    el?.setAttribute('data-autofocus', '')
    periodRef.current = el as unknown as HTMLInputElement | null
  }, [])

  // Generate is Alt+N — it creates the period's summary — and Alt+R is left
  // meaning refresh, as it does on GSTR-1 and every other GST screen.
  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'Generate', run: handleGenerate, when: !generating },
      { chord: 'Alt+R', label: 'Refresh', run: load, when: !loading },
      { chord: 'Alt+X', label: 'Working papers', run: downloadWorkingPapers, when: !exporting },
    ],
    searchRef: periodRef,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>GSTR-3B</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Monthly summary return</p>
        </div>
        <Button
          variant="secondary"
          onClick={downloadWorkingPapers}
          disabled={exporting}
          title={WORKING_PAPERS_CONTENTS}
          aria-label={`Working Papers — ${WORKING_PAPERS_CONTENTS}`}
        >
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
          Working Papers
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 sm:gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker ref={bindPeriod} value={period} onChange={setPeriod} label="GSTR-3B period" />
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
        <Card className="flex items-center justify-center px-4 py-20 text-center text-slate-400 text-sm">
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

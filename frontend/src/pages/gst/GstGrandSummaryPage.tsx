import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getGstGrandSummary, type GstGrandSummary } from '../../lib/api'
import { formatCurrency, getCurrentPeriod } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card, CardHeader, CardContent } from '../../components/ui/card'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useLocation } from '../../contexts/LocationContext'

/**
 * GST Grand Summary — a GSTR-3B-style consolidated view: rate-wise output tax
 * (sales / liability) vs input tax (purchases / ITC), with the net payable.
 * Intra-state shows CGST+SGST; inter-state shows IGST.
 */
export default function GstGrandSummaryPage() {
  const navigate = useNavigate()
  const { activeLocationId } = useLocation()
  const [period, setPeriod] = useState(getCurrentPeriod())
  const [data, setData] = useState<GstGrandSummary | null>(null)
  const [loading, setLoading] = useState(false)
  // Sequence guard: a slow response for an abandoned period must not overwrite
  // the current one (what the old effect's `cancelled` flag did).
  const reqRef = useRef(0)
  // ...and a mounted flag beside it, because the sequence still matches after
  // the screen is gone: without this a late failure fires 'Failed to load GST
  // summary' as a toast over whatever page the user navigated to.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  function load() {
    const seq = ++reqRef.current
    const live = () => mountedRef.current && seq === reqRef.current
    setLoading(true)
    getGstGrandSummary(period)
      .then((d) => { if (live()) setData(d) })
      .catch(() => { if (live()) toast.error('Failed to load GST summary') })
      .finally(() => { if (live()) setLoading(false) })
  }

  useEffect(() => { load() }, [period, activeLocationId])

  const money = (v: string) => formatCurrency(v)

  // The figures are built here, so the CSV is too — the summary endpoint serves
  // JSON only, and without this there is no way at all to get the return out of
  // the app without a mouse and a screenshot.
  function exportCsv() {
    if (!data) return
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const line = (...cells: (string | number)[]) => cells.map(q).join(',')
    const rows: string[] = [
      line('GST Grand Summary'),
      line('Business', data.business_name),
      line('GSTIN', data.gstin),
      line('Tax Period', data.period || period),
      line('Return Type', data.return_type),
      '',
    ]
    const block = (
      title: string,
      slabRows: { rate: string; taxable: string; cgst: string; sgst: string; igst: string; total_tax: string }[],
      totals: { taxable: string; cgst: string; sgst: string; igst: string; total_tax: string },
    ) => {
      rows.push(line(title))
      rows.push(line('Rate', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total Tax'))
      for (const r of slabRows) rows.push(line(`${r.rate}%`, r.taxable, r.cgst, r.sgst, r.igst, r.total_tax))
      rows.push(line('Total', totals.taxable, totals.cgst, totals.sgst, totals.igst, totals.total_tax))
      rows.push('')
    }
    block('Output Tax - Sales / Liability', data.slabs.map(s => ({ rate: s.rate, ...s.output })), data.output_totals)
    block('Input Tax - Purchases / ITC', data.slabs.map(s => ({ rate: s.rate, ...s.input })), data.input_totals)
    rows.push(line('Net GST Payable'))
    rows.push(line('Total Liability', data.net.total_liability))
    rows.push(line('Total ITC', data.net.total_itc))
    rows.push(line('Net CGST', data.net.net_cgst))
    rows.push(line('Net SGST', data.net.net_sgst))
    rows.push(line('Net IGST', data.net.net_igst))
    rows.push(line('Late Fee', data.net.late_fee))
    rows.push(line('Interest', data.net.interest))
    rows.push(line('Net Payable', data.net.net_payable))
    rows.push(line('ITC Carried Forward', data.net.itc_carry_forward))

    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `GST_Grand_Summary_${data.period || period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // The period is the only control on the page, so it takes F2 and the arrival
  // focus. PeriodPicker forwards its ref to the MONTH select — the entry point
  // of the pair — so that element is the F2 target and, via `data-autofocus`,
  // what PageTransition's post-navigation focus pass lands on.
  // usePageKeyboard only calls focus()/select?.(), both safe on a <select>.
  const periodRef = useRef<HTMLInputElement | null>(null)
  const bindPeriod = useCallback((el: HTMLSelectElement | null) => {
    el?.setAttribute('data-autofocus', '')
    periodRef.current = el as unknown as HTMLInputElement | null
  }, [])

  usePageKeyboard({
    actions: [
      { chord: 'Alt+R', label: 'Refresh', run: load, when: !loading },
      { chord: 'Alt+X', label: 'Export CSV', run: exportCsv, when: !!data },
    ],
    searchRef: periodRef,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            GST Grand Summary
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Rate-wise GSTR-3B summary of output tax vs input tax credit.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodPicker ref={bindPeriod} value={period} onChange={setPeriod} label="GST summary period" />
          <Button variant="secondary" onClick={load} disabled={loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Refresh
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={!data}>
            <Download size={15} />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Header / return identity */}
      <Card>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
          <HeaderCell label="Business" value={data?.business_name || '—'} />
          <HeaderCell label="GSTIN" value={data?.gstin || '—'} />
          <HeaderCell label="Tax Period" value={data?.period || period} />
          <HeaderCell label="Return Type" value={data?.return_type || 'GSTR-3B'} />
        </CardContent>
      </Card>

      {loading ? (
        <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin inline text-teal-600" /></div>
      ) : !data ? (
        <Card><CardContent className="py-10 text-center text-slate-400">No data for this period.</CardContent></Card>
      ) : (
        <>
          <RateTable title="Output Tax — Sales / Liability" rows={data.slabs.map(s => ({ rate: s.rate, ...s.output }))} totals={data.output_totals} />
          <RateTable title="Input Tax — Purchases / ITC" rows={data.slabs.map(s => ({ rate: s.rate, ...s.input }))} totals={data.input_totals} />

          {/* Net payable */}
          <Card>
            <CardHeader><span className="text-sm font-semibold text-slate-900">Net GST Payable</span></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 py-2">
              <NetCell label="Total Liability" value={money(data.net.total_liability)} />
              <NetCell label="Total ITC" value={money(data.net.total_itc)} />
              <NetCell label="Net CGST" value={money(data.net.net_cgst)} />
              <NetCell label="Net SGST" value={money(data.net.net_sgst)} />
              <NetCell label="Net IGST" value={money(data.net.net_igst)} />
              <NetCell label="Late Fee" value={money(data.net.late_fee)} />
              <NetCell label="Interest" value={money(data.net.interest)} />
              <NetCell label="Net Payable" value={money(data.net.net_payable)} strong />
            </CardContent>
            {Number(data.net.itc_carry_forward) > 0 && (
              <CardContent className="pt-0 pb-3 text-xs text-slate-500">
                ITC carried forward (credit balance): <span className="font-mono">{money(data.net.itc_carry_forward)}</span>
              </CardContent>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function HeaderCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-900 mt-0.5 break-words">{value}</p>
    </div>
  )
}

function NetCell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`font-mono mt-0.5 ${strong ? 'text-lg font-bold text-teal-700' : 'text-sm font-medium text-slate-900'}`}>{value}</p>
    </div>
  )
}

interface RateRow { rate: string; taxable: string; cgst: string; sgst: string; igst: string; total_tax: string }
function RateTable({ title, rows, totals }: { title: string; rows: RateRow[]; totals: Omit<RateRow, 'rate'> }) {
  return (
    <Card>
      <CardHeader><span className="text-sm font-semibold text-slate-900">{title}</span></CardHeader>
      <CardContent className="p-0">
        {/* The rail scrolls sideways below 640px, so it needs to be a tab stop:
            without one, IGST and Total Tax are simply unreachable on a narrow
            viewport. Focused, it takes ←/→ like any scroll container. */}
        <div className="table-scroll" tabIndex={0} role="region" aria-label={title}>
          <table className="w-full text-sm min-w-[640px]">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="text-left py-2.5 px-4">Rate</th>
                <th className="text-right py-2.5 px-4">Taxable</th>
                <th className="text-right py-2.5 px-4">CGST</th>
                <th className="text-right py-2.5 px-4">SGST</th>
                <th className="text-right py-2.5 px-4">IGST</th>
                <th className="text-right py-2.5 px-4">Total Tax</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rate} className="border-b border-slate-100">
                  <td className="py-2.5 px-4 font-medium text-slate-900">{r.rate}%</td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-700">{formatCurrency(r.taxable)}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-700">{formatCurrency(r.cgst)}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-700">{formatCurrency(r.sgst)}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-700">{formatCurrency(r.igst)}</td>
                  <td className="py-2.5 px-4 text-right font-mono font-medium text-slate-900">{formatCurrency(r.total_tax)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t-2 border-slate-200 bg-slate-50">
                <td className="py-2.5 px-4">Total</td>
                <td className="py-2.5 px-4 text-right font-mono">{formatCurrency(totals.taxable)}</td>
                <td className="py-2.5 px-4 text-right font-mono">{formatCurrency(totals.cgst)}</td>
                <td className="py-2.5 px-4 text-right font-mono">{formatCurrency(totals.sgst)}</td>
                <td className="py-2.5 px-4 text-right font-mono">{formatCurrency(totals.igst)}</td>
                <td className="py-2.5 px-4 text-right font-mono">{formatCurrency(totals.total_tax)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

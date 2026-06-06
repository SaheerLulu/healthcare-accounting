import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getGstGrandSummary, type GstGrandSummary } from '../../lib/api'
import { formatCurrency, getCurrentPeriod } from '../../lib/utils'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card, CardHeader, CardContent } from '../../components/ui/card'
import { useLocation } from '../../contexts/LocationContext'

/**
 * GST Grand Summary — a GSTR-3B-style consolidated view: rate-wise output tax
 * (sales / liability) vs input tax (purchases / ITC), with the net payable.
 * Intra-state shows CGST+SGST; inter-state shows IGST.
 */
export default function GstGrandSummaryPage() {
  const { activeLocationId } = useLocation()
  const [period, setPeriod] = useState(getCurrentPeriod())
  const [data, setData] = useState<GstGrandSummary | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getGstGrandSummary(period)
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) toast.error('Failed to load GST summary') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [period, activeLocationId])

  const money = (v: string) => formatCurrency(v)

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            GST Grand Summary
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Rate-wise GSTR-3B summary of output tax vs input tax credit.
          </p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
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
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm min-w-[640px]">
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
      </CardContent>
    </Card>
  )
}

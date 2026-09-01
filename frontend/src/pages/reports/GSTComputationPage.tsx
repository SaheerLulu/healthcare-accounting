import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getGSTComputation, type GSTComputation } from '../../lib/api'
import { formatCurrency, getCurrentPeriod } from '../../lib/utils'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card, CardContent } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { useLocation } from '../../contexts/LocationContext'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

export default function GSTComputationPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<GSTComputation | null>(null)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  // PeriodPicker forwards its ref to the MONTH select — the entry point of the
  // pair. That element is both the F2 target and what PageTransition focuses on
  // arrival, since the period is what every figure on this worksheet is
  // computed from.
  // usePageKeyboard only calls focus()/select?.(), both safe on a <select>.
  const periodRef = useRef<HTMLInputElement | null>(null)
  const bindPeriod = useCallback((el: HTMLSelectElement | null) => {
    el?.setAttribute('data-autofocus', '')
    periodRef.current = el as unknown as HTMLInputElement | null
  }, [])

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = { period }
      const result = await getGSTComputation(params)
      setData(result)
    } catch {
      toast.error('Failed to load GST computation')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (period) load() }, [period, activeLocationId])

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // Nothing on this worksheet opens anything, so this is the read-only variant
  // of the list nav: one roving tab stop over the rate-wise output rows,
  // ↑↓/Home/End/PgUp/PgDn to read down them, and Tab still steps out to the
  // cards below rather than through every rate.
  const rateRows = data?.output_tax.by_rate ?? []
  const list = useListKeyboardNav({ count: rateRows.length })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+R', label: 'Refresh', run: load, when: !loading },
    ],
    searchRef: periodRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>GST Computation</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Tax computation worksheet</p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          {/* A caption for the pair, not a <label>: it labels no single control,
              and the picker carries its own group name from `label`. */}
          <span className="text-xs text-slate-500 font-medium">Period</span>
          <PeriodPicker ref={bindPeriod} value={period} onChange={setPeriod} label="GST computation period" />
        </div>
      </div>

      {/* Every figure below is recomputed when the period changes and focus
          never moves, so say what arrived. */}
      <div className="sr-only" role="status" aria-live="polite">
        {loading
          ? 'Loading GST computation…'
          : data
            ? `GST computation for ${period}. Net payable ${formatCurrency(data.net_payable.total)}.`
            : ''}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-teal-600" /></div>
      ) : !data ? (
        <Card className="p-12 text-center text-slate-400 text-sm">Select a period to view computation</Card>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Output Tax */}
          <Card className="overflow-hidden">
            <CardContent>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Output Tax (Sales)</h2>
              <Table label="Output tax by rate">
                <Thead>
                  <Tr className="bg-slate-50">
                    <Th className="text-left">Rate</Th>
                    <Th className="text-right">Taxable</Th>
                    <Th className="text-right">CGST</Th>
                    <Th className="text-right">SGST</Th>
                    <Th className="text-right">IGST</Th>
                  </Tr>
                </Thead>
                <Tbody {...list.containerProps}>
                  {rateRows.map((r, i) => (
                    <Tr key={r.rate} aria-label={`${r.rate} percent, taxable ${formatCurrency(r.taxable)}`} {...list.rowProps(i)}>
                      <Td className="text-slate-500">{r.rate}%</Td>
                      <Td className="text-right font-mono text-slate-900">{formatCurrency(r.taxable)}</Td>
                      <Td className="text-right font-mono text-slate-500">{formatCurrency(r.cgst)}</Td>
                      <Td className="text-right font-mono text-slate-500">{formatCurrency(r.sgst)}</Td>
                      <Td className="text-right font-mono text-slate-500">{formatCurrency(r.igst)}</Td>
                    </Tr>
                  ))}
                </Tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="py-2.5 px-4 text-slate-500">Total Output</td>
                    <td className="py-2.5 px-4 text-right" />
                    <td className="py-2.5 px-4 text-right font-mono text-slate-900">{formatCurrency(data.output_tax.total_cgst)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-900">{formatCurrency(data.output_tax.total_sgst)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-900">{formatCurrency(data.output_tax.total_igst)}</td>
                  </tr>
                </tfoot>
              </Table>
            </CardContent>
          </Card>

          {/* Adjustments — credit notes, RCM, exempt supplies */}
          <Card className="overflow-hidden">
            <CardContent>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Adjustments</h2>
              <Table label="Adjustments">
                <Thead>
                  <Tr className="bg-slate-50">
                    <Th className="text-left">Item</Th>
                    <Th className="text-right">Taxable</Th>
                    <Th className="text-right">CGST</Th>
                    <Th className="text-right">SGST</Th>
                    <Th className="text-right">IGST</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  <Tr>
                    <Td className="text-slate-500">Less: Credit Notes (sales returns, §34)</Td>
                    <Td className="text-right font-mono text-red-700">−{formatCurrency(data.credit_notes?.taxable ?? '0')}</Td>
                    <Td className="text-right font-mono text-red-700">−{formatCurrency(data.credit_notes?.cgst ?? '0')}</Td>
                    <Td className="text-right font-mono text-red-700">−{formatCurrency(data.credit_notes?.sgst ?? '0')}</Td>
                    <Td className="text-right font-mono text-red-700">−{formatCurrency(data.credit_notes?.igst ?? '0')}</Td>
                  </Tr>
                  <Tr>
                    <Td className="text-slate-500">Add: RCM inward (3.1(d), payable in cash)</Td>
                    <Td className="text-right font-mono text-slate-900">{formatCurrency(data.rcm_inward?.taxable ?? '0')}</Td>
                    <Td className="text-right font-mono text-slate-500">{formatCurrency(data.rcm_inward?.cgst ?? '0')}</Td>
                    <Td className="text-right font-mono text-slate-500">{formatCurrency(data.rcm_inward?.sgst ?? '0')}</Td>
                    <Td className="text-right font-mono text-slate-500">{formatCurrency(data.rcm_inward?.igst ?? '0')}</Td>
                  </Tr>
                  <Tr>
                    <Td className="text-slate-500">Exempt outward supplies (3.1(c) — consultation etc.)</Td>
                    <Td className="text-right font-mono text-slate-900">{formatCurrency(data.exempt_outward ?? '0')}</Td>
                    <Td className="text-right font-mono text-slate-400" colSpan={3}>nil-rated / exempt — no tax</Td>
                  </Tr>
                </Tbody>
              </Table>
            </CardContent>
          </Card>

          {/* Input Tax */}
          <Card>
            <CardContent>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Input Tax Credit (Purchases)</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <div className="text-center p-3 bg-emerald-50 rounded-lg">
                  <p className="text-xs text-slate-500">CGST</p>
                  <p className="text-lg font-bold text-emerald-700 font-mono">{formatCurrency(data.input_tax.cgst)}</p>
                </div>
                <div className="text-center p-3 bg-emerald-50 rounded-lg">
                  <p className="text-xs text-slate-500">SGST</p>
                  <p className="text-lg font-bold text-emerald-700 font-mono">{formatCurrency(data.input_tax.sgst)}</p>
                </div>
                <div className="text-center p-3 bg-emerald-50 rounded-lg">
                  <p className="text-xs text-slate-500">IGST</p>
                  <p className="text-lg font-bold text-emerald-700 font-mono">{formatCurrency(data.input_tax.igst)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Net Payable */}
          <Card>
            <CardContent>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Net Tax Payable</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {['cgst', 'sgst', 'igst'].map((key) => (
                  <div key={key} className="text-center p-3 bg-red-50 rounded-lg">
                    <p className="text-xs text-slate-500 uppercase">{key}</p>
                    <p className="text-lg font-bold text-red-700 font-mono">{formatCurrency((data.net_payable as Record<string, string>)[key])}</p>
                  </div>
                ))}
                <div className="text-center p-3 bg-teal-50 rounded-lg">
                  <p className="text-xs text-slate-500">Total</p>
                  <p className="text-lg font-bold text-teal-600 font-mono">{formatCurrency(data.net_payable.total)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

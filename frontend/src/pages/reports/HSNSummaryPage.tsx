import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { getHSNSummary, type HSNSummaryRow } from '../../lib/api'
import { formatCurrency, getCurrentPeriod } from '../../lib/utils'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { useLocation } from '../../contexts/LocationContext'
import { usePageKeyboard, type PageAction } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

const SEGMENTS = ['ALL', 'B2B', 'B2C'] as const
const SEGMENT_LABEL: Record<(typeof SEGMENTS)[number], string> = {
  ALL: 'All segments',
  B2B: 'B2B only',
  B2C: 'B2C only',
}

export default function HSNSummaryPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<HSNSummaryRow[]>([])
  const [totals, setTotals] = useState({ taxable: '0', tax: '0' })
  const [segTotals, setSegTotals] = useState<Record<string, { taxable: string; tax: string }>>({})
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]>('ALL')
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  // PeriodPicker forwards its ref to the MONTH select — the entry point of the
  // pair. That element is both the F2 target and what PageTransition focuses on
  // arrival, since the period is what every figure here is computed from.
  // usePageKeyboard only calls focus()/select?.(), both safe on a <select>.
  const periodRef = useRef<HTMLInputElement | null>(null)
  const bindPeriod = useCallback((el: HTMLSelectElement | null) => {
    el?.setAttribute('data-autofocus', '')
    periodRef.current = el as unknown as HTMLInputElement | null
  }, [])
  const segRefs = useRef<(HTMLButtonElement | null)[]>([])

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

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // Read-only register: no drill-down exists behind an HSN row, so there is no
  // onActivate — but ↑↓/Home/End/PgUp/PgDn walk the rows through one roving tab
  // stop instead of Tab skipping the table entirely.
  const list = useListKeyboardNav({ count: rows.length })

  function selectSegment(next: (typeof SEGMENTS)[number], focus = false) {
    setSegment(next)
    if (focus) segRefs.current[SEGMENTS.indexOf(next)]?.focus()
  }

  /** Arrow keys walk the segment toggle group, as a radio group should. */
  function onSegmentKeyDown(e: ReactKeyboardEvent, i: number) {
    let next: number
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': next = (i + 1) % SEGMENTS.length; break
      case 'ArrowLeft': case 'ArrowUp': next = (i - 1 + SEGMENTS.length) % SEGMENTS.length; break
      case 'Home': next = 0; break
      case 'End': next = SEGMENTS.length - 1; break
      default: return
    }
    e.preventDefault()
    selectSegment(SEGMENTS[next], true)
  }

  // 1–3 pick a segment, the same shape the Day Book uses for its voucher-type
  // filters. Only the first carries a visible hint; three rows of the same
  // thing would crowd the bar.
  const segmentActions: PageAction[] = SEGMENTS.map((s, i) => ({
    chord: String(i + 1),
    label: i === 0 ? 'Segment (1–3)' : SEGMENT_LABEL[s],
    run: () => selectSegment(s),
    hidden: i > 0,
    allowDefault: true,
  }))

  usePageKeyboard({
    actions: [
      { chord: 'Alt+X', label: 'Export CSV', run: exportCsv, when: rows.length > 0 },
      { chord: 'Alt+R', label: 'Refresh', run: load, when: !loading },
      ...segmentActions,
    ],
    searchRef: periodRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>HSN Summary</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>
          GSTR-1 Table 12 — HSN-wise outward supplies, B2B / B2C tabs, net of credit notes
        </p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker ref={bindPeriod} value={period} onChange={setPeriod} label="HSN summary period" />
        </div>
        {/* A single-choice filter, so it is announced as one: a radio group with
            arrow-key movement and one tab stop, not three unlabelled buttons
            whose selection was carried by colour alone. */}
        <div
          className="flex rounded-lg overflow-hidden border"
          style={{ borderColor: 'var(--line)' }}
          role="radiogroup"
          aria-label="Segment filter"
        >
          {SEGMENTS.map((s, i) => (
            <button
              key={s}
              type="button"
              ref={(el) => { segRefs.current[i] = el }}
              onClick={() => setSegment(s)}
              onKeyDown={(e) => onSegmentKeyDown(e, i)}
              role="radio"
              aria-checked={segment === s}
              aria-label={SEGMENT_LABEL[s]}
              aria-keyshortcuts={String(i + 1)}
              tabIndex={segment === s ? 0 : -1}
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
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
          aria-keyshortcuts="Alt+X"
          className="sm:ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border disabled:opacity-40"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
        >
          <Download size={13} /> Export CSV (Table 12)
        </button>
      </div>

      {/* Changing the period or the segment swaps the whole table while focus
          stays on the control that changed it. */}
      <div className="sr-only" role="status" aria-live="polite">
        {loading
          ? 'Loading HSN summary…'
          : `${rows.length} HSN rows for ${period}${segment === 'ALL' ? '' : `, ${segment}`}`}
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
        <Table label="HSN summary" aria-busy={loading}>
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
          <Tbody {...list.containerProps}>
            {loading ? (
              <tr><td colSpan={10} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-12 text-slate-400 text-sm">No HSN data available — generate GSTR-1 for this period first</td></tr>
            ) : rows.map((r, i) => (
              <Tr key={i} {...list.rowProps(i)}>
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

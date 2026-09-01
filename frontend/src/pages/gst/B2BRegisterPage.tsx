import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { getB2BRegister, type B2BRegisterRow, type RegisterTotals } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentPeriod } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'
import { useLocation } from '../../contexts/LocationContext'

export default function B2BRegisterPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<B2BRegisterRow[]>([])
  const [totals, setTotals] = useState<RegisterTotals | null>(null)
  const [invoiceCount, setInvoiceCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  // PeriodPicker forwards its ref to the MONTH select — the entry point of the
  // pair. That element is both the F2 target and what PageTransition focuses on
  // arrival, since the period is the only control on this screen.
  // usePageKeyboard only calls focus()/select?.(), both safe on a <select>.
  const periodRef = useRef<HTMLInputElement | null>(null)
  const bindPeriod = useCallback((el: HTMLSelectElement | null) => {
    el?.setAttribute('data-autofocus', '')
    periodRef.current = el as unknown as HTMLInputElement | null
  }, [])

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

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // A register row opens nothing, so this is the read-only variant: no
  // onActivate, but ↑↓/Home/End/PgUp/PgDn walk the rows through a single
  // roving tab stop, and Tab still steps clean past the whole register.
  const list = useListKeyboardNav({ count: rows.length })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+X', label: 'Export CSV', run: exportCsv, when: rows.length > 0 },
      { chord: 'Alt+R', label: 'Refresh', run: load },
    ],
    searchRef: periodRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

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
          <PeriodPicker ref={bindPeriod} value={period} onChange={setPeriod} label="B2B register period" />
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
          <Tbody {...list.containerProps}>
            {loading ? (
              <tr><td colSpan={11} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-12 text-slate-400 text-sm">No B2B supplies in this period</td></tr>
            ) : (
              rows.map((r, i) => (
                <Tr key={i} {...list.rowProps(i)}>
                  <Td className="font-mono text-xs text-slate-500">{r.gstin}</Td>
                  {/* Two buyers can share a 180px prefix, and the full name
                      used to live only in a hover title. It wraps inside the
                      same column width instead: every row reads in full, and
                      no column shifts under the cursor as ↑↓ move the focus. */}
                  <Td className="text-slate-700 max-w-[180px] whitespace-normal break-words">
                    {r.party_name}
                  </Td>
                  <Td className="font-mono text-xs text-teal-600">{r.invoice_no}</Td>
                  <Td className="text-slate-500">{formatDate(r.invoice_date)}</Td>
                  <Td className="text-right font-mono text-slate-500">{formatCurrency(r.invoice_value)}</Td>
                  <Td
                    className="font-mono text-xs text-slate-500"
                    title={r.supply_type === 'inter_state' ? 'Inter-state' : 'Intra-state'}
                  >
                    {r.place_of_supply}
                    {/* The state code alone does not say which way the supply
                        went; the hover title did, and nothing read it out. */}
                    <span className="sr-only">
                      {r.supply_type === 'inter_state' ? ' inter-state' : ' intra-state'}
                    </span>
                  </Td>
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

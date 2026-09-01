import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  generateGSTR1, getGSTR1Entries, getGSTR1DocSummary,
  type GSTR1Entry, type GSTR1DocSummaryRow,
} from '../../lib/api'
import { formatCurrency, formatDate, getCurrentPeriod } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'
import { useLocation } from '../../contexts/LocationContext'

export default function GSTR1Page() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<GSTR1Entry[]>([])
  const [docRows, setDocRows] = useState<GSTR1DocSummaryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  // PeriodPicker forwards its ref to the MONTH select — the entry point of the
  // pair. That element is both the F2 target and what PageTransition focuses on
  // arrival, since the period is what every other control here keys off.
  // usePageKeyboard only calls focus()/select?.(), both safe on a <select>.
  const periodRef = useRef<HTMLInputElement | null>(null)
  const bindPeriod = useCallback((el: HTMLSelectElement | null) => {
    el?.setAttribute('data-autofocus', '')
    periodRef.current = el as unknown as HTMLInputElement | null
  }, [])

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
    // Table 13 — documents issued (independent of entry generation).
    try {
      const docs = await getGSTR1DocSummary(period)
      setDocRows(docs.rows)
    } catch {
      setDocRows([])
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
    const headers = ['Invoice No', 'Date', 'Customer GSTIN', 'Type', 'Place of Supply', 'Rate (%)', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total']
    const rows = entries.map((e) => [
      e.invoice_no,
      e.invoice_date,
      e.customer_gstin,
      e.invoice_type,
      e.place_of_supply,
      e.rate,
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

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // The entry rows open nothing, so this is the read-only variant of the list
  // nav: one roving tab stop for the whole return, ↑↓/Home/End/PgUp/PgDn to
  // read down it, and Tab still steps out to the Table 13 card below.
  const list = useListKeyboardNav({ count: entries.length })
  // Table 13 is a second table on the same screen: it gets its own roving
  // stop so Tab reaches it in one press rather than through the return.
  const docList = useListKeyboardNav({ count: docRows.length })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'Generate', run: handleGenerate, when: !generating },
      { chord: 'Alt+R', label: 'Refresh', run: load },
      { chord: 'Alt+X', label: 'Export CSV', run: exportCSV },
    ],
    searchRef: periodRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>GSTR-1</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Outward supplies return — {entries.length} invoices</p>
        </div>
        <Button variant="secondary" onClick={exportCSV}>
          <Download size={15} />
          Export CSV
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 sm:gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker ref={bindPeriod} value={period} onChange={setPeriod} label="GSTR-1 period" />
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
              {/* The heading is abbreviated and its expansion sat in a hover
                  title on every cell. It belongs here, said once, where a
                  reader picks up the column name — not repeated per row. */}
              <Th className="text-left" title="Place of supply (state code)">
                PoS<span className="sr-only"> — place of supply (state code)</span>
              </Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">Taxable Value</Th>
              <Th className="text-right">CGST</Th>
              <Th className="text-right">SGST</Th>
              <Th className="text-right">IGST</Th>
            </Tr>
          </Thead>
          <Tbody {...list.containerProps}>
            {loading ? (
              <tr><td colSpan={10} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-12 text-slate-400 text-sm">No GSTR-1 entries. Generate to populate.</td></tr>
            ) : (
              entries.map((e, i) => (
                <Tr key={e.id} {...list.rowProps(i)}>
                  <Td className="font-mono text-xs text-teal-600">{e.invoice_no}</Td>
                  <Td className="text-slate-500">{formatDate(e.invoice_date)}</Td>
                  <Td className="font-mono text-xs text-slate-500">{e.customer_gstin || '-'}</Td>
                  <Td className="capitalize text-slate-500">{e.invoice_type}</Td>
                  <Td className="font-mono text-xs text-slate-500">{e.place_of_supply || '-'}</Td>
                  <Td className="text-right font-mono text-slate-500">{Number(e.rate) ? `${e.rate}%` : '-'}</Td>
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
                <td colSpan={6} className="py-3 px-4 text-sm text-slate-500">Totals ({entries.length} invoices)</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totalTaxable)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totalCGST)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totalSGST)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totalIGST)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>

      {/* Table 13 — Documents Issued */}
      <Card className="overflow-hidden">
        <div className="px-4 pt-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Documents Issued (Table 13)
          </h2>
          <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--ink-2)' }}>
            Serial ranges per document series for the period. Internal = inter-store
            transfer documents that consume serials but are not supplies.
          </p>
        </div>
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Nature of Document</Th>
              <Th className="text-left">Series</Th>
              <Th className="text-left">Sr. No. From</Th>
              <Th className="text-left">Sr. No. To</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Cancelled</Th>
              <Th className="text-right">Internal</Th>
              <Th className="text-right">Net Issued</Th>
            </Tr>
          </Thead>
          <Tbody {...docList.containerProps}>
            {docRows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400 text-sm">No documents issued in this period</td></tr>
            ) : docRows.map((d, i) => (
              <Tr key={i} {...docList.rowProps(i)}>
                <Td className="text-slate-700">{d.nature}</Td>
                <Td className="font-mono text-xs text-slate-500">{d.series || '—'}</Td>
                <Td className="font-mono text-xs">{d.sr_from}</Td>
                <Td className="font-mono text-xs">{d.sr_to}</Td>
                <Td className="text-right font-mono">{d.total_issued}</Td>
                <Td className="text-right font-mono text-red-700">{d.cancelled}</Td>
                <Td className="text-right font-mono text-slate-500">{d.internal}</Td>
                <Td className="text-right font-mono font-semibold">{d.net_issued}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

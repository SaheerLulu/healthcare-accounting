import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { generateGSTR2B, getGSTR2BEntries, toggleGSTR2BITC, type GSTR2BEntry } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentPeriod, cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'
import { useLocation } from '../../contexts/LocationContext'

export default function GSTR2BPage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<GSTR2BEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const [confirmGenerate, setConfirmGenerate] = useState(false)
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
    setConfirmGenerate(false)
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

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // The period is the only filter on this screen, so it is what F2 must reach
  // and where the caret belongs on arrival. PeriodPicker forwards its ref to
  // the MONTH select — the entry point of the pair — so that element is handed
  // straight to F2, and tagging it `data-autofocus` is what PageTransition's
  // post-navigation focus pass looks for.
  // usePageKeyboard only calls focus()/select?.(), both safe on a <select>.
  const periodRef = useRef<HTMLInputElement | null>(null)
  const bindPeriod = useCallback((el: HTMLSelectElement | null) => {
    el?.setAttribute('data-autofocus', '')
    periodRef.current = el as unknown as HTMLInputElement | null
  }, [])

  // A read-only cursor: the rows open nothing, but a keyboard user reviewing a
  // few hundred purchase invoices needs to walk them, and Tab from the cursor
  // row lands on that row's own ITC toggle rather than on the first row's.
  const list = useListKeyboardNav({ count: entries.length })

  // Generate is Alt+N, not Alt+R: Alt+R means refresh everywhere else, and
  // regenerating DELETES the PO-sourced rows for the period and rebuilds them,
  // discarding every ITC-eligibility toggle made on this screen. One keystroke
  // must not do that silently, so the chord and the button both open a confirm.
  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'Generate', run: () => setConfirmGenerate(true), when: !generating },
      { chord: 'Alt+R', label: 'Refresh', run: load, when: !loading },
    ],
    searchRef: periodRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>GSTR-2B</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Auto-populated purchase register — {entries.length} invoices</p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker ref={bindPeriod} value={period} onChange={setPeriod} label="GSTR-2B period" />
        </div>
        <Button onClick={() => setConfirmGenerate(true)} disabled={generating}>
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
          <Tbody {...list.containerProps}>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No GSTR-2B entries. Generate to populate.</td></tr>
            ) : entries.map((e, i) => (
              <Tr
                key={e.id}
                aria-label={`Invoice ${e.invoice_no} from ${e.supplier_name}, ${e.match_status}`}
                {...list.rowProps(i)}
              >
                <Td className="font-medium">{e.supplier_name}</Td>
                <Td className="font-mono text-xs text-slate-500">{e.supplier_gstin}</Td>
                <Td className="font-mono text-xs text-teal-600">{e.invoice_no}</Td>
                <Td className="text-slate-500">{formatDate(e.invoice_date)}</Td>
                <Td className="text-right font-mono">{formatCurrency(e.taxable_value)}</Td>
                <Td className="text-right font-mono text-slate-500">{formatCurrency(e.total_gst)}</Td>
                <Td className="text-center">
                  <button onClick={() => handleToggleITC(e.id)}
                    aria-pressed={e.itc_eligible}
                    aria-label={`ITC ${e.itc_eligible ? 'eligible' : 'not eligible'} on invoice ${e.invoice_no} — toggle`}
                    title="Toggle ITC eligibility"
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

      <ConfirmDialog
        open={confirmGenerate}
        onOpenChange={setConfirmGenerate}
        onConfirm={handleGenerate}
        title={`Regenerate GSTR-2B for ${period}?`}
        confirmLabel="Regenerate"
        tone="danger"
        loading={generating}
        description={
          <span>
            The auto-derived rows for this period are rebuilt from the purchase
            orders, so any ITC-eligibility toggles made here are lost. Rows
            uploaded from the government GSTR-2B JSON are kept.
          </span>
        }
      />
    </div>
  )
}

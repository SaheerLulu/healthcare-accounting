import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { runITCReconciliation, getITCReconciliation, type ITCReconciliationRow } from '../../lib/api'
import { formatCurrency, getCurrentPeriod } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'
import { useLocation } from '../../contexts/LocationContext'

export default function ITCReconciliationPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ITCReconciliationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const [confirmRun, setConfirmRun] = useState(false)
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (period) params.period = period
      const data = await getITCReconciliation(params)
      setRows(data)
    } catch {
      toast.error('Failed to load reconciliation data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [period, activeLocationId])

  async function handleRun() {
    setConfirmRun(false)
    if (!activeLocationId) {
      toast.error('Select a specific location to run reconciliation')
      return
    }
    setRunning(true)
    try {
      const result = await runITCReconciliation(period, activeLocationId)
      toast.success(`Reconciliation complete: ${result.matched} matched, ${result.unmatched} unmatched`)
      load()
    } catch {
      toast.error('Failed to run reconciliation')
    } finally {
      setRunning(false)
    }
  }

  function getStatusVariant(status: string) {
    const map: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
      matched: 'success',
      unmatched: 'error',
      partial: 'warning',
    }
    return map[status] || 'default'
  }

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // The period is the only filter here, so it takes F2 and the arrival focus.
  // PeriodPicker forwards its ref to the MONTH select — the entry point of the
  // pair — so that element is both the F2 target and, via `data-autofocus`,
  // what PageTransition's post-navigation focus pass lands on.
  // usePageKeyboard only calls focus()/select?.(), both safe on a <select>.
  const periodRef = useRef<HTMLInputElement | null>(null)
  const bindPeriod = useCallback((el: HTMLSelectElement | null) => {
    el?.setAttribute('data-autofocus', '')
    periodRef.current = el as unknown as HTMLInputElement | null
  }, [])

  // Read-only cursor: the rows open nothing, but reviewing fifty unmatched
  // GSTINs from the keyboard needs ↑↓/Home/End rather than a scrollbar.
  const list = useListKeyboardNav({ count: rows.length })

  // Alt+R stays refresh, as on every other GST screen. Running the
  // reconciliation DELETES the stored rows for the period and rebuilds them, so
  // it sits on Alt+N behind a confirm rather than on the chord a user reaches
  // for reflexively to re-read the table.
  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'Run reconciliation', run: () => setConfirmRun(true), when: !running },
      { chord: 'Alt+R', label: 'Refresh', run: load, when: !loading },
    ],
    searchRef: periodRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>ITC Reconciliation</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Books vs GSTR-2B comparison</p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker ref={bindPeriod} value={period} onChange={setPeriod} label="Reconciliation period" />
        </div>
        <Button onClick={() => setConfirmRun(true)} disabled={running}>
          {running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Run Reconciliation
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Supplier GSTIN</Th>
              <Th className="text-right px-3">Books Taxable</Th>
              <Th className="text-right px-3">Books GST</Th>
              <Th className="text-right px-3">2B Taxable</Th>
              <Th className="text-right px-3">2B GST</Th>
              <Th className="text-left">Status</Th>
            </Tr>
          </Thead>
          <Tbody {...list.containerProps}>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No reconciliation data. Run reconciliation to populate.</td></tr>
            ) : rows.map((r, i) => (
              <Tr
                key={r.id}
                aria-label={`Supplier ${r.supplier_gstin}, ${r.status}`}
                {...list.rowProps(i)}
              >
                <Td className="font-mono text-xs text-slate-500">{r.supplier_gstin}</Td>
                <Td className="text-right font-mono px-3">{formatCurrency(r.books_taxable)}</Td>
                <Td className="text-right font-mono text-slate-500 px-3">{formatCurrency(Number(r.books_cgst) + Number(r.books_sgst) + Number(r.books_igst))}</Td>
                <Td className="text-right font-mono px-3">{formatCurrency(r.gstr2b_taxable)}</Td>
                <Td className="text-right font-mono text-slate-500 px-3">{formatCurrency(Number(r.gstr2b_cgst) + Number(r.gstr2b_sgst) + Number(r.gstr2b_igst))}</Td>
                <Td><Badge variant={getStatusVariant(r.status)}>{r.status}</Badge></Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>

      <ConfirmDialog
        open={confirmRun}
        onOpenChange={setConfirmRun}
        onConfirm={handleRun}
        title={`Re-run reconciliation for ${period}?`}
        confirmLabel="Run reconciliation"
        tone="danger"
        loading={running}
        description={
          <span>
            The stored reconciliation for this period is discarded and rebuilt
            from the current GSTR-2B entries and books, including any action
            recorded against a supplier.
          </span>
        }
      />
    </div>
  )
}

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download, Loader2, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import api, {
  getPurchaseRegister, getPurchaseRegisterLines,
  type PurchaseLineRow, type PurchaseRegisterRow, type RegisterTotals,
} from '../../lib/api'
import { formatCurrency, formatDate, getCurrentFY } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td, type TrProps } from '../../components/ui/table'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

/**
 * The nested line-item table lives in its own sideways rail. Like the shared
 * <Table> primitive (components/ui/table.tsx), the rail earns a Tab stop only
 * while it actually overflows — this one is rendered once per expanded
 * invoice, so an ungated tabIndex would hand a wide screen one dead stop per
 * open row.
 */
function LineItemRail({ label, children }: { label: string; children: ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = useState(false)

  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const measure = () => setScrollable(el.scrollWidth > el.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const table = el.querySelector('table')
    if (table) ro.observe(table)
    return () => ro.disconnect()
  }, [])

  const railProps: HTMLAttributes<HTMLDivElement> = scrollable
    ? { tabIndex: 0, role: 'region', 'aria-label': `${label} — scrollable table` }
    : {}

  return (
    <div
      ref={railRef}
      className="table-scroll px-4 py-3 sm:px-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]"
      {...railProps}
    >
      {children}
    </div>
  )
}

function PurchaseRow({ row, isOpen, lines, loadingLines, onToggle, rowProps }: {
  row: PurchaseRegisterRow
  isOpen: boolean
  lines?: PurchaseLineRow[]
  loadingLines: boolean
  onToggle: () => void
  /** Roving-tabindex props from useListKeyboardNav — Enter/Space expand. */
  rowProps: TrProps
}) {
  return (
    <>
      <Tr
        onClick={onToggle}
        className="cursor-pointer"
        aria-expanded={isOpen}
        // Two suppliers can share the 200px prefix the cell shows, and the full
        // name is otherwise only in a hover title. The row label carries it
        // instead — widening the focused cell would reflow the whole
        // auto-layout table on every ↑/↓.
        aria-label={`${row.supplier_name}, invoice ${row.invoice_no} dated ${formatDate(row.invoice_date)}, ${formatCurrency(row.invoice_value)}`}
        {...rowProps}
      >
        <Td style={{ color: 'var(--ink-3)' }}>
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </Td>
        <Td className="mono text-xs" style={{ color: row.registered ? 'var(--ink-3)' : 'var(--danger)' }}>
          {row.supplier_gstin}
        </Td>
        <Td className="font-medium max-w-[200px] truncate" style={{ color: 'var(--ink)' }} title={row.supplier_name}>
          {row.supplier_name}
        </Td>
        <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>{row.invoice_no}</Td>
        <Td style={{ color: 'var(--ink-2)' }}>{formatDate(row.invoice_date)}</Td>
        <Td className="text-right mono">{formatCurrency(row.taxable_value)}</Td>
        <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(row.cgst)}</Td>
        <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(row.sgst)}</Td>
        <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(row.igst)}</Td>
        <Td className="text-right mono font-medium">{formatCurrency(row.invoice_value)}</Td>
      </Tr>
      {isOpen && (
        <tr>
          <td colSpan={10} className="px-0 py-0" style={{ background: 'var(--surface-1)' }}>
            {loadingLines || !lines ? (
              <div className="text-center py-6">
                <Loader2 size={18} className="animate-spin inline" style={{ color: 'var(--brand)' }} />
              </div>
            ) : lines.length === 0 ? (
              <div className="text-center py-4 text-xs" style={{ color: 'var(--ink-3)' }}>No line items</div>
            ) : (
              <LineItemRail label={`Line items for invoice ${row.invoice_no}`}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: 'var(--ink-2)' }}>
                      <th className="text-left pb-1.5 font-medium">Product</th>
                      <th className="text-left pb-1.5 font-medium">HSN</th>
                      <th className="text-left pb-1.5 font-medium">Batch</th>
                      <th className="text-left pb-1.5 font-medium">Expiry</th>
                      <th className="text-right pb-1.5 font-medium">Qty</th>
                      <th className="text-right pb-1.5 font-medium">Free</th>
                      <th className="text-right pb-1.5 font-medium">Rate</th>
                      <th className="text-right pb-1.5 font-medium">MRP</th>
                      <th className="text-right pb-1.5 font-medium">Disc %</th>
                      <th className="text-right pb-1.5 font-medium">GST %</th>
                      <th className="text-right pb-1.5 font-medium">Taxable</th>
                      <th className="text-right pb-1.5 font-medium">CGST</th>
                      <th className="text-right pb-1.5 font-medium">SGST</th>
                      <th className="text-right pb-1.5 font-medium">IGST</th>
                      <th className="text-right pb-1.5 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                        <td className="py-1 pr-2 max-w-[220px] truncate" style={{ color: 'var(--ink)' }} title={l.product_name}>
                          {l.product_name || '—'}
                        </td>
                        <td className="py-1 mono" style={{ color: 'var(--ink-3)' }}>{l.hsn_code || '—'}</td>
                        <td className="py-1 mono" style={{ color: 'var(--ink-3)' }}>{l.batch_no || '—'}</td>
                        <td className="py-1 mono" style={{ color: 'var(--ink-3)' }}>{l.expiry_month || '—'}</td>
                        <td className="py-1 text-right mono" style={{ color: 'var(--ink)' }}>{Number(l.quantity)}</td>
                        <td className="py-1 text-right mono" style={{ color: 'var(--ink-2)' }}>{Number(l.free_qty) || '—'}</td>
                        <td className="py-1 text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(l.purchase_rate)}</td>
                        <td className="py-1 text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(l.mrp)}</td>
                        <td className="py-1 text-right mono" style={{ color: 'var(--ink-2)' }}>{Number(l.discount_percent) ? `${Number(l.discount_percent)}%` : '—'}</td>
                        <td className="py-1 text-right mono" style={{ color: 'var(--ink-2)' }}>{Number(l.tax_percent)}%</td>
                        <td className="py-1 text-right mono" style={{ color: 'var(--ink)' }}>{formatCurrency(l.taxable_value)}</td>
                        <td className="py-1 text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(l.cgst)}</td>
                        <td className="py-1 text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(l.sgst)}</td>
                        <td className="py-1 text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(l.igst)}</td>
                        <td className="py-1 text-right mono font-medium" style={{ color: 'var(--ink)' }}>{formatCurrency(l.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </LineItemRail>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function PurchaseRegisterPage() {
  const navigate = useNavigate()
  const fy = getCurrentFY()
  const [rows, setRows] = useState<PurchaseRegisterRow[]>([])
  const [totals, setTotals] = useState<RegisterTotals | null>(null)
  const [counts, setCounts] = useState({ registered: 0, unregistered: 0 })
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(fy.start)
  const [dateTo, setDateTo] = useState(fy.end)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [lineCache, setLineCache] = useState<Record<number, PurchaseLineRow[]>>({})
  const [linesLoading, setLinesLoading] = useState<Set<number>>(new Set())
  const fromRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await getPurchaseRegister({ start_date: dateFrom, end_date: dateTo })
      setRows(res.rows)
      setTotals(res.totals)
      setCounts({ registered: res.registered_count, unregistered: res.unregistered_count })
      setFetched(true)
      setExpanded(new Set())
      setLineCache({})
    } catch {
      toast.error('Failed to load purchase register')
    } finally {
      setLoading(false)
    }
  }

  async function toggleRow(poId: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(poId)) next.delete(poId)
      else next.add(poId)
      return next
    })
    if (lineCache[poId] || linesLoading.has(poId)) return
    setLinesLoading((prev) => new Set(prev).add(poId))
    try {
      const detail = await getPurchaseRegisterLines(poId)
      setLineCache((prev) => ({ ...prev, [poId]: detail.lines }))
    } catch {
      toast.error('Failed to load purchase lines')
      setExpanded((prev) => {
        const next = new Set(prev)
        next.delete(poId)
        return next
      })
    } finally {
      setLinesLoading((prev) => {
        const next = new Set(prev)
        next.delete(poId)
        return next
      })
    }
  }

  async function exportAs(fmt: 'csv' | 'xlsx') {
    try {
      const res = await api.get('/reports/purchase-register/', {
        params: { start_date: dateFrom, end_date: dateTo, export: fmt },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Purchase_Register_${dateFrom}_${dateTo}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed')
    }
  }

  // ─── Keyboard ────────────────────────────────────────────────────────────
  // An invoice row expands its line items, which on its own was a pointer-only
  // affordance: a <tr> is not focusable and does not answer Enter. The roving
  // tabindex gives the register one tab stop, ↑↓ to walk it and Enter to open
  // the lines, and Tab still steps clean past the whole table.
  const list = useListKeyboardNav({
    count: rows.length,
    onActivate: (i) => toggleRow(rows[i].po_id),
  })

  const isDefaultRange = dateFrom === fy.start && dateTo === fy.end
  const resetRange = () => { setDateFrom(fy.start); setDateTo(fy.end) }

  usePageKeyboard({
    actions: [
      { chord: 'Alt+R', label: 'Run report', run: load, when: !loading },
      { chord: 'Alt+X', label: 'Export CSV', run: () => exportAs('csv'), when: rows.length > 0 },
      { chord: 'Alt+C', label: 'Clear filters', run: resetRange, when: !isDefaultRange },
    ],
    searchRef: fromRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Purchase Register</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Supplier-invoice-wise inventory purchases with GST split. Inter-store transfers excluded.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => exportAs('csv')} disabled={rows.length === 0} chord="Alt+X">
            <Download size={15} />CSV
          </Button>
          <Button variant="secondary" onClick={() => exportAs('xlsx')} disabled={rows.length === 0}>
            <Download size={15} />Excel
          </Button>
        </div>
      </div>

      {/* Period filters — a form, so Enter in either date runs the report */}
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => { e.preventDefault(); load() }}
      >
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>From</label>
          <Input ref={fromRef} data-autofocus type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-auto" />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-auto" />
        </div>
        <Button type="submit" className="w-full sm:w-auto" disabled={loading} chord="Alt+R">
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
        {fetched && (
          <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
            {counts.registered} registered · {counts.unregistered} unregistered supplier invoices
          </span>
        )}
      </form>

      {loading ? (
        <SkeletonTable rows={8} cols={9} />
      ) : !fetched ? (
        <EmptyState
          icon={ShoppingCart}
          title="Run the purchase register"
          description="Select a date range and click Run Report to list supplier invoices with taxable value and GST split."
          actionLabel="Run Report"
          onAction={load}
        />
      ) : rows.length === 0 ? (
        <EmptyState variant="no-data" title="No purchases in this range" description="Try widening your date range." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table label="Purchase register">
            <Thead>
              <Tr>
                <Th className="w-8"></Th>
                <Th className="text-left">Supplier GSTIN</Th>
                <Th className="text-left">Supplier</Th>
                <Th className="text-left">Invoice No</Th>
                <Th className="text-left">Date</Th>
                <Th className="text-right">Taxable Value</Th>
                <Th className="text-right">CGST</Th>
                <Th className="text-right">SGST</Th>
                <Th className="text-right">IGST</Th>
                <Th className="text-right">Invoice Value</Th>
              </Tr>
            </Thead>
            <Tbody {...list.containerProps}>
              {rows.map((r, i) => {
                const isOpen = expanded.has(r.po_id)
                const lines = lineCache[r.po_id]
                return (
                  <PurchaseRow
                    key={r.po_id}
                    row={r}
                    isOpen={isOpen}
                    lines={lines}
                    loadingLines={linesLoading.has(r.po_id)}
                    onToggle={() => toggleRow(r.po_id)}
                    rowProps={list.rowProps(i)}
                  />
                )
              })}
            </Tbody>
            {totals && (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--color-grey-light)' }} className="font-semibold">
                  <td colSpan={5} className="py-3 px-4 text-sm" style={{ color: 'var(--ink-2)' }}>Totals ({rows.length} invoices)</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.taxable_value)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.cgst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.sgst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.igst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.invoice_value ?? '0')}</td>
                </tr>
              </tfoot>
            )}
          </Table>
        </Card>
      )}
    </div>
  )
}

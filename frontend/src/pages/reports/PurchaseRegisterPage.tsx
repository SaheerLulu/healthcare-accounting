import { useState } from 'react'
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
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'

function PurchaseRow({ row, isOpen, lines, loadingLines, onToggle }: {
  row: PurchaseRegisterRow
  isOpen: boolean
  lines?: PurchaseLineRow[]
  loadingLines: boolean
  onToggle: () => void
}) {
  return (
    <>
      <Tr onClick={onToggle} className="cursor-pointer">
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
              <div className="px-10 py-3 overflow-x-auto">
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
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function PurchaseRegisterPage() {
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

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Purchase Register</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Supplier-invoice-wise inventory purchases with GST split. Inter-store transfers excluded.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => exportAs('csv')} disabled={rows.length === 0}>
            <Download size={15} />CSV
          </Button>
          <Button variant="secondary" onClick={() => exportAs('xlsx')} disabled={rows.length === 0}>
            <Download size={15} />Excel
          </Button>
        </div>
      </div>

      {/* Period filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
        {fetched && (
          <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
            {counts.registered} registered · {counts.unregistered} unregistered supplier invoices
          </span>
        )}
      </div>

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
          <Table>
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
            <Tbody>
              {rows.map((r) => {
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

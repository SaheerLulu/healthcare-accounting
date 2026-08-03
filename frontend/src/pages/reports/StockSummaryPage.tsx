import { useMemo, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  getStockMovement, getStockValuation,
  type StockMovementRow, type StockValuationRow,
} from '../../lib/api'
import { formatCurrency, getCurrentFY } from '../../lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'

/** Case-insensitive substring match on the product name. */
function filterByProduct<T extends { product_name: string }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => (r.product_name || '').toLowerCase().includes(q))
}

/**
 * Product filter for both tabs.
 *
 * Each report arrives as one unpaginated payload, so this narrows the rows
 * already in memory — no request, and so nothing to debounce. It composes with
 * the date filters above it rather than replacing them: those choose which
 * report to fetch, this chooses which of its rows to show.
 */
function ProductSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-full sm:w-64">
      <Search
        className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: 'var(--ink-3)' }}
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search products…"
        aria-label="Search products by name"
        className="pl-8 pr-8"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear product search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--color-hover-bg)]"
          style={{ color: 'var(--ink-3)' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

function NoProductsFound({ colSpan, query, onClear }: { colSpan: number; query: string; onClear: () => void }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center py-12 text-sm" style={{ color: 'var(--ink-3)' }}>
        No products found for “{query}”.{' '}
        <button type="button" onClick={onClear} className="hover:underline" style={{ color: 'var(--brand)' }}>
          Clear search
        </button>
      </td>
    </tr>
  )
}

function StockMovementTab() {
  const fy = getCurrentFY()
  const [rows, setRows] = useState<StockMovementRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(fy.start)
  const [dateTo, setDateTo] = useState(fy.end)
  const [search, setSearch] = useState('')

  const visible = useMemo(() => filterByProduct(rows, search), [rows, search])

  async function load() {
    setLoading(true)
    try {
      const res = await getStockMovement({ start_date: dateFrom, end_date: dateTo })
      setRows(res.rows)
      setFetched(true)
    } catch { toast.error('Failed to load stock movement') }
    finally { setLoading(false) }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs text-slate-500 font-medium">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-auto px-2.5 py-1.5" />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs text-slate-500 font-medium">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-auto px-2.5 py-1.5" />
        </div>
        <Button className="w-full sm:w-auto" onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
        {fetched && <ProductSearch value={search} onChange={setSearch} />}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th>Product</Th>
              <Th>HSN</Th>
              <Th className="text-right">Opening</Th>
              <Th className="text-right">Inward</Th>
              <Th className="text-right">Outward</Th>
              <Th className="text-right">Closing</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : !fetched ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">Select date range and run report</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No stock movement data</td></tr>
            ) : visible.length === 0 ? (
              <NoProductsFound colSpan={6} query={search.trim()} onClear={() => setSearch('')} />
            ) : visible.map((row) => (
              <Tr key={row.product_id}>
                <Td className="font-medium text-sm">{row.product_name}</Td>
                <Td className="text-xs text-slate-500 font-mono">{row.hsn_code || '-'}</Td>
                <Td className="text-right font-mono text-sm">{row.opening_qty}</Td>
                <Td className="text-right font-mono text-sm text-emerald-600">{row.inward_qty > 0 ? `+${row.inward_qty}` : '-'}</Td>
                <Td className="text-right font-mono text-sm text-red-600">{row.outward_qty > 0 ? `-${row.outward_qty}` : '-'}</Td>
                <Td className="text-right font-mono text-sm font-semibold">{row.closing_qty}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

function StockValuationTab() {
  const [rows, setRows] = useState<StockValuationRow[]>([])
  const [totalValue, setTotalValue] = useState('0.00')
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0])
  const [search, setSearch] = useState('')

  const visible = useMemo(() => filterByProduct(rows, search), [rows, search])
  const isFiltered = visible.length !== rows.length
  // The server's total covers every product, so once a search narrows the list
  // it would contradict the rows on screen. Re-sum what is actually shown.
  const shownValue = useMemo(
    () => (isFiltered
      ? visible.reduce((s, r) => s + (parseFloat(r.value) || 0), 0)
      : totalValue),
    [isFiltered, visible, totalValue],
  )

  async function load() {
    setLoading(true)
    try {
      const res = await getStockValuation({ date: asOfDate })
      setRows(res.rows)
      setTotalValue(res.total_value)
      setFetched(true)
    } catch { toast.error('Failed to load stock valuation') }
    finally { setLoading(false) }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs text-slate-500 font-medium">As of</label>
          <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-full sm:w-auto px-2.5 py-1.5" />
        </div>
        <Button className="w-full sm:w-auto" onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
        {fetched && <ProductSearch value={search} onChange={setSearch} />}
        {fetched && (
          <span className="w-full sm:w-auto ml-auto text-sm text-slate-600">
            {isFiltered ? 'Value of matches' : 'Total Value'}:{' '}
            <span className="font-mono font-semibold text-slate-900">{formatCurrency(shownValue)}</span>
          </span>
        )}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th>Product</Th>
              <Th>HSN</Th>
              <Th className="text-right">Closing Qty</Th>
              <Th className="text-right">Avg Rate</Th>
              <Th className="text-right">Value</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : !fetched ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-400 text-sm">Select date and run report</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-400 text-sm">No stock data</td></tr>
            ) : visible.length === 0 ? (
              <NoProductsFound colSpan={5} query={search.trim()} onClear={() => setSearch('')} />
            ) : visible.map((row) => (
              <Tr key={row.product_id}>
                <Td className="font-medium text-sm">{row.product_name}</Td>
                <Td className="text-xs text-slate-500 font-mono">{row.hsn_code || '-'}</Td>
                <Td className="text-right font-mono text-sm">{row.closing_qty}</Td>
                <Td className="text-right font-mono text-sm">{formatCurrency(row.avg_rate)}</Td>
                <Td className="text-right font-mono text-sm font-semibold">{formatCurrency(row.value)}</Td>
              </Tr>
            ))}
          </Tbody>
          {fetched && visible.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={4} className="py-3 px-4 text-sm text-slate-500">
                  {isFiltered
                    ? `Matching ${visible.length} of ${rows.length} products`
                    : `Total (${rows.length} products)`}
                </td>
                <td className="py-3 px-4 text-right font-mono text-sm">{formatCurrency(shownValue)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
    </div>
  )
}

export default function StockSummaryPage() {
  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Stock Summary</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Inventory movement and valuation reports</p>
      </div>

      <Tabs defaultValue="movement">
        <TabsList>
          <TabsTrigger value="movement">Stock Movement</TabsTrigger>
          <TabsTrigger value="valuation">Stock Valuation</TabsTrigger>
        </TabsList>
        <TabsContent value="movement"><StockMovementTab /></TabsContent>
        <TabsContent value="valuation"><StockValuationTab /></TabsContent>
      </Tabs>
    </div>
  )
}

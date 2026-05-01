import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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

function StockMovementTab() {
  const fy = getCurrentFY()
  const [rows, setRows] = useState<StockMovementRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(fy.start)
  const [dateTo, setDateTo] = useState(fy.end)

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
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto px-2.5 py-1.5" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto px-2.5 py-1.5" />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
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
            ) : rows.map((row) => (
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
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">As of</label>
          <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-auto px-2.5 py-1.5" />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
        {fetched && (
          <span className="ml-auto text-sm text-slate-600">
            Total Value: <span className="font-mono font-semibold text-slate-900">{formatCurrency(totalValue)}</span>
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
            ) : rows.map((row) => (
              <Tr key={row.product_id}>
                <Td className="font-medium text-sm">{row.product_name}</Td>
                <Td className="text-xs text-slate-500 font-mono">{row.hsn_code || '-'}</Td>
                <Td className="text-right font-mono text-sm">{row.closing_qty}</Td>
                <Td className="text-right font-mono text-sm">{formatCurrency(row.avg_rate)}</Td>
                <Td className="text-right font-mono text-sm font-semibold">{formatCurrency(row.value)}</Td>
              </Tr>
            ))}
          </Tbody>
          {fetched && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={4} className="py-3 px-4 text-sm text-slate-500">Total ({rows.length} products)</td>
                <td className="py-3 px-4 text-right font-mono text-sm">{formatCurrency(totalValue)}</td>
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
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Stock Summary</h1>
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

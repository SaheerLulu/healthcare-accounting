import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getReceivablesAging, type ReceivablesAgingRow } from '../lib/api'
import { formatCurrency } from '../lib/utils'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'

export default function ReceivablesPage() {
  const [rows, setRows] = useState<ReceivablesAgingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [asOf, setAsOf] = useState(new Date().toISOString().split('T')[0])

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (asOf) params.date = asOf
      const res = await getReceivablesAging(params)
      setRows(res.rows)
    } catch {
      toast.error('Failed to load receivables aging')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [asOf])

  const totals = rows.reduce(
    (acc, row) => ({
      total: acc.total + Number(row.total_outstanding),
      d0_30: acc.d0_30 + Number(row.aging_0_30),
      d31_60: acc.d31_60 + Number(row.aging_31_60),
      d61_90: acc.d61_90 + Number(row.aging_61_90),
      d90plus: acc.d90plus + Number(row.aging_90_plus),
    }),
    { total: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }
  )

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Receivables Aging</h1>
          <p className="text-sm text-slate-500 mt-0.5">Outstanding amounts by customer</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">As of</label>
          <Input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="w-auto px-2.5 py-1.5"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Customer Name</Th>
              <Th className="text-right">Total Outstanding</Th>
              <Th className="text-right">0–30 Days</Th>
              <Th className="text-right">31–60 Days</Th>
              <Th className="text-right">61–90 Days</Th>
              <Th className="text-right">90+ Days</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-12">
                  <Loader2 size={24} className="animate-spin inline text-teal-600" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-400 text-sm">
                  No receivables data found
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <Tr key={i}>
                  <Td className="font-medium">{row.customer_name}</Td>
                  <Td className="text-right font-mono font-semibold">
                    {formatCurrency(row.total_outstanding)}
                  </Td>
                  <Td className="text-right font-mono text-slate-500">
                    {formatCurrency(row.aging_0_30)}
                  </Td>
                  <Td className="text-right font-mono text-amber-700">
                    {formatCurrency(row.aging_31_60)}
                  </Td>
                  <Td className="text-right font-mono text-orange-700">
                    {formatCurrency(row.aging_61_90)}
                  </Td>
                  <Td className="text-right font-mono text-red-700">
                    {formatCurrency(row.aging_90_plus)}
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="py-3 px-4 text-sm text-slate-500">Total</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatCurrency(totals.total)}</td>
                <td className="py-3 px-4 text-right font-mono text-slate-500">{formatCurrency(totals.d0_30)}</td>
                <td className="py-3 px-4 text-right font-mono text-amber-700">{formatCurrency(totals.d31_60)}</td>
                <td className="py-3 px-4 text-right font-mono text-orange-700">{formatCurrency(totals.d61_90)}</td>
                <td className="py-3 px-4 text-right font-mono text-red-700">{formatCurrency(totals.d90plus)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
    </div>
  )
}

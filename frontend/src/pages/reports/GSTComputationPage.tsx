import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getGSTComputation, type GSTComputation } from '../../lib/api'
import { formatCurrency, getCurrentPeriod } from '../../lib/utils'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card, CardContent } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { useLocation } from '../../contexts/LocationContext'

export default function GSTComputationPage() {
  const [data, setData] = useState<GSTComputation | null>(null)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = { period }
      const result = await getGSTComputation(params)
      setData(result)
    } catch {
      toast.error('Failed to load GST computation')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (period) load() }, [period, activeLocationId])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">GST Computation</h1>
        <p className="text-sm text-slate-500 mt-0.5">Tax computation worksheet</p>
      </div>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-teal-600" /></div>
      ) : !data ? (
        <Card className="p-12 text-center text-slate-400 text-sm">Select a period to view computation</Card>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Output Tax */}
          <Card className="overflow-hidden">
            <CardContent>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Output Tax (Sales)</h2>
              <Table>
                <Thead>
                  <Tr className="bg-slate-50">
                    <Th className="text-left">Rate</Th>
                    <Th className="text-right">Taxable</Th>
                    <Th className="text-right">CGST</Th>
                    <Th className="text-right">SGST</Th>
                    <Th className="text-right">IGST</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {data.output_tax.by_rate.map((r) => (
                    <Tr key={r.rate}>
                      <Td className="text-slate-500">{r.rate}%</Td>
                      <Td className="text-right font-mono text-slate-900">{formatCurrency(r.taxable)}</Td>
                      <Td className="text-right font-mono text-slate-500">{formatCurrency(r.cgst)}</Td>
                      <Td className="text-right font-mono text-slate-500">{formatCurrency(r.sgst)}</Td>
                      <Td className="text-right font-mono text-slate-500">{formatCurrency(r.igst)}</Td>
                    </Tr>
                  ))}
                </Tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="py-2.5 px-4 text-slate-500">Total Output</td>
                    <td className="py-2.5 px-4 text-right" />
                    <td className="py-2.5 px-4 text-right font-mono text-slate-900">{formatCurrency(data.output_tax.total_cgst)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-900">{formatCurrency(data.output_tax.total_sgst)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-900">{formatCurrency(data.output_tax.total_igst)}</td>
                  </tr>
                </tfoot>
              </Table>
            </CardContent>
          </Card>

          {/* Input Tax */}
          <Card>
            <CardContent>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Input Tax Credit (Purchases)</h2>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 bg-emerald-50 rounded-lg">
                  <p className="text-xs text-slate-500">CGST</p>
                  <p className="text-lg font-bold text-emerald-700 font-mono">{formatCurrency(data.input_tax.cgst)}</p>
                </div>
                <div className="text-center p-3 bg-emerald-50 rounded-lg">
                  <p className="text-xs text-slate-500">SGST</p>
                  <p className="text-lg font-bold text-emerald-700 font-mono">{formatCurrency(data.input_tax.sgst)}</p>
                </div>
                <div className="text-center p-3 bg-emerald-50 rounded-lg">
                  <p className="text-xs text-slate-500">IGST</p>
                  <p className="text-lg font-bold text-emerald-700 font-mono">{formatCurrency(data.input_tax.igst)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Net Payable */}
          <Card>
            <CardContent>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Net Tax Payable</h2>
              <div className="grid grid-cols-4 gap-4">
                {['cgst', 'sgst', 'igst'].map((key) => (
                  <div key={key} className="text-center p-3 bg-red-50 rounded-lg">
                    <p className="text-xs text-slate-500 uppercase">{key}</p>
                    <p className="text-lg font-bold text-red-700 font-mono">{formatCurrency((data.net_payable as Record<string, string>)[key])}</p>
                  </div>
                ))}
                <div className="text-center p-3 bg-teal-50 rounded-lg">
                  <p className="text-xs text-slate-500">Total</p>
                  <p className="text-lg font-bold text-teal-600 font-mono">{formatCurrency(data.net_payable.total)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

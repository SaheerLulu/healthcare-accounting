import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getPartyOutstanding, type PartyOutstandingRow } from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { useLocation } from '../../contexts/LocationContext'

export default function PartyOutstandingPage() {
  const [rows, setRows] = useState<PartyOutstandingRow[]>([])
  const [total, setTotal] = useState('0')
  const [loading, setLoading] = useState(true)
  const [partyType, setPartyType] = useState('Customer')
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = { party_type: partyType }
      const data = await getPartyOutstanding(params)
      setRows(data.rows)
      setTotal(data.total_outstanding)
    } catch {
      toast.error('Failed to load outstanding data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [partyType, activeLocationId])

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Party Outstanding</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Outstanding balances by {partyType.toLowerCase()} — Total: {formatCurrency(total)}</p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 mb-5 flex-wrap">
        <select value={partyType} onChange={(e) => setPartyType(e.target.value)}
          className="w-full sm:w-auto px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
          <option value="Customer">Customers</option>
          <option value="Supplier">Suppliers</option>
        </select>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Party</Th>
              <Th className="text-left">GSTIN</Th>
              <Th className="text-left">PAN</Th>
              <Th className="text-right px-3">Invoices</Th>
              <Th className="text-right px-3">Payments</Th>
              <Th className="text-right px-3">Outstanding</Th>
              <Th className="text-right px-3">0-30d</Th>
              <Th className="text-right px-3">31-60d</Th>
              <Th className="text-right px-3">61-90d</Th>
              <Th className="text-right px-3">90+d</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={10} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-12 text-slate-400 text-sm">No outstanding balances</td></tr>
            ) : rows.map((r) => (
              <Tr key={r.party_id}>
                <Td className="font-medium">
                  {r.party_name}
                  {r.msme_category ? (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-50 text-violet-700"
                      title={`MSME ${r.msme_category} — §16 MSMED 45-day payment rule applies`}>
                      MSME
                    </span>
                  ) : null}
                </Td>
                <Td className="font-mono text-xs text-slate-500">{r.gstin || '—'}</Td>
                <Td className="font-mono text-xs text-slate-500">{r.pan || '—'}</Td>
                <Td className="text-right font-mono text-slate-500 px-3">{formatCurrency(r.invoices)}</Td>
                <Td className="text-right font-mono text-slate-500 px-3">{formatCurrency(r.payments)}</Td>
                <Td className="text-right font-mono font-semibold px-3">{formatCurrency(r.closing_balance)}</Td>
                <Td className="text-right font-mono text-emerald-700 px-3">{formatCurrency(r.aging_0_30)}</Td>
                <Td className="text-right font-mono text-amber-700 px-3">{formatCurrency(r.aging_31_60)}</Td>
                <Td className="text-right font-mono text-orange-700 px-3">{formatCurrency(r.aging_61_90)}</Td>
                <Td className="text-right font-mono text-red-700 px-3">{formatCurrency(r.aging_90_plus)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

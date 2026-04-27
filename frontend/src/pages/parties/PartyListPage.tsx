import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { getPartiesList, type PartyListRow, type PartyType } from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { Badge } from '../../components/ui/badge'
import { useLocation } from '../../contexts/LocationContext'

export default function PartyListPage({ partyType }: { partyType: PartyType }) {
  const [rows, setRows] = useState<PartyListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const { activeLocationId } = useLocation()

  async function load() {
    setLoading(true)
    try {
      const params = search ? { search } : undefined
      const data = await getPartiesList(partyType, params)
      setRows(data.rows)
    } catch {
      toast.error(`Failed to load ${partyType.toLowerCase()}s`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [search, activeLocationId, partyType])

  const totals = useMemo(() => {
    let outstanding = 0
    for (const r of rows) outstanding += parseFloat(r.outstanding) || 0
    return { count: rows.length, outstanding }
  }, [rows])

  const baseRoute = partyType === 'Supplier' ? '/parties/suppliers' : '/parties/customers'
  const heading = partyType === 'Supplier' ? 'Suppliers' : 'Customers'
  const outstandingLabel = partyType === 'Supplier' ? 'Payable' : 'Receivable'

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">{heading}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {totals.count} {heading.toLowerCase()} • Total {outstandingLabel.toLowerCase()}: {formatCurrency(totals.outstanding)}
        </p>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${heading.toLowerCase()}…`}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      <Card className="overflow-x-auto overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Name</Th>
              <Th className="text-left">GSTIN</Th>
              <Th className="text-left">City / State</Th>
              <Th className="text-left">Contact</Th>
              <Th className="text-right px-3">Invoices</Th>
              <Th className="text-right px-3">{outstandingLabel}</Th>
              <Th className="text-left">Last Txn</Th>
              <Th className="text-left">Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">
                {search ? `No ${heading.toLowerCase()} matches "${search}"` : `No ${heading.toLowerCase()} found`}
              </td></tr>
            ) : rows.map((r) => (
              <Tr key={r.id}>
                <Td className="font-medium">
                  <Link to={`${baseRoute}/${r.id}`} className="text-teal-700 hover:text-teal-800 hover:underline">
                    {r.name}
                  </Link>
                  {partyType === 'Customer' && r.customer_type && (
                    <span className="ml-2 text-xs text-slate-400">{r.customer_type}</span>
                  )}
                </Td>
                <Td className="font-mono text-xs text-slate-600">{r.gst_no || '—'}</Td>
                <Td className="text-sm text-slate-600">
                  {[r.city, r.state].filter(Boolean).join(', ') || '—'}
                </Td>
                <Td className="text-sm text-slate-600">
                  <div>{r.phone || '—'}</div>
                  {r.email && <div className="text-xs text-slate-400">{r.email}</div>}
                </Td>
                <Td className="text-right font-mono text-slate-500 px-3">{r.invoice_count}</Td>
                <Td className={`text-right font-mono font-semibold px-3 ${parseFloat(r.outstanding) > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                  {formatCurrency(r.outstanding)}
                </Td>
                <Td className="text-sm text-slate-500">
                  {r.last_transaction_date ? formatDate(r.last_transaction_date) : '—'}
                </Td>
                <Td>
                  <Badge variant={r.status?.toLowerCase() === 'active' ? 'success' : 'default'}>
                    {r.status || '—'}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

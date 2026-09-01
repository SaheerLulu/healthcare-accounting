import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  CUSTOMER_TYPES, getPartiesList, type PartyListRow, type PartyType,
} from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { Badge } from '../../components/ui/badge'
import { MasterPage } from '../../components/ui/MasterPage'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'
import { useLocation } from '../../contexts/LocationContext'

export default function PartyListPage({ partyType }: { partyType: PartyType }) {
  const [rows, setRows] = useState<PartyListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // '' = every type. Only meaningful for customers — suppliers have no such
  // field on the inventory master.
  const [customerType, setCustomerType] = useState('')
  const { activeLocationId } = useLocation()
  const isCustomer = partyType === 'Customer'

  async function load() {
    setLoading(true)
    try {
      const params: { search?: string; customer_type?: string } = {}
      if (search) params.search = search
      if (isCustomer && customerType) params.customer_type = customerType
      const data = await getPartiesList(
        partyType, Object.keys(params).length ? params : undefined)
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
  }, [search, customerType, activeLocationId, partyType])

  // Switching Customers <-> Suppliers reuses this component, so a type left
  // selected on the customer list would otherwise be sent for suppliers too.
  useEffect(() => { setCustomerType('') }, [partyType])

  const totals = useMemo(() => {
    let outstanding = 0
    for (const r of rows) outstanding += parseFloat(r.outstanding) || 0
    return { count: rows.length, outstanding }
  }, [rows])

  const baseRoute = partyType === 'Supplier' ? '/parties/suppliers' : '/parties/customers'
  const heading = partyType === 'Supplier' ? 'Suppliers' : 'Customers'
  const outstandingLabel = partyType === 'Supplier' ? 'Payable' : 'Receivable'

  return (
    <div className="max-w-7xl mx-auto">
      <MasterPage
        title={heading}
        subtitle={
          <span>
            <span className="mono">{totals.count}</span> {heading.toLowerCase()} · Total {outstandingLabel.toLowerCase()}{' '}
            <span className="mono font-medium" style={{ color: 'var(--ink)' }}>{formatCurrency(totals.outstanding)}</span>
          </span>
        }
        searchValue={search}
        searchPlaceholder={`Search ${heading.toLowerCase()}…`}
        onSearchChange={setSearch}
        toolbar={isCustomer ? (
          <select
            value={customerType}
            onChange={(e) => setCustomerType(e.target.value)}
            aria-label="Filter by customer type"
            className="h-9 px-2.5 rounded-md text-sm outline-none"
            style={{
              border: '1px solid var(--line)',
              background: 'var(--surface-0)',
              color: 'var(--ink)',
            }}
          >
            <option value="">All types</option>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        ) : undefined}
      >
        {loading ? (
          <SkeletonTable rows={8} cols={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            variant={search || customerType ? 'no-results' : 'no-data'}
            title={
              search
                ? `No ${heading.toLowerCase()} match "${search}"`
                : customerType
                  ? `No ${customerType} customers`
                  : `No ${heading.toLowerCase()} yet`
            }
            description={
              search || customerType
                ? 'Try a different search term or type filter.'
                : `Sync inventory or add ${heading.toLowerCase()} to get started.`
            }
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <Table>
              <Thead>
                <Tr>
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
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-medium">
                      <Link to={`${baseRoute}/${r.id}`} className="hover:underline" style={{ color: 'var(--brand)' }}>
                        {r.name}
                      </Link>
                      {partyType === 'Customer' && r.customer_type && (
                        <span className="ml-2 text-xs" style={{ color: 'var(--ink-3)' }}>{r.customer_type}</span>
                      )}
                    </Td>
                    <Td className="mono text-xs" style={{ color: 'var(--ink-2)' }}>{r.gst_no || '—'}</Td>
                    <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>
                      {[r.city, r.state].filter(Boolean).join(', ') || '—'}
                    </Td>
                    <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>
                      <div>{r.phone || '—'}</div>
                      {r.email && <div className="text-xs" style={{ color: 'var(--ink-3)' }}>{r.email}</div>}
                    </Td>
                    <Td className="text-right mono px-3" style={{ color: 'var(--ink-2)' }}>{r.invoice_count}</Td>
                    <Td
                      className="text-right mono font-semibold px-3"
                      style={{ color: parseFloat(r.outstanding) > 0 ? 'var(--warning)' : 'var(--ink-2)' }}
                    >
                      {formatCurrency(r.outstanding)}
                    </Td>
                    <Td className="text-sm" style={{ color: 'var(--ink-3)' }}>
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
        )}
      </MasterPage>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus, Search, Calendar, X, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getBills, getBillCounts,
  type Bill, type BillCounts, type BillStatus,
} from '../../lib/api'
import { formatCurrency, formatDate, cn } from '../../lib/utils'
import { useLocation } from '../../contexts/LocationContext'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'

const STATUS_LABEL: Record<BillStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  partially_paid: 'Partial',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

const STATUS_BADGE: Record<BillStatus, 'default' | 'success' | 'warning' | 'info' | 'error'> = {
  draft: 'default',
  open: 'warning',
  partially_paid: 'info',
  paid: 'success',
  cancelled: 'error',
}

type Filter = 'all' | BillStatus | 'overdue'

export default function BillsListPage() {
  const navigate = useNavigate()
  const { activeLocationId } = useLocation()
  const [bills, setBills] = useState<Bill[]>([])
  const [counts, setCounts] = useState<BillCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search) params.search = search
      if (filter === 'overdue') params.overdue = 'true'
      else if (filter !== 'all') params.status = filter
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const [list, c] = await Promise.all([getBills(params), getBillCounts()])
      setBills(list.results)
      setCounts(c)
    } catch {
      toast.error('Failed to load bills')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter, dateFrom, dateTo, activeLocationId])

  const today = new Date().toISOString().slice(0, 10)
  const isOverdue = (b: Bill) =>
    b.due_date && b.due_date < today && (b.status === 'open' || b.status === 'partially_paid')

  const totals = useMemo(() => {
    let total = 0, paid = 0
    for (const b of bills) {
      total += parseFloat(b.total_amount) || 0
      paid += parseFloat(b.amount_paid) || 0
    }
    return { total, paid, balance: total - paid }
  }, [bills])

  const hasFilters = !!(search || filter !== 'all' || dateFrom || dateTo)

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Bills</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{counts?.total ?? 0}</span> bills · Outstanding{' '}
            <span className="font-medium mono" style={{ color: 'var(--warning)' }}>
              {formatCurrency(counts?.outstanding ?? '0')}
            </span>
            {(counts?.overdue ?? 0) > 0 && (
              <span className="ml-2 inline-flex items-center gap-1" style={{ color: 'var(--danger)' }}>
                <AlertCircle size={12} /> <span className="mono">{counts?.overdue}</span> overdue
              </span>
            )}
          </p>
        </div>
        <Button onClick={() => navigate('/bills/new')}>
          <Plus size={16} /> New Bill
        </Button>
      </div>

      {/* Status pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusPill label="All" count={counts?.total ?? 0} active={filter === 'all'} onClick={() => setFilter('all')} />
        <StatusPill label="Open" count={counts?.by_status?.open ?? 0} active={filter === 'open'} dotColor="var(--warning)" onClick={() => setFilter('open')} />
        <StatusPill label="Overdue" count={counts?.overdue ?? 0} active={filter === 'overdue'} dotColor="var(--danger)" onClick={() => setFilter('overdue')} />
        <StatusPill label="Partial" count={counts?.by_status?.partially_paid ?? 0} active={filter === 'partially_paid'} dotColor="var(--info)" onClick={() => setFilter('partially_paid')} />
        <StatusPill label="Paid" count={counts?.by_status?.paid ?? 0} active={filter === 'paid'} dotColor="var(--success)" onClick={() => setFilter('paid')} />
        <StatusPill label="Draft" count={counts?.by_status?.draft ?? 0} active={filter === 'draft'} dotColor="var(--ink-3)" onClick={() => setFilter('draft')} />
      </div>

      {/* Search + date range */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[12rem] sm:min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bill #, vendor, notes…" className="pl-9" />
        </div>
        <div
          className="flex items-center gap-1 px-2 h-9 rounded-md w-full sm:w-auto"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-0)' }}
        >
          <Calendar size={13} className="flex-shrink-0" style={{ color: 'var(--ink-3)' }} />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="text-xs bg-transparent focus:outline-none min-w-0 flex-1 sm:flex-initial" style={{ color: 'var(--ink)' }} />
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--ink-3)' }}>→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="text-xs bg-transparent focus:outline-none min-w-0 flex-1 sm:flex-initial" style={{ color: 'var(--ink)' }} />
        </div>
        {hasFilters && (
          <button onClick={() => { setSearch(''); setFilter('all'); setDateFrom(''); setDateTo('') }}
            className="text-xs hover:underline inline-flex items-center gap-1" style={{ color: 'var(--ink-2)' }}>
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : bills.length === 0 ? (
        <EmptyState
          variant={hasFilters ? 'no-results' : 'no-data'}
          title={hasFilters ? 'No bills match your filters' : 'No bills yet'}
          description={hasFilters ? 'Try adjusting your search or clearing filters.' : 'Add your first bill from a supplier to start tracking payables.'}
          actionLabel={hasFilters ? undefined : 'New Bill'}
          onAction={hasFilters ? undefined : () => navigate('/bills/new')}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">Bill #</Th>
                <Th className="text-left">Date</Th>
                <Th className="text-left">Due</Th>
                <Th className="text-left">Vendor</Th>
                <Th className="text-right px-3">Total</Th>
                <Th className="text-right px-3">Balance</Th>
                <Th className="text-left">Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {bills.map((b) => {
                const overdue = isOverdue(b)
                return (
                  <Tr key={b.id} className="cursor-pointer" onClick={() => navigate(`/bills/${b.id}`)}>
                    <Td>
                      <Link to={`/bills/${b.id}`} onClick={(e) => e.stopPropagation()}
                        className="font-medium hover:underline mono" style={{ color: 'var(--brand)' }}>
                        {b.bill_no || `BILL-${b.id}`}
                      </Link>
                    </Td>
                    <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>{formatDate(b.bill_date)}</Td>
                    <Td className={cn('text-sm', overdue && 'font-medium')}
                      style={{ color: overdue ? 'var(--danger)' : 'var(--ink-2)' }}>
                      {b.due_date ? formatDate(b.due_date) : '—'}
                      {overdue && <span className="ml-1 text-xs">(overdue)</span>}
                    </Td>
                    <Td className="text-sm" style={{ color: 'var(--ink)' }}>{b.vendor_name}</Td>
                    <Td className="text-right mono px-3" style={{ color: 'var(--ink)' }}>{formatCurrency(b.total_amount)}</Td>
                    <Td className={cn('text-right mono px-3', parseFloat(b.balance_due) > 0 && 'font-semibold')}
                      style={{ color: parseFloat(b.balance_due) > 0 ? 'var(--warning)' : 'var(--ink-2)' }}>
                      {formatCurrency(b.balance_due)}
                    </Td>
                    <Td>
                      <Badge variant={STATUS_BADGE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        </Card>
      )}

      {bills.length > 0 && (
        <div className="text-xs flex flex-wrap items-center justify-end gap-x-4 gap-y-1 px-2" style={{ color: 'var(--ink-2)' }}>
          <span>Total: <span className="mono font-medium" style={{ color: 'var(--ink)' }}>{formatCurrency(totals.total)}</span></span>
          <span>Paid: <span className="mono font-medium" style={{ color: 'var(--success)' }}>{formatCurrency(totals.paid)}</span></span>
          <span>Balance: <span className="mono font-medium" style={{ color: 'var(--warning)' }}>{formatCurrency(totals.balance)}</span></span>
        </div>
      )}
    </div>
  )
}

function StatusPill({ label, count, active, dotColor, onClick }: {
  label: string
  count: number
  active: boolean
  dotColor?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-3 h-9 sm:h-8 rounded-full text-xs font-medium transition-colors"
      style={{
        background: active ? 'rgba(15,157,154,0.10)' : 'var(--surface-0)',
        border: `1px solid ${active ? 'rgba(15,157,154,0.35)' : 'var(--line)'}`,
        color: active ? 'var(--brand)' : 'var(--ink-2)',
      }}
    >
      {dotColor && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />}
      {label}
      <span className="text-[10px] mono" style={{ color: active ? 'var(--brand)' : 'var(--ink-3)' }}>
        {count}
      </span>
    </button>
  )
}

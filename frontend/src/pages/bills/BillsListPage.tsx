import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus, Loader2, Search, Calendar, X, AlertCircle,
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
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Bills</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {counts?.total ?? 0} bills · Outstanding{' '}
            <span className="font-medium text-amber-700">{formatCurrency(counts?.outstanding ?? '0')}</span>
            {(counts?.overdue ?? 0) > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-rose-700">
                <AlertCircle size={12} /> {counts?.overdue} overdue
              </span>
            )}
          </p>
        </div>
        <Button onClick={() => navigate('/bills/new')}>
          <Plus size={16} /> New Bill
        </Button>
      </div>

      {/* Status pills */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <StatusPill label="All" count={counts?.total ?? 0} active={filter === 'all'} onClick={() => setFilter('all')} />
        <StatusPill label="Open" count={counts?.by_status?.open ?? 0} active={filter === 'open'} dot="bg-amber-400" onClick={() => setFilter('open')} />
        <StatusPill label="Overdue" count={counts?.overdue ?? 0} active={filter === 'overdue'} dot="bg-rose-500" onClick={() => setFilter('overdue')} />
        <StatusPill label="Partially Paid" count={counts?.by_status?.partially_paid ?? 0} active={filter === 'partially_paid'} dot="bg-sky-400" onClick={() => setFilter('partially_paid')} />
        <StatusPill label="Paid" count={counts?.by_status?.paid ?? 0} active={filter === 'paid'} dot="bg-emerald-500" onClick={() => setFilter('paid')} />
        <StatusPill label="Draft" count={counts?.by_status?.draft ?? 0} active={filter === 'draft'} dot="bg-slate-400" onClick={() => setFilter('draft')} />
      </div>

      {/* Search + date range */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bill #, vendor, notes…" className="pl-9 py-1.5" />
        </div>
        <div className="flex items-center gap-1 px-2 py-1 border border-slate-200 rounded-lg bg-white">
          <Calendar size={13} className="text-slate-400" />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="text-xs bg-transparent focus:outline-none" />
          <span className="text-slate-300 text-xs">→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="text-xs bg-transparent focus:outline-none" />
        </div>
        {hasFilters && (
          <button onClick={() => { setSearch(''); setFilter('all'); setDateFrom(''); setDateTo('') }}
            className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
            <X size={12} /> Clear
          </button>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
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
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : bills.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">No bills match your filters</td></tr>
            ) : bills.map((b) => {
              const overdue = isOverdue(b)
              return (
                <Tr key={b.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/bills/${b.id}`)}>
                  <Td>
                    <Link to={`/bills/${b.id}`} onClick={(e) => e.stopPropagation()}
                      className="font-medium text-teal-700 hover:underline">
                      {b.bill_no || `BILL-${b.id}`}
                    </Link>
                  </Td>
                  <Td className="text-sm text-slate-600">{formatDate(b.bill_date)}</Td>
                  <Td className={cn('text-sm', overdue ? 'text-rose-700 font-medium' : 'text-slate-500')}>
                    {b.due_date ? formatDate(b.due_date) : '—'}
                    {overdue && <span className="ml-1 text-xs">(overdue)</span>}
                  </Td>
                  <Td className="text-sm text-slate-700">{b.vendor_name}</Td>
                  <Td className="text-right font-mono px-3">{formatCurrency(b.total_amount)}</Td>
                  <Td className={cn('text-right font-mono px-3', parseFloat(b.balance_due) > 0 && 'text-amber-700 font-semibold')}>
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

      {bills.length > 0 && (
        <div className="mt-3 text-xs text-slate-500 flex items-center justify-end gap-4 px-2">
          <span>Total: <span className="font-mono font-medium text-slate-700">{formatCurrency(totals.total)}</span></span>
          <span>Paid: <span className="font-mono font-medium text-emerald-700">{formatCurrency(totals.paid)}</span></span>
          <span>Balance: <span className="font-mono font-medium text-amber-700">{formatCurrency(totals.balance)}</span></span>
        </div>
      )}
    </div>
  )
}

function StatusPill({ label, count, active, dot, onClick }: {
  label: string
  count: number
  active: boolean
  dot?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
        active
          ? 'bg-teal-50 border-teal-200 text-teal-700'
          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />}
      {label}
      <span className={cn('text-[10px] tabular-nums', active ? 'text-teal-600' : 'text-slate-400')}>
        {count}
      </span>
    </button>
  )
}

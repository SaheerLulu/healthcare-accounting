import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Loader2, Search, Calendar, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  getExpenses, getExpenseCounts,
  type Expense, type ExpenseCounts, type ExpenseStatus,
} from '../../lib/api'
import { formatCurrency, formatDate, cn } from '../../lib/utils'
import { useLocation } from '../../contexts/LocationContext'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'

const STATUS_BADGE: Record<ExpenseStatus, 'default' | 'success'> = {
  draft: 'default',
  recorded: 'success',
}

type Filter = 'all' | ExpenseStatus

export default function ExpensesListPage() {
  const navigate = useNavigate()
  const { activeLocationId } = useLocation()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [counts, setCounts] = useState<ExpenseCounts | null>(null)
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
      if (filter !== 'all') params.status = filter
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const [list, c] = await Promise.all([getExpenses(params), getExpenseCounts()])
      setExpenses(list.results)
      setCounts(c)
    } catch {
      toast.error('Failed to load expenses')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter, dateFrom, dateTo, activeLocationId])

  const totals = useMemo(() => {
    let total = 0
    for (const e of expenses) total += parseFloat(e.total_amount) || 0
    return total
  }, [expenses])

  const hasFilters = !!(search || filter !== 'all' || dateFrom || dateTo)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Expenses</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {counts?.total ?? 0} expenses · Total spent{' '}
            <span className="font-medium text-slate-700">{formatCurrency(counts?.total_amount ?? '0')}</span>
          </p>
        </div>
        <Button onClick={() => navigate('/expenses/new')}><Plus size={16} /> New Expense</Button>
      </div>

      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <Pill label="All" count={counts?.total ?? 0} active={filter === 'all'} onClick={() => setFilter('all')} />
        <Pill label="Draft" count={counts?.by_status?.draft ?? 0} active={filter === 'draft'} dot="bg-slate-400" onClick={() => setFilter('draft')} />
        <Pill label="Recorded" count={counts?.by_status?.recorded ?? 0} active={filter === 'recorded'} dot="bg-emerald-500" onClick={() => setFilter('recorded')} />
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor, reference, notes…" className="pl-9 py-1.5" />
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
              <Th className="text-left">Date</Th>
              <Th className="text-left">Vendor</Th>
              <Th className="text-left">Paid Through</Th>
              <Th className="text-left">Reference</Th>
              <Th className="text-right px-3">Amount</Th>
              <Th className="text-left">Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : expenses.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No expenses match your filters</td></tr>
            ) : expenses.map((e) => (
              <Tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/expenses/${e.id}`)}>
                <Td className="text-sm text-slate-600">{formatDate(e.expense_date)}</Td>
                <Td>
                  <Link to={`/expenses/${e.id}`} onClick={(ev) => ev.stopPropagation()}
                    className="font-medium text-teal-700 hover:underline">
                    {e.vendor_name || `Expense #${e.id}`}
                  </Link>
                  {e.is_itemized && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">Itemized</span>
                  )}
                </Td>
                <Td className="text-sm text-slate-600">
                  <span className="font-mono text-xs text-slate-400 mr-1">{e.paid_through_code}</span>
                  {e.paid_through_name}
                </Td>
                <Td className="text-sm text-slate-500">{e.reference || '—'}</Td>
                <Td className="text-right font-mono px-3">{formatCurrency(e.total_amount)}</Td>
                <Td><Badge variant={STATUS_BADGE[e.status]}>{e.status === 'recorded' ? 'Recorded' : 'Draft'}</Badge></Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>

      {expenses.length > 0 && (
        <div className="mt-3 text-xs text-slate-500 flex items-center justify-end gap-4 px-2">
          <span>Total on page: <span className="font-mono font-medium text-slate-700">{formatCurrency(totals)}</span></span>
        </div>
      )}
    </div>
  )
}

function Pill({ label, count, active, dot, onClick }: {
  label: string
  count: number
  active: boolean
  dot?: string
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className={cn(
      'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
      active
        ? 'bg-teal-50 border-teal-200 text-teal-700'
        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
    )}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />}
      {label}
      <span className={cn('text-[10px] tabular-nums', active ? 'text-teal-600' : 'text-slate-400')}>{count}</span>
    </button>
  )
}

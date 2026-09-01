import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Calendar, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  getExpenses, getExpenseCounts,
  type Expense, type ExpenseCounts, type ExpenseStatus,
} from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { useLocation } from '../../contexts/LocationContext'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

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
  const searchRef = useRef<HTMLInputElement>(null)
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

  // Rows open a record on click, which a keyboard cannot do to a <tr>. Roving
  // focus makes ↑↓ walk the list and Enter open the highlighted row.
  const list = useListKeyboardNav({
    count: expenses.length,
    onActivate: (i) => navigate(`/expenses/${expenses[i].id}`),
  })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'New expense', run: () => navigate('/expenses/new') },
      { chord: 'Alt+R', label: 'Refresh', run: load },
    ],
    searchRef,
    onFocusList: list.focusList,
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Expenses</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{counts?.total ?? 0}</span> expenses · Total spent{' '}
            <span className="mono font-medium" style={{ color: 'var(--ink)' }}>{formatCurrency(counts?.total_amount ?? '0')}</span>
          </p>
        </div>
        <Button onClick={() => navigate('/expenses/new')}><Plus size={16} /> New Expense</Button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <Pill label="All" count={counts?.total ?? 0} active={filter === 'all'} onClick={() => setFilter('all')} />
        <Pill label="Draft" count={counts?.by_status?.draft ?? 0} active={filter === 'draft'} dotColor="var(--ink-3)" onClick={() => setFilter('draft')} />
        <Pill label="Recorded" count={counts?.by_status?.recorded ?? 0} active={filter === 'recorded'} dotColor="var(--success)" onClick={() => setFilter('recorded')} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px] sm:max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
          <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor, reference, notes… (F2)" className="pl-9" />
        </div>
        <div
          className="flex items-center gap-1 px-2 h-9 rounded-md w-full sm:w-auto"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-0)' }}
        >
          <Calendar size={13} className="flex-shrink-0" style={{ color: 'var(--ink-3)' }} />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="text-xs bg-transparent focus:outline-none min-w-0" style={{ color: 'var(--ink)' }} />
          <span className="text-xs" style={{ color: 'var(--ink-3)' }}>→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="text-xs bg-transparent focus:outline-none min-w-0" style={{ color: 'var(--ink)' }} />
        </div>
        {hasFilters && (
          <button onClick={() => { setSearch(''); setFilter('all'); setDateFrom(''); setDateTo('') }}
            className="text-xs hover:underline inline-flex items-center gap-1" style={{ color: 'var(--ink-2)' }}>
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={6} />
      ) : expenses.length === 0 ? (
        <EmptyState
          variant={hasFilters ? 'no-results' : 'no-data'}
          title={hasFilters ? 'No expenses match your filters' : 'No expenses recorded'}
          description={hasFilters ? 'Try adjusting your search or clearing filters.' : 'Log your first business expense to start tracking outflows.'}
          actionLabel={hasFilters ? undefined : 'New Expense'}
          onAction={hasFilters ? undefined : () => navigate('/expenses/new')}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">Date</Th>
                <Th className="text-left">Vendor</Th>
                <Th className="text-left">Paid Through</Th>
                <Th className="text-left">Reference</Th>
                <Th className="text-right px-3">Amount</Th>
                <Th className="text-left">Status</Th>
              </Tr>
            </Thead>
            <Tbody {...list.containerProps}>
              {expenses.map((e, i) => (
                <Tr
                  key={e.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/expenses/${e.id}`)}
                  {...list.rowProps(i)}
                >
                  <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>{formatDate(e.expense_date)}</Td>
                  <Td>
                    <Link to={`/expenses/${e.id}`} onClick={(ev) => ev.stopPropagation()}
                      className="font-medium hover:underline" style={{ color: 'var(--brand)' }}>
                      {e.vendor_name || `Expense #${e.id}`}
                    </Link>
                    {e.is_itemized && (
                      <span className="ml-2 text-[10px] mono uppercase" style={{ color: 'var(--ink-3)', letterSpacing: '0.08em' }}>
                        Itemized
                      </span>
                    )}
                  </Td>
                  <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>
                    <span className="mono text-xs mr-1" style={{ color: 'var(--ink-3)' }}>{e.paid_through_code}</span>
                    {e.paid_through_name}
                  </Td>
                  <Td className="text-sm" style={{ color: 'var(--ink-3)' }}>{e.reference || '—'}</Td>
                  <Td className="text-right mono px-3" style={{ color: 'var(--ink)' }}>{formatCurrency(e.total_amount)}</Td>
                  <Td><Badge variant={STATUS_BADGE[e.status]}>{e.status === 'recorded' ? 'Recorded' : 'Draft'}</Badge></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}

      {expenses.length > 0 && (
        <div className="text-xs flex items-center justify-end gap-4 px-2" style={{ color: 'var(--ink-2)' }}>
          <span>Total on page: <span className="mono font-medium" style={{ color: 'var(--ink)' }}>{formatCurrency(totals)}</span></span>
        </div>
      )}
    </div>
  )
}

function Pill({ label, count, active, dotColor, onClick }: {
  label: string
  count: number
  active: boolean
  dotColor?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-3 h-8 rounded-full text-xs font-medium transition-colors"
      style={{
        background: active ? 'rgba(15,157,154,0.10)' : 'var(--surface-0)',
        border: `1px solid ${active ? 'rgba(15,157,154,0.35)' : 'var(--line)'}`,
        color: active ? 'var(--brand)' : 'var(--ink-2)',
      }}
    >
      {dotColor && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />}
      {label}
      <span className="text-[10px] mono" style={{ color: active ? 'var(--brand)' : 'var(--ink-3)' }}>{count}</span>
    </button>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Loader2, Search, Repeat, Play, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  getRecurringBills, runDueRecurringBills,
  type RecurringBill, type RecurringStatus,
} from '../../lib/api'
import { formatCurrency, formatDate, cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'

const STATUS_BADGE: Record<RecurringStatus, 'default' | 'success' | 'warning' | 'error'> = {
  active: 'success',
  paused: 'warning',
  stopped: 'default',
}

const FREQ_LABEL: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', yearly: 'Yearly',
}

type Filter = 'all' | RecurringStatus

export default function RecurringBillsListPage() {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<RecurringBill[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filter !== 'all') params.status = filter
      if (search) params.search = search
      const list = await getRecurringBills(params)
      setProfiles(list.results)
    } catch {
      toast.error('Failed to load recurring bills')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search])

  async function handleRunDue() {
    setRunning(true)
    try {
      const res = await runDueRecurringBills()
      if (res.created > 0) toast.success(`Generated ${res.created} bill(s)`)
      else toast.info('Nothing was due to generate')
      if (res.errors.length > 0) toast.error(`${res.errors.length} profile(s) errored — check details`)
      load()
    } catch {
      toast.error('Run failed')
    } finally { setRunning(false) }
  }

  const today = new Date().toISOString().slice(0, 10)
  const counts = useMemo(() => {
    let active = 0, paused = 0, stopped = 0, due = 0
    for (const p of profiles) {
      if (p.status === 'active') active++
      else if (p.status === 'paused') paused++
      else stopped++
      if (p.status === 'active' && p.next_run_date <= today) due++
    }
    return { active, paused, stopped, due, total: profiles.length }
  }, [profiles, today])

  const hasFilters = filter !== 'all' || !!search

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Recurring Bills</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Templates that auto-generate bills on a schedule (rent, utilities, retainers).
            {counts.due > 0 && (
              <span className="ml-2 inline-flex items-center gap-1" style={{ color: 'var(--warning)' }}>
                <AlertCircle size={12} /> <span className="mono">{counts.due}</span> due to generate
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={handleRunDue} disabled={running}>
            {running ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
            Run Due Now
          </Button>
          <Button onClick={() => navigate('/bills/recurring/new')}>
            <Plus size={16} /> New Profile
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <Pill label="All" count={counts.total} active={filter === 'all'} onClick={() => setFilter('all')} />
        <Pill label="Active" count={counts.active} active={filter === 'active'} dotColor="var(--success)" onClick={() => setFilter('active')} />
        <Pill label="Paused" count={counts.paused} active={filter === 'paused'} dotColor="var(--warning)" onClick={() => setFilter('paused')} />
        <Pill label="Stopped" count={counts.stopped} active={filter === 'stopped'} dotColor="var(--ink-3)" onClick={() => setFilter('stopped')} />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search profile name or vendor…" className="pl-9" />
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : profiles.length === 0 ? (
        <EmptyState
          variant={hasFilters ? 'no-results' : 'no-data'}
          title={hasFilters ? 'No profiles match your filter' : 'No recurring bills yet'}
          description={hasFilters ? 'Try adjusting your search or clearing filters.' : 'Schedule monthly rent, utilities, or retainers — bills generate automatically.'}
          actionLabel={hasFilters ? undefined : 'New Profile'}
          onAction={hasFilters ? undefined : () => navigate('/bills/recurring/new')}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">Profile</Th>
                <Th className="text-left">Vendor</Th>
                <Th className="text-left">Frequency</Th>
                <Th className="text-left">Next Run</Th>
                <Th className="text-right px-3">Amount</Th>
                <Th className="text-right px-3">Generated</Th>
                <Th className="text-left">Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {profiles.map((p) => {
                const isDue = p.status === 'active' && p.next_run_date <= today
                return (
                  <Tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/bills/recurring/${p.id}`)}>
                    <Td>
                      <Link to={`/bills/recurring/${p.id}`} onClick={(e) => e.stopPropagation()}
                        className="font-medium hover:underline inline-flex items-center gap-1.5" style={{ color: 'var(--brand)' }}>
                        <Repeat size={13} /> {p.profile_name}
                      </Link>
                      {p.auto_approve && (
                        <span className="ml-2 text-[10px] mono uppercase" style={{ color: 'var(--success)', letterSpacing: '0.08em' }}>Auto-approve</span>
                      )}
                    </Td>
                    <Td className="text-sm" style={{ color: 'var(--ink)' }}>{p.vendor_name}</Td>
                    <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>{FREQ_LABEL[p.frequency] || p.frequency}</Td>
                    <Td className={cn('text-sm', isDue && 'font-medium')} style={{ color: isDue ? 'var(--warning)' : 'var(--ink-2)' }}>
                      {formatDate(p.next_run_date)}
                      {isDue && <span className="ml-1 text-xs">(due)</span>}
                    </Td>
                    <Td className="text-right mono px-3" style={{ color: 'var(--ink)' }}>{formatCurrency(p.total_amount)}</Td>
                    <Td className="text-right text-sm mono px-3" style={{ color: 'var(--ink-2)' }}>{p.generated_count}</Td>
                    <Td><Badge variant={STATUS_BADGE[p.status]}>{p.status}</Badge></Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        </Card>
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
      className="inline-flex items-center gap-2 px-3 h-9 sm:h-8 rounded-full text-xs font-medium transition-colors"
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

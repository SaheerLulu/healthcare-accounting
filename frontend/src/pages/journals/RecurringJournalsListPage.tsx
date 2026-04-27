import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Loader2, Search, Repeat, Play, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  getRecurringJournals, runDueRecurringJournals,
  type RecurringJournal, type RecurringStatus,
} from '../../lib/api'
import { formatDate, cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'

const STATUS_BADGE: Record<RecurringStatus, 'default' | 'success' | 'warning' | 'error'> = {
  active: 'success', paused: 'warning', stopped: 'default',
}
const FREQ_LABEL: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly',
}
type Filter = 'all' | RecurringStatus

export default function RecurringJournalsListPage() {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<RecurringJournal[]>([])
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
      const list = await getRecurringJournals(params)
      setProfiles(list.results)
    } catch { toast.error('Failed to load recurring journals') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search])

  async function handleRunDue() {
    setRunning(true)
    try {
      const res = await runDueRecurringJournals()
      if (res.created > 0) toast.success(`Generated ${res.created} entry(ies)`)
      else toast.info('Nothing was due')
      if (res.errors.length > 0) toast.error(`${res.errors.length} profile(s) errored`)
      load()
    } catch { toast.error('Run failed') }
    finally { setRunning(false) }
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Recurring Journals</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Templates that auto-post journal entries on a schedule (depreciation, accruals, prepaid expenses).
            {counts.due > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-700">
                <AlertCircle size={12} /> {counts.due} due to generate
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleRunDue} disabled={running}>
            {running ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
            Run Due Now
          </Button>
          <Button onClick={() => navigate('/journals/recurring/new')}>
            <Plus size={16} /> New Profile
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <Pill label="All" count={counts.total} active={filter === 'all'} onClick={() => setFilter('all')} />
        <Pill label="Active" count={counts.active} active={filter === 'active'} dot="bg-emerald-500" onClick={() => setFilter('active')} />
        <Pill label="Paused" count={counts.paused} active={filter === 'paused'} dot="bg-amber-400" onClick={() => setFilter('paused')} />
        <Pill label="Stopped" count={counts.stopped} active={filter === 'stopped'} dot="bg-slate-400" onClick={() => setFilter('stopped')} />
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search profile name or narration…" className="pl-9 py-1.5" />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th className="text-left">Profile</Th>
              <Th className="text-left">Voucher</Th>
              <Th className="text-left">Frequency</Th>
              <Th className="text-left">Next Run</Th>
              <Th className="text-right px-3">Lines</Th>
              <Th className="text-right px-3">Generated</Th>
              <Th className="text-left">Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : profiles.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">
                {filter === 'all'
                  ? 'No recurring journals yet. Create one for monthly depreciation, accruals, etc.'
                  : 'No profiles match your filter'}
              </td></tr>
            ) : profiles.map((p) => {
              const isDue = p.status === 'active' && p.next_run_date <= today
              return (
                <Tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/journals/recurring/${p.id}`)}>
                  <Td>
                    <Link to={`/journals/recurring/${p.id}`} onClick={(e) => e.stopPropagation()}
                      className="font-medium text-teal-700 hover:underline inline-flex items-center gap-1.5">
                      <Repeat size={13} className="text-teal-600" /> {p.profile_name}
                    </Link>
                    {p.auto_post && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-700">Auto-post</span>
                    )}
                  </Td>
                  <Td className="text-sm text-slate-600">{p.voucher_type_display}</Td>
                  <Td className="text-sm text-slate-600">{FREQ_LABEL[p.frequency] || p.frequency}</Td>
                  <Td className={cn('text-sm', isDue ? 'text-amber-700 font-medium' : 'text-slate-600')}>
                    {formatDate(p.next_run_date)}
                    {isDue && <span className="ml-1 text-xs">(due)</span>}
                  </Td>
                  <Td className="text-right text-sm text-slate-500 px-3">{p.lines.length}</Td>
                  <Td className="text-right text-sm text-slate-500 px-3">{p.generated_count}</Td>
                  <Td><Badge variant={STATUS_BADGE[p.status]}>{p.status}</Badge></Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      </Card>
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

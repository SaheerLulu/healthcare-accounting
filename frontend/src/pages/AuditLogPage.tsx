import { useEffect, useState, useCallback, Fragment } from 'react'
import { getAuditLogs, type AuditLog, type AuditLogParams } from '../lib/api'
import { toast } from 'sonner'
import { Search, ScrollText } from 'lucide-react'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeletons'
import { Pagination } from '../components/ui/Pagination'

const ACTION_COLORS: Record<string, { bg: string; fg: string }> = {
  CREATE:   { bg: 'rgba(31,138,76,0.10)', fg: 'var(--success)' },
  UPDATE:   { bg: 'rgba(37,99,235,0.10)', fg: 'var(--info)' },
  DELETE:   { bg: 'rgba(192,57,43,0.10)', fg: 'var(--danger)' },
  POST:     { bg: 'rgba(15,157,154,0.10)', fg: 'var(--brand)' },
  REVERSE:  { bg: 'rgba(199,122,17,0.10)', fg: 'var(--warning)' },
  GENERATE: { bg: 'rgba(124,58,237,0.10)', fg: '#7c3aed' },
  SYNC:     { bg: 'var(--color-grey-light)', fg: 'var(--ink)' },
}

function ActionBadge({ action }: { action: string }) {
  const c = ACTION_COLORS[action] ?? { bg: 'var(--color-grey-light)', fg: 'var(--ink-2)' }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded mono text-xs font-medium"
      style={{ background: c.bg, color: c.fg, letterSpacing: '0.04em' }}
    >
      {action}
    </span>
  )
}

function formatTimestamp(ts: string) {
  const d = new Date(ts)
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

const MODEL_OPTIONS = [
  '', 'ChartOfAccount', 'JournalEntry', 'GSTR1Entry', 'GSTR3BSummary',
  'TDSDeduction', 'AccountingSettings', 'SyncLog',
]
const ACTION_OPTIONS = ['', 'CREATE', 'UPDATE', 'DELETE', 'POST', 'REVERSE', 'GENERATE', 'SYNC']

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterModel, setFilterModel] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const PAGE_SIZE = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: AuditLogParams = { page }
      if (search) params.search = search
      if (filterAction) params.action = filterAction
      if (filterModel) params.model_name = filterModel
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const data = await getAuditLogs(params)
      setLogs(data.results)
      setCount(data.count)
    } catch {
      toast.error('Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [page, search, filterAction, filterModel, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    load()
  }

  const totalPages = Math.ceil(count / PAGE_SIZE)

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Audit Log</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>Track all create, update, delete, and system actions.</p>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-2 items-end">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
          <Input
            className="pl-8 pr-3 w-52"
            placeholder="Search object / user…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="h-9 px-3 text-sm rounded-md outline-none"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-0)', color: 'var(--ink)' }}
          value={filterAction}
          onChange={(e) => { setFilterAction(e.target.value); setPage(1) }}
        >
          <option value="">All Actions</option>
          {ACTION_OPTIONS.filter(Boolean).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          className="h-9 px-3 text-sm rounded-md outline-none"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-0)', color: 'var(--ink)' }}
          value={filterModel}
          onChange={(e) => { setFilterModel(e.target.value); setPage(1) }}
        >
          <option value="">All Models</option>
          {MODEL_OPTIONS.filter(Boolean).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <div className="flex items-center gap-1.5">
          <Input type="date" className="w-auto" value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} />
          <span className="text-sm" style={{ color: 'var(--ink-3)' }}>–</span>
          <Input type="date" className="w-auto" value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }} />
        </div>

        <Button type="submit" size="sm">Search</Button>
      </form>

      {loading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audit events found"
          description="Mutations will appear here as they happen."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Timestamp</Th>
                <Th>User</Th>
                <Th>Action</Th>
                <Th>Model</Th>
                <Th>Object</Th>
                <Th>IP</Th>
                <Th>Details</Th>
              </Tr>
            </Thead>
            <Tbody>
              {logs.map((log) => (
                <Fragment key={log.id}>
                  <Tr>
                    <Td className="whitespace-nowrap" style={{ color: 'var(--ink-2)' }}>{formatTimestamp(log.timestamp)}</Td>
                    <Td className="font-medium" style={{ color: 'var(--ink)' }}>
                      {log.username ?? <span style={{ color: 'var(--ink-3)' }}>System</span>}
                    </Td>
                    <Td><ActionBadge action={log.action} /></Td>
                    <Td style={{ color: 'var(--ink-2)' }}>{log.model_name}</Td>
                    <Td className="max-w-xs truncate" title={log.object_repr} style={{ color: 'var(--ink)' }}>{log.object_repr}</Td>
                    <Td className="text-xs mono" style={{ color: 'var(--ink-3)' }}>{log.ip_address ?? '—'}</Td>
                    <Td>
                      {(log.changes || log.extra) && (
                        <button
                          onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                          className="text-xs hover:underline"
                          style={{ color: 'var(--brand)' }}
                        >
                          {expandedId === log.id ? 'Hide' : 'Show'}
                        </button>
                      )}
                    </Td>
                  </Tr>
                  {expandedId === log.id && (log.changes || log.extra) && (
                    <tr style={{ background: 'var(--color-grey-light)' }}>
                      <td colSpan={7} className="px-4 py-3">
                        <pre
                          className="text-xs whitespace-pre-wrap mono rounded p-3"
                          style={{
                            background: 'var(--surface-0)',
                            border: '1px solid var(--line)',
                            color: 'var(--ink-2)',
                          }}
                        >
                          {JSON.stringify(log.changes ?? log.extra, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}

      {totalPages > 1 && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={count}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}

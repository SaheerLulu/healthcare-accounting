import { useEffect, useState, useCallback } from 'react'
import { getAuditLogs, type AuditLog, type AuditLogParams } from '../lib/api'
import { toast } from 'sonner'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'

const ACTION_COLORS: Record<string, string> = {
  CREATE:   'bg-emerald-100 text-emerald-800',
  UPDATE:   'bg-blue-100 text-blue-800',
  DELETE:   'bg-red-100 text-red-800',
  POST:     'bg-teal-50 text-teal-600',
  REVERSE:  'bg-amber-100 text-amber-800',
  GENERATE: 'bg-purple-100 text-purple-800',
  SYNC:     'bg-slate-100 text-slate-900',
}

function ActionBadge({ action }: { action: string }) {
  const cls = ACTION_COLORS[action] ?? 'bg-gray-100 text-gray-800'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
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
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Audit Log</h1>
        <p className="text-sm text-slate-500 mt-0.5">Track all create, update, delete, and system actions</p>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-2 items-end">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-8 pr-3 py-1.5 w-52"
            placeholder="Search object / user..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
          value={filterAction}
          onChange={(e) => { setFilterAction(e.target.value); setPage(1) }}
        >
          <option value="">All Actions</option>
          {ACTION_OPTIONS.filter(Boolean).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
          value={filterModel}
          onChange={(e) => { setFilterModel(e.target.value); setPage(1) }}
        >
          <option value="">All Models</option>
          {MODEL_OPTIONS.filter(Boolean).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            className="px-3 py-1.5 w-auto"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
          />
          <span className="text-slate-400 text-sm">–</span>
          <Input
            type="date"
            className="px-3 py-1.5 w-auto"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
          />
        </div>

        <Button type="submit" size="sm">
          Search
        </Button>
      </form>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">No audit events found</div>
        ) : (
          <Table>
            <Thead>
              <Tr className="bg-slate-50">
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
                <>
                  <Tr key={log.id}>
                    <Td className="text-slate-500 whitespace-nowrap">{formatTimestamp(log.timestamp)}</Td>
                    <Td className="font-medium text-slate-900">{log.username ?? <span className="text-slate-400">System</span>}</Td>
                    <Td><ActionBadge action={log.action} /></Td>
                    <Td className="text-slate-500">{log.model_name}</Td>
                    <Td className="text-slate-900 max-w-xs truncate" title={log.object_repr}>{log.object_repr}</Td>
                    <Td className="text-slate-400 text-xs font-mono">{log.ip_address ?? '—'}</Td>
                    <Td>
                      {(log.changes || log.extra) && (
                        <button
                          onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                          className="text-xs text-teal-600 hover:text-teal-700 underline underline-offset-2"
                        >
                          {expandedId === log.id ? 'Hide' : 'Show'}
                        </button>
                      )}
                    </Td>
                  </Tr>
                  {expandedId === log.id && (log.changes || log.extra) && (
                    <tr key={`${log.id}-detail`} className="bg-slate-50">
                      <td colSpan={7} className="px-4 py-3">
                        <pre className="text-xs text-slate-500 whitespace-pre-wrap font-mono bg-white border border-slate-200 rounded p-3">
                          {JSON.stringify(log.changes ?? log.extra, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{count} total events</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="p-1.5 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState, useCallback, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAuditLogs, exportAuditLogsCsv, type AuditLog, type AuditLogParams } from '../lib/api'
import { toast } from 'sonner'
import { Search, ScrollText, Download } from 'lucide-react'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeletons'
import { Pagination } from '../components/ui/Pagination'
import { usePageKeyboard } from '../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'

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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block mono uppercase tracking-wider" style={{ color: 'var(--ink-3)', fontSize: 10 }}>{label}</span>
      <span style={{ color: 'var(--ink)' }}>{children}</span>
    </div>
  )
}

function DetailJson({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div className="mb-2">
      <div className="mono uppercase tracking-wider mb-1" style={{ color: 'var(--ink-3)', fontSize: 10 }}>{title}</div>
      <pre
        className="text-xs whitespace-pre-wrap mono rounded p-3"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--line)', color: 'var(--ink-2)' }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

const MODEL_OPTIONS = [
  '', 'ChartOfAccount', 'JournalEntry', 'GSTR1Entry', 'GSTR3BSummary',
  'TDSDeduction', 'AccountingSettings', 'SyncLog',
]
const ACTION_OPTIONS = ['', 'CREATE', 'UPDATE', 'DELETE', 'POST', 'REVERSE', 'GENERATE', 'SYNC']

export default function AuditLogPage() {
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
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

  const [exporting, setExporting] = useState(false)
  async function handleExport() {
    setExporting(true)
    try {
      const params: AuditLogParams = {}
      if (search) params.search = search
      if (filterAction) params.action = filterAction
      if (filterModel) params.model_name = filterModel
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      await exportAuditLogsCsv(params)
    } catch {
      toast.error('Failed to export audit log')
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.ceil(count / PAGE_SIZE)
  const hasFilters = !!(search || filterAction || filterModel || dateFrom || dateTo)

  // ─── Keyboard ─────────────────────────────────────────────────────────────
  // Fifty rows, and the only tab stop in each was its Details button — so
  // expanding the twentieth event cost forty Tab presses. A roving tabindex
  // turns the table into one tab stop with ↑↓/Home/End/PgUp/PgDn inside it and
  // Enter toggling the same disclosure the button does.
  const list = useListKeyboardNav({
    count: logs.length,
    onActivate: (i) => {
      const log = logs[i]
      if (log) setExpandedId((cur) => (cur === log.id ? null : log.id))
    },
  })

  // Paging by chord leaves focus on the pager, which says nothing about the
  // fifty rows that just changed underneath it. Land in the new first row.
  const focusAfterLoad = useRef(false)
  function goToPage(next: number) {
    if (next < 1 || next > totalPages) return
    focusAfterLoad.current = true
    setPage(next)
  }
  useEffect(() => {
    if (loading || !focusAfterLoad.current) return
    focusAfterLoad.current = false
    if (logs.length > 0) list.focusList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, logs])

  function refresh() {
    // A refresh swaps the table for the skeleton, so the row the user was
    // standing on unmounts and focus falls to <body>. Reuse the same landing
    // mechanism paging uses — but only when focus was actually in the table,
    // so Alt+R from the search box leaves the caret in the search box.
    focusAfterLoad.current = !!document.activeElement?.closest('[data-kbd-row]')
    load()
  }

  /**
   * Alt+← / Alt+→ from inside a filter field.
   *
   * Neither chord is in the shared GLOBAL_ALLOW_LIST, so the app-wide hotkey
   * listener drops them the moment focus sits in an input or a select — and
   * this screen has five of them, one of which (the search box) is exactly
   * where F2 parks focus. So the two paging chords the hint bar advertises did
   * nothing from anywhere a filtering user actually stands. Rather than widen
   * a list every screen shares, the page answers the same two chords as they
   * bubble out of its own fields; everywhere else (a focused row, the body)
   * the global listener still owns them, and it ignores exactly the events
   * handled here, so a chord can never fire twice.
   */
  function onFieldKeyDown(e: React.KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const tag = (e.target as HTMLElement | null)?.tagName
    if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      goToPage(page + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      goToPage(page - 1)
    }
  }

  function clearFilters() {
    setSearch(''); setFilterAction(''); setFilterModel('')
    setDateFrom(''); setDateTo(''); setPage(1)
  }

  usePageKeyboard({
    actions: [
      { chord: 'Alt+X', label: 'Export CSV', run: handleExport, when: !exporting },
      { chord: 'Alt+R', label: 'Refresh', run: refresh },
      { chord: 'Alt+C', label: 'Clear filters', run: clearFilters, when: hasFilters },
      { chord: 'Alt+Right', label: 'Next page', run: () => goToPage(page + 1), when: page < totalPages },
      { chord: 'Alt+Left', label: 'Prev page', run: () => goToPage(page - 1), when: page > 1 },
    ],
    searchRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5" onKeyDown={onFieldKeyDown}>
      <div>
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Audit Log</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>Track all create, update, delete, and system actions.</p>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-2 items-end">
        <div className="relative w-full sm:w-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
          <Input
            ref={searchRef}
            className="pl-8 pr-3 w-full sm:w-52"
            placeholder="Search object / user…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="h-9 px-3 text-sm rounded-md outline-none flex-1 sm:flex-initial"
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
          className="h-9 px-3 text-sm rounded-md outline-none flex-1 sm:flex-initial"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-0)', color: 'var(--ink)' }}
          value={filterModel}
          onChange={(e) => { setFilterModel(e.target.value); setPage(1) }}
        >
          <option value="">All Models</option>
          {MODEL_OPTIONS.filter(Boolean).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        {/* A date input can't render below ~172px, so a side-by-side range
            overflows a 320px phone however hard flex tries to shrink it. */}
        <div className="flex flex-col sm:flex-row w-full sm:w-auto sm:items-center gap-1.5">
          <Input type="date" className="w-full sm:w-auto sm:flex-initial" value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} />
          <span className="hidden sm:inline text-sm" style={{ color: 'var(--ink-3)' }}>–</span>
          <Input type="date" className="w-full sm:w-auto sm:flex-initial" value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }} />
        </div>

        <Button type="submit" size="sm" className="flex-1 sm:flex-initial">Search</Button>
        <Button type="button" size="sm" variant="secondary" className="flex-1 sm:flex-initial" onClick={handleExport} disabled={exporting}>
          <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
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
            <Tbody {...list.containerProps}>
              {logs.map((log, i) => (
                <Fragment key={log.id}>
                  <Tr
                    aria-expanded={expandedId === log.id}
                    aria-controls={`audit-detail-${log.id}`}
                    {...list.rowProps(i)}
                  >
                    <Td className="whitespace-nowrap" style={{ color: 'var(--ink-2)' }}>{formatTimestamp(log.timestamp)}</Td>
                    <Td className="font-medium" style={{ color: 'var(--ink)' }}>
                      {log.username ?? <span style={{ color: 'var(--ink-3)' }}>System</span>}
                    </Td>
                    <Td><ActionBadge action={log.action} /></Td>
                    <Td style={{ color: 'var(--ink-2)' }}>{log.model_name}</Td>
                    <Td className="max-w-xs truncate" title={log.object_repr} style={{ color: 'var(--ink)' }}>{log.object_repr}</Td>
                    <Td className="text-xs mono" style={{ color: 'var(--ink-3)' }}>{log.ip_address ?? '—'}</Td>
                    <Td>
                      <button
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        // tabIndex={-1}: the row is the single tab stop for the
                        // table and Enter on it runs this same toggle, so a
                        // tabbable button here would restore the 50-stop walk.
                        tabIndex={-1}
                        aria-expanded={expandedId === log.id}
                        aria-controls={`audit-detail-${log.id}`}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--brand)' }}
                      >
                        {expandedId === log.id ? 'Hide' : 'Details'}
                      </button>
                    </Td>
                  </Tr>
                  {expandedId === log.id && (
                    <tr style={{ background: 'var(--color-grey-light)' }}>
                      <td colSpan={7} className="px-4 py-3" id={`audit-detail-${log.id}`}>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1.5 text-xs mb-3">
                          <Detail label="Object">{log.object_repr || '—'}</Detail>
                          <Detail label="Object ID">{log.object_id || '—'}</Detail>
                          <Detail label="Model">{log.model_name}</Detail>
                          <Detail label="Action">{log.action}</Detail>
                          <Detail label="User">{log.username ?? 'System'}</Detail>
                          <Detail label="IP Address">{log.ip_address ?? '—'}</Detail>
                          <Detail label="Timestamp">{formatTimestamp(log.timestamp)}</Detail>
                        </div>
                        {log.changes && (
                          <DetailJson title="Changes (before → after)" value={log.changes} />
                        )}
                        {log.extra && (
                          <DetailJson title="Additional context" value={log.extra} />
                        )}
                        {!log.changes && !log.extra && (
                          <p className="text-xs italic" style={{ color: 'var(--ink-3)' }}>
                            No field-level change data was captured for this event.
                          </p>
                        )}
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

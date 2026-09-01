import { useEffect, useMemo, useRef, useState } from 'react'
import {
  RefreshCw, Loader2, CheckCircle, XCircle, Clock, RotateCcw, AlertTriangle,
  ChevronDown, ChevronRight, Trash2, Activity, Database, Timer, ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  runSync, getSyncLogs, getSyncErrors, retrySyncErrors,
  resolveSyncError, fullResyncDryRun, fullResyncConfirm,
  type SyncLog, type SyncError, type FullResyncPreview,
} from '../lib/api'
import { useLocation } from '../contexts/LocationContext'
import { usePageKeyboard } from '../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'
import { formatDate } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeletons'
import { AlertBanner } from '../components/ui/AlertBanner'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { KpiCard } from '../components/ui/KpiCard'

// Sync-type filter — single dropdown beats a 7-pill flex row visually.
const SYNC_TYPES = [
  { value: '', label: 'All sync types' },
  { value: 'opening_stock', label: 'Opening Stock' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'pos', label: 'POS' },
  { value: 'b2b', label: 'B2B' },
  { value: 'return', label: 'Sales Return' },
  { value: 'purchase_return', label: 'Purchase Return' },
] as const

/**
 * Enter/Space on a control inside a row has already done its job; letting the
 * key bubble to the row's own activate handler would toggle the traceback a
 * second time and cancel out the chevron press. Arrow keys still bubble, so
 * ↑↓ keep moving between rows from a focused button.
 */
function rowKeys(handler: (e: React.KeyboardEvent) => void) {
  return (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target !== e.currentTarget) {
      if ((e.target as HTMLElement).closest('button, a')) return
    }
    handler(e)
  }
}

function SyncStatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: React.ReactNode; variant: 'success' | 'error' | 'info' | 'warning' | 'default' }> = {
    success: { icon: <CheckCircle size={12} />, variant: 'success' },
    failed: { icon: <XCircle size={12} />, variant: 'error' },
    running: { icon: <Loader2 size={12} className="animate-spin" />, variant: 'info' },
    pending: { icon: <Clock size={12} />, variant: 'warning' },
  }
  const s = map[status] || { icon: null, variant: 'default' as const }
  return (
    <Badge variant={s.variant}>
      <span className="inline-flex items-center gap-1">{s.icon}{status}</span>
    </Badge>
  )
}

function formatDuration(seconds: string | number | null): string {
  if (seconds == null) return '—'
  const n = Number(seconds)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n < 60) return `${n.toFixed(1)}s`
  const mins = Math.floor(n / 60)
  const rem = Math.round(n - mins * 60)
  return `${mins}m ${rem}s`
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

export default function SyncPage() {
  const { activeLocation } = useLocation()
  const [logs, setLogs] = useState<SyncLog[]>([])
  const [errors, setErrors] = useState<SyncError[]>([])
  const [errorView, setErrorView] = useState<'open' | 'resolved'>('open')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [expandedError, setExpandedError] = useState<number | null>(null)

  const [confirmSync, setConfirmSync] = useState(false)
  const [confirmRetry, setConfirmRetry] = useState(false)
  const [fullResyncOpen, setFullResyncOpen] = useState(false)
  const [resyncPreview, setResyncPreview] = useState<FullResyncPreview | null>(null)
  const [resyncTyping, setResyncTyping] = useState('')
  const [resyncRunning, setResyncRunning] = useState(false)

  const pollRef = useRef<number | null>(null)

  async function loadAll() {
    try {
      const typeParam = typeFilter ? { sync_type: typeFilter } : undefined
      const [logRes, errRes] = await Promise.all([
        getSyncLogs(typeParam),
        getSyncErrors({ status: errorView, ...(typeParam ?? {}) }),
      ])
      setLogs(logRes)
      setErrors(errRes)
    } catch {
      toast.error('Failed to load sync data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() /* eslint-disable-next-line */ }, [errorView, typeFilter])

  useEffect(() => {
    if (syncing) {
      pollRef.current = window.setInterval(() => loadAll(), 2000) as unknown as number
    } else if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncing])

  async function handleSync() {
    setConfirmSync(false)
    setSyncing(true)
    try {
      await runSync()
      toast.success('Sync complete')
      await loadAll()
    } catch {
      toast.error('Sync failed. Check the errors table below.')
      await loadAll()
    } finally {
      setSyncing(false)
    }
  }

  async function handleRetry() {
    setConfirmRetry(false)
    setRetrying(true)
    try {
      const result = await retrySyncErrors()
      toast.success(
        `Retried ${result.result.retried}: ${result.result.resolved} resolved, ${result.result.failed} still failing`,
      )
      await loadAll()
    } catch {
      toast.error('Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  async function handleResolveError(id: number) {
    try {
      await resolveSyncError(id)
      toast.success('Marked resolved')
      await loadAll()
    } catch {
      toast.error('Failed to mark resolved')
    }
  }

  async function openFullResync() {
    setFullResyncOpen(true)
    setResyncPreview(null)
    setResyncTyping('')
    try {
      const preview = await fullResyncDryRun()
      setResyncPreview(preview)
    } catch {
      toast.error('Failed to load full-resync preview')
      setFullResyncOpen(false)
    }
  }

  async function handleFullResyncConfirm() {
    if (resyncTyping !== 'RESET') {
      toast.error('Type RESET to confirm')
      return
    }
    setResyncRunning(true)
    try {
      const result = await fullResyncConfirm()
      toast.success(`Wiped ${result.wiped_entries ?? 0} entries and re-synced`)
      setFullResyncOpen(false)
      await loadAll()
    } catch {
      toast.error('Full resync failed')
    } finally {
      setResyncRunning(false)
    }
  }

  const stats = useMemo(() => {
    const totalRecords = logs.reduce((sum, l) => sum + (l.records_processed || 0), 0)
    const lastRun = logs[0]?.last_synced_at
    const lastDuration = logs[0]?.duration_seconds
    return { totalRecords, lastRun, lastDuration }
  }, [logs])

  const openErrorCount = errors.filter((e) => !e.resolved).length

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // Error rows cost two tab stops each and answered no key at all, so the 12th
  // traceback was ~24 Tabs away. A roving tabindex makes the table one stop:
  // F3 to enter it, ↑↓ to move, Enter to expand or collapse the traceback.
  const errorNav = useListKeyboardNav({
    count: errors.length,
    onActivate: (i) => {
      const err = errors[i]
      if (!err) return
      setExpandedError((cur) => (cur === err.id ? null : err.id))
    },
  })

  // Alt+N runs the sync because a run CREATES journal entries; Alt+R stays the
  // read-only refresh. Both of the write actions below open a confirmation
  // first — a slipped Alt+T would otherwise re-post failed records and a
  // slipped Alt+D would wipe every auto-generated entry.
  //
  // Alt+T is not in GLOBAL_ALLOW_LIST, so it stands down while the caret is in
  // the sync-type filter; Alt+D (the app-wide delete chord) is allow-listed and
  // fires from anywhere, which is safe because it only opens the reset dialog —
  // that dialog still wants RESET typed into it.
  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'Run sync', run: () => setConfirmSync(true), when: !syncing },
      { chord: 'Alt+R', label: 'Refresh', run: loadAll },
      {
        chord: 'Alt+T',
        label: 'Retry errors',
        run: () => setConfirmRetry(true),
        when: openErrorCount > 0 && !retrying,
      },
      { chord: 'Alt+D', label: 'Reset all data', run: openFullResync },
    ],
    onFocusList: errorNav.focusList,
  })

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Data Sync
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Pull customers, suppliers, and posted vouchers from the inventory app
            and turn them into journal entries.
            {activeLocation && (
              <span className="ml-1" style={{ color: 'var(--ink-3)' }}>
                · Scoped to <strong style={{ color: 'var(--ink)' }}>{activeLocation.name}</strong>
              </span>
            )}
          </p>
        </div>
      </div>

      {syncing && (
        <AlertBanner tone="info">
          <span className="inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Sync in progress — auto-refreshing every 2 seconds…
          </span>
        </AlertBanner>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title="Records synced"
          value={stats.totalRecords.toLocaleString()}
          subtitle={`across ${logs.length} run${logs.length === 1 ? '' : 's'}`}
          icon={Database}
          color="var(--brand)"
          bgColor="rgba(15,157,154,0.10)"
        />
        <KpiCard
          title="Last sync"
          value={formatRelative(stats.lastRun)}
          subtitle={stats.lastRun ? formatDate(stats.lastRun) : 'Never'}
          icon={Activity}
          color="var(--ink-2)"
          bgColor="var(--surface-1)"
        />
        <KpiCard
          title="Open errors"
          value={openErrorCount.toLocaleString()}
          // KpiCard's root is a plain <div>, so an onClick here would be
          // pointer-only — the copy promised an interaction no keyboard (and in
          // fact no mouse either, none was wired) could take. The errors table
          // sits directly below; F3 puts the keyboard in it.
          subtitle={openErrorCount === 0 ? 'All clear' : 'listed below (F3)'}
          icon={AlertTriangle}
          color="var(--danger)"
          bgColor="rgba(192,57,43,0.10)"
          numericValue={openErrorCount}
          thresholds={{ warning: 1, danger: 5, direction: 'above' }}
        />
        <KpiCard
          title="Last duration"
          value={formatDuration(stats.lastDuration)}
          subtitle="most recent run"
          icon={Timer}
          color="var(--ink-2)"
          bgColor="var(--surface-1)"
        />
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-full sm:w-auto px-3 h-9 text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
          style={{ background: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
          title="Filter both tables by sync type"
          aria-label="Filter both tables by sync type"
        >
          {SYNC_TYPES.map((t) => (
            <option key={t.value || 'all'} value={t.value}>{t.label}</option>
          ))}
        </select>
        {/* The spacer only earns its keep once the row fits on one line —
            below sm it would push the wrapped buttons off to the right. */}
        <div className="hidden sm:block flex-1" />
        {openErrorCount > 0 && (
          <button
            type="button"
            // Confirmed rather than fired directly: a retry re-runs the failed
            // records and posts journal entries for the ones that now succeed,
            // and Alt+T reaches it in one keystroke.
            onClick={() => setConfirmRetry(true)}
            disabled={retrying}
            aria-keyshortcuts="Alt+T"
            title={`Retry ${openErrorCount} failed record${openErrorCount === 1 ? '' : 's'} (Alt+T)`}
            className="flex items-center gap-2 px-3 h-9 text-sm font-medium rounded-md disabled:opacity-60"
            style={{ background: 'rgba(199,122,17,0.08)', border: '1px solid rgba(199,122,17,0.30)', color: 'var(--warning)' }}
          >
            {retrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Retry {openErrorCount}
          </button>
        )}
        <button
          type="button"
          onClick={openFullResync}
          className="px-3 h-9 text-sm font-medium rounded-md transition-colors hover:bg-[var(--color-hover-bg)]"
          style={{ color: 'var(--ink-3)' }}
          aria-keyshortcuts="Alt+D"
          title="Wipe all auto-generated entries and rebuild from scratch (Alt+D)"
        >
          Reset all data…
        </button>
        <Button onClick={() => setConfirmSync(true)} disabled={syncing}>
          {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {syncing ? 'Syncing…' : 'Run Sync'}
        </Button>
      </div>

      {/* Errors */}
      {(openErrorCount > 0 || errorView === 'resolved') && (
        <Card className="overflow-hidden p-0">
          <div
            className="px-5 py-3 border-b flex items-center justify-between gap-2 flex-wrap"
            style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} style={{ color: openErrorCount > 0 ? 'var(--danger)' : 'var(--ink-3)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                {errorView === 'open' ? 'Open errors' : 'Resolved errors'}
              </h2>
              <Badge variant={openErrorCount > 0 ? 'error' : 'default'}>
                {errors.length}
              </Badge>
            </div>
            {/* Two loose buttons announced as two unrelated controls and cost
                two tab stops. As a radiogroup it is one stop with ←/→ between
                the options, which is what every other segmented strip does. */}
            <div className="flex items-center bg-[var(--surface-0)] rounded-md p-0.5"
                 style={{ border: '1px solid var(--line)' }}
                 role="radiogroup" aria-label="Show open or resolved errors">
              {(['open', 'resolved'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={errorView === v}
                  tabIndex={errorView === v ? 0 : -1}
                  data-seg={v}
                  onClick={() => setErrorView(v)}
                  onKeyDown={(e) => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
                    e.preventDefault()
                    const next = errorView === 'open' ? 'resolved' : 'open'
                    setErrorView(next)
                    e.currentTarget.parentElement
                      ?.querySelector<HTMLElement>(`[data-seg="${next}"]`)
                      ?.focus()
                  }}
                  className="px-2.5 py-1 text-xs font-medium rounded capitalize"
                  style={errorView === v
                    ? { background: 'var(--surface-1)', color: 'var(--ink)' }
                    : { color: 'var(--ink-3)' }
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          {errors.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
              No {errorView} errors.
            </div>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th className="w-8" />
                  <Th>Type</Th>
                  <Th>Source ID</Th>
                  <Th>Error</Th>
                  <Th className="text-right">Retries</Th>
                  <Th className="w-[110px]" />
                </Tr>
              </Thead>
              <Tbody {...errorNav.containerProps}>
                {errors.flatMap((err, i) => {
                  const expanded = expandedError === err.id
                  const rp = errorNav.rowProps(i)
                  const rows = [
                    <Tr
                      key={err.id}
                      aria-label={`${err.sync_type.replace(/_/g, ' ')} error on source #${err.source_id}`}
                      {...rp}
                      onKeyDown={rowKeys(rp.onKeyDown)}
                    >
                      <Td>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setExpandedError(expanded ? null : err.id)}
                          className="p-1 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0 rounded hover:bg-[var(--color-hover-bg)] transition-colors"
                          title={expanded ? 'Hide traceback' : 'Show traceback'}
                          aria-label={expanded ? 'Collapse error' : 'Expand error'}
                        >
                          {expanded
                            ? <ChevronDown size={14} style={{ color: 'var(--ink-3)' }} />
                            : <ChevronRight size={14} style={{ color: 'var(--ink-3)' }} />}
                        </button>
                      </Td>
                      <Td className="capitalize" style={{ color: 'var(--ink-2)' }}>
                        {err.sync_type.replace(/_/g, ' ')}
                      </Td>
                      <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>#{err.source_id}</Td>
                      <Td className="text-xs" style={{ color: 'var(--ink-2)' }}>
                        <span className={expanded ? '' : 'line-clamp-2'}>{err.error_message}</span>
                      </Td>
                      <Td className="text-right text-xs mono" style={{ color: 'var(--ink-2)' }}>
                        {err.retry_count}/{err.max_retries}
                      </Td>
                      <Td>
                        {!err.resolved && (
                          <button
                            type="button"
                            onClick={() => handleResolveError(err.id)}
                            className="text-xs px-2 py-1 rounded transition-colors hover:bg-[var(--color-hover-bg)]"
                            style={{ color: 'var(--brand)' }}
                            title="Mark resolved without retrying"
                            aria-label={`Mark ${err.sync_type.replace(/_/g, ' ')} error #${err.source_id} resolved`}
                          >
                            Resolve
                          </button>
                        )}
                      </Td>
                    </Tr>,
                  ]
                  if (expanded && err.traceback) {
                    rows.push(
                      <Tr key={`${err.id}-tb`}>
                        <Td colSpan={6} className="p-0">
                          {/* A scrollable region no keyboard could enter: long
                              traceback lines were unreadable without a mouse.
                              tabIndex makes it focusable so ←/→ scroll it. */}
                          <pre
                            tabIndex={0}
                            role="region"
                            aria-label={`Traceback for ${err.sync_type.replace(/_/g, ' ')} #${err.source_id}`}
                            className="overflow-x-auto text-[11px] leading-snug p-4 mono whitespace-pre"
                            style={{ background: 'var(--surface-1)', color: 'var(--ink-2)' }}
                          >
                            {err.traceback}
                          </pre>
                        </Td>
                      </Tr>
                    )
                  }
                  return rows
                })}
              </Tbody>
            </Table>
          )}
        </Card>
      )}

      {/* History — main content */}
      <Card className="overflow-hidden p-0">
        <div
          className="px-5 py-3 border-b flex items-center justify-between gap-2 flex-wrap"
          style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Sync history</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
              Per-type cursors, durations, and failure counts for the last 50 runs.
            </p>
          </div>
          <Button variant="link" size="sm" onClick={loadAll}>Refresh</Button>
        </div>
        {loading ? (
          <SkeletonTable rows={6} cols={6} />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={RefreshCw}
            title="No sync logs yet"
            description="Sync will import opening stock, purchases, POS sales, B2B sales, and returns from the inventory app. Make sure the inventory app is reachable and has data first."
            actionLabel="Run Sync"
            onAction={() => setConfirmSync(true)}
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Sync Type</Th>
                <Th>Last Synced</Th>
                <Th className="text-right">Records</Th>
                <Th className="text-right">Failed</Th>
                <Th className="text-right">Duration</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {logs.map((log) => (
                <Tr key={log.id}>
                  <Td className="font-medium capitalize" style={{ color: 'var(--ink)' }}>
                    {log.sync_type.replace(/_/g, ' ')}
                  </Td>
                  <Td style={{ color: 'var(--ink-2)' }}>{formatDate(log.last_synced_at)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>
                    {log.records_processed.toLocaleString()}
                  </Td>
                  <Td className="text-right mono"
                      style={{ color: log.error_count > 0 ? 'var(--danger)' : 'var(--ink-3)' }}>
                    {log.error_count > 0 ? log.error_count.toLocaleString() : '—'}
                  </Td>
                  <Td className="text-right mono text-xs" style={{ color: 'var(--ink-3)' }}>
                    {formatDuration(log.duration_seconds)}
                  </Td>
                  <Td><SyncStatusBadge status={log.status} /></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      {/* Run-sync confirmation */}
      <ConfirmDialog
        open={confirmSync}
        onOpenChange={setConfirmSync}
        onConfirm={handleSync}
        title="Run sync now?"
        confirmLabel="Run sync"
        loading={syncing}
        description={
          <span>
            Pulls every new/changed record from the inventory app and posts the
            matching journal entries. Safe to run repeatedly — already-synced
            records are skipped.
          </span>
        }
      />

      {/* Retry confirmation */}
      <ConfirmDialog
        open={confirmRetry}
        onOpenChange={setConfirmRetry}
        onConfirm={handleRetry}
        title={`Retry ${openErrorCount} failed record${openErrorCount === 1 ? '' : 's'}?`}
        confirmLabel="Retry"
        loading={retrying}
        description={
          <span>
            Re-runs every open error and posts the journal entries for the ones
            that now succeed. Records that fail again keep their error row and
            their retry count goes up.
          </span>
        }
      />

      {/* Full-resync dialog */}
      <Dialog open={fullResyncOpen} onOpenChange={setFullResyncOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldAlert size={16} style={{ color: 'var(--danger)' }} />
              Reset all auto-generated data
            </DialogTitle>
          </DialogHeader>
          {/* The typed confirmation is the whole interaction here, so it lives
              in a <form>: typing RESET and pressing Enter now confirms instead
              of doing nothing. Cancel is type="button" so it cannot submit. */}
          <form onSubmit={(e) => { e.preventDefault(); handleFullResyncConfirm() }}>
          <div className="space-y-4 py-2">
            {!resyncPreview ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={20} className="animate-spin" style={{ color: 'var(--brand)' }} />
              </div>
            ) : (
              <>
                <div className="text-sm space-y-2" style={{ color: 'var(--ink)' }}>
                  <p>
                    This will delete{' '}
                    <strong className="mono">{resyncPreview.would_delete_journals?.toLocaleString() ?? 0}</strong>{' '}
                    auto-generated journal entries and reset{' '}
                    <strong className="mono">{resyncPreview.would_reset_cursors ?? 0}</strong>{' '}
                    sync cursors before re-running every rule from scratch.
                  </p>
                  <p style={{ color: 'var(--ink-2)' }}>
                    Manual entries (bill payments, receipts, manual JVs) are preserved.
                    Use this after fixing data-quality issues upstream.
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
                    Type <span className="mono">RESET</span> to confirm
                  </label>
                  <Input
                    value={resyncTyping}
                    onChange={(e) => setResyncTyping(e.target.value)}
                    className="mt-1 mono"
                    aria-label="Type RESET to confirm"
                    autoFocus
                  />
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 mt-4 pt-4 border-t"
               style={{ borderColor: 'var(--line)' }}>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={resyncRunning}>Cancel</Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={resyncRunning || resyncTyping !== 'RESET' || !resyncPreview}
              style={{ background: 'var(--danger)', color: 'white' }}
            >
              {resyncRunning ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {resyncRunning ? 'Resetting…' : 'Reset and rebuild'}
            </Button>
          </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

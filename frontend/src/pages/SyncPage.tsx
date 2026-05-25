import { useEffect, useMemo, useRef, useState } from 'react'
import {
  RefreshCw, Loader2, CheckCircle, XCircle, Clock, RotateCcw, AlertTriangle,
  ChevronDown, ChevronRight, ShieldAlert, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  runSync, getSyncLogs, getSyncErrors, retrySyncErrors,
  resolveSyncError, fullResyncDryRun, fullResyncConfirm,
  type SyncLog, type SyncError, type FullResyncPreview,
} from '../lib/api'
import { useLocation } from '../contexts/LocationContext'
import { formatDate } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card, CardHeader } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeletons'
import { AlertBanner } from '../components/ui/AlertBanner'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'

// Sync-type filter pills mirror SyncLog.SYNC_TYPES on the backend.
const SYNC_TYPES = [
  { value: 'all-types', label: 'All' },
  { value: 'opening_stock', label: 'Opening Stock' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'pos', label: 'POS' },
  { value: 'b2b', label: 'B2B' },
  { value: 'return', label: 'Sales Return' },
  { value: 'purchase_return', label: 'Purchase Return' },
] as const

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

function formatDuration(seconds: string | null): string {
  if (!seconds) return '—'
  const n = Number(seconds)
  if (!Number.isFinite(n)) return '—'
  if (n < 60) return `${n.toFixed(1)}s`
  const mins = Math.floor(n / 60)
  const rem = Math.round(n - mins * 60)
  return `${mins}m ${rem}s`
}

export default function SyncPage() {
  const { activeLocation } = useLocation()
  const [logs, setLogs] = useState<SyncLog[]>([])
  const [errors, setErrors] = useState<SyncError[]>([])
  const [errorView, setErrorView] = useState<'open' | 'resolved'>('open')
  const [typeFilter, setTypeFilter] = useState<string>('all-types')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [expandedError, setExpandedError] = useState<number | null>(null)

  // Confirmation modals
  const [confirmSync, setConfirmSync] = useState(false)
  const [fullResyncOpen, setFullResyncOpen] = useState(false)
  const [resyncPreview, setResyncPreview] = useState<FullResyncPreview | null>(null)
  const [resyncTyping, setResyncTyping] = useState('')
  const [resyncRunning, setResyncRunning] = useState(false)

  // Auto-refresh while syncing
  const pollRef = useRef<number | null>(null)

  async function loadAll() {
    try {
      const typeParam = typeFilter !== 'all-types' ? { sync_type: typeFilter } : undefined
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

  // Poll every 2s while a sync is running so the user sees progress;
  // stop on completion to avoid wasted requests.
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

  // Header summary
  const stats = useMemo(() => {
    const totalRecords = logs.reduce((sum, l) => sum + (l.records_processed || 0), 0)
    const lastRun = logs[0]?.last_synced_at
    return { totalRecords, lastRun }
  }, [logs])

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
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
        <div className="flex items-center gap-2 flex-wrap">
          {errors.length > 0 && errorView === 'open' && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="flex items-center gap-2 px-3 h-9 text-sm font-medium rounded-md disabled:opacity-60"
              style={{ background: 'rgba(199,122,17,0.08)', border: '1px solid rgba(199,122,17,0.30)', color: 'var(--warning)' }}
            >
              {retrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Retry {errors.length} errors
            </button>
          )}
          <Button onClick={() => setConfirmSync(true)} disabled={syncing}>
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {syncing ? 'Syncing…' : 'Run Sync'}
          </Button>
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

      {/* Sync-type filter pills (apply to both error and history tables) */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {SYNC_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setTypeFilter(t.value)}
            className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
            style={typeFilter === t.value
              ? { background: 'rgba(15, 157, 154, 0.12)', color: 'var(--brand)', border: '1px solid var(--brand)' }
              : { background: 'var(--surface-0)', color: 'var(--ink-2)', border: '1px solid var(--line)' }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Errors table */}
      {(errors.length > 0 || errorView === 'resolved') && (
        <Card className="overflow-hidden p-0"
              style={{ borderColor: errorView === 'open' ? 'rgba(192,57,43,0.30)' : 'var(--line)' }}>
          <div
            className="px-5 py-3 border-b flex items-center justify-between gap-2 flex-wrap"
            style={{
              background: errorView === 'open' ? 'rgba(192,57,43,0.06)' : 'var(--surface-1)',
              borderColor: errorView === 'open' ? 'rgba(192,57,43,0.20)' : 'var(--line)',
            }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} style={{ color: errorView === 'open' ? 'var(--danger)' : 'var(--ink-3)' }} />
              <h2 className="text-sm font-semibold"
                  style={{ color: errorView === 'open' ? 'var(--danger)' : 'var(--ink)' }}>
                {errorView === 'open'
                  ? <>Failed records (<span className="mono">{errors.length}</span>)</>
                  : <>Resolved errors (<span className="mono">{errors.length}</span>)</>}
              </h2>
            </div>
            <div className="flex items-center bg-[var(--surface-0)] rounded-md p-0.5"
                 style={{ border: '1px solid var(--line)' }}>
              {(['open', 'resolved'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setErrorView(v)}
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
                  <Th className="w-[100px]" />
                </Tr>
              </Thead>
              <Tbody>
                {errors.map((err) => {
                  const expanded = expandedError === err.id
                  return (
                    <>
                      <Tr key={err.id}>
                        <Td>
                          <button
                            onClick={() => setExpandedError(expanded ? null : err.id)}
                            className="p-1 rounded hover:bg-[var(--color-hover-bg)]"
                            title={expanded ? 'Hide traceback' : 'Show traceback'}
                          >
                            {expanded
                              ? <ChevronDown size={12} style={{ color: 'var(--ink-3)' }} />
                              : <ChevronRight size={12} style={{ color: 'var(--ink-3)' }} />}
                          </button>
                        </Td>
                        <Td className="capitalize" style={{ color: 'var(--ink-2)' }}>
                          {err.sync_type.replace(/_/g, ' ')}
                        </Td>
                        <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>#{err.source_id}</Td>
                        <Td className="text-xs max-w-md" style={{ color: 'var(--danger)' }}>
                          <span className={expanded ? '' : 'line-clamp-2'}>{err.error_message}</span>
                        </Td>
                        <Td className="text-right text-xs mono" style={{ color: 'var(--ink-2)' }}>
                          {err.retry_count}/{err.max_retries}
                        </Td>
                        <Td>
                          {!err.resolved && (
                            <button
                              onClick={() => handleResolveError(err.id)}
                              className="text-xs underline"
                              style={{ color: 'var(--brand)' }}
                              title="Mark resolved without retrying"
                            >
                              Resolve
                            </button>
                          )}
                        </Td>
                      </Tr>
                      {expanded && err.traceback && (
                        <Tr key={`${err.id}-tb`}>
                          <Td colSpan={6} className="p-0">
                            <pre
                              className="overflow-x-auto text-[11px] leading-snug p-4 mono whitespace-pre"
                              style={{ background: 'var(--surface-1)', color: 'var(--ink-2)' }}
                            >
                              {err.traceback}
                            </pre>
                          </Td>
                        </Tr>
                      )}
                    </>
                  )
                })}
              </Tbody>
            </Table>
          )}
        </Card>
      )}

      {/* Sync history */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Sync History</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
              {stats.totalRecords.toLocaleString()} records processed across {logs.length} entries
              {stats.lastRun && <> · last run {formatDate(stats.lastRun)}</>}
            </p>
          </div>
          <Button variant="link" size="sm" onClick={loadAll}>Refresh</Button>
        </CardHeader>
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
          <div className="overflow-x-auto">
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
          </div>
        )}
      </Card>

      {/* Advanced — full resync (destructive) */}
      <Card className="overflow-hidden p-0" style={{ borderColor: 'rgba(192,57,43,0.20)' }}>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap"
                    style={{ background: 'rgba(192,57,43,0.04)' }}>
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2"
                style={{ color: 'var(--danger)' }}>
              <ShieldAlert size={14} /> Advanced — full resync
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-2)' }}>
              Wipe every auto-generated journal entry, reset the sync cursors, and
              regenerate from scratch. Manual JVs, bill payments, and receipts are
              never touched. Use after fixing data quality issues upstream.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={openFullResync}
            style={{ color: 'var(--danger)', borderColor: 'rgba(192,57,43,0.30)' }}
          >
            <Trash2 size={14} /> Reset and rebuild
          </Button>
        </CardHeader>
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

      {/* Full-resync modal */}
      {fullResyncOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        >
          <Card className="max-w-lg w-full overflow-hidden p-0">
            <div className="p-5 border-b" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-base font-semibold flex items-center gap-2"
                  style={{ color: 'var(--danger)' }}>
                <ShieldAlert size={16} /> Full resync — destructive
              </h2>
            </div>
            <div className="p-5 space-y-4">
              {!resyncPreview ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 size={20} className="animate-spin" style={{ color: 'var(--brand)' }} />
                </div>
              ) : (
                <>
                  <div className="text-sm space-y-1" style={{ color: 'var(--ink)' }}>
                    <p>
                      This will <strong>delete {resyncPreview.would_delete_journals?.toLocaleString() ?? 0}</strong>{' '}
                      auto-generated journal entries and reset{' '}
                      <strong>{resyncPreview.would_reset_cursors ?? 0}</strong> sync cursors.
                    </p>
                    <p style={{ color: 'var(--ink-2)' }}>
                      Manual entries (bill payments, receipts, manual JVs) are preserved.
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
                      Type <span className="mono">RESET</span> to confirm
                    </label>
                    <input
                      value={resyncTyping}
                      onChange={(e) => setResyncTyping(e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border rounded-md mono"
                      style={{
                        background: 'var(--surface-0)',
                        borderColor: 'var(--line)',
                        color: 'var(--ink)',
                      }}
                      autoFocus
                    />
                  </div>
                </>
              )}
            </div>
            <div className="p-4 border-t flex items-center justify-end gap-2"
                 style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}>
              <Button variant="secondary" onClick={() => setFullResyncOpen(false)} disabled={resyncRunning}>
                Cancel
              </Button>
              <Button
                onClick={handleFullResyncConfirm}
                disabled={resyncRunning || resyncTyping !== 'RESET' || !resyncPreview}
                style={{ background: 'var(--danger)', color: 'white' }}
              >
                {resyncRunning ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {resyncRunning ? 'Resetting…' : 'Reset and rebuild'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { RefreshCw, Loader2, CheckCircle, XCircle, Clock, RotateCcw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { runSync, getSyncLogs, getSyncErrors, retrySyncErrors, type SyncLog, type SyncError } from '../lib/api'
import { formatDate } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card, CardHeader } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeletons'
import { AlertBanner } from '../components/ui/AlertBanner'

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
      {s.icon}{status}
    </Badge>
  )
}

export default function SyncPage() {
  const [logs, setLogs] = useState<SyncLog[]>([])
  const [errors, setErrors] = useState<SyncError[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [retrying, setRetrying] = useState(false)

  async function loadAll() {
    try {
      const [logRes, errRes] = await Promise.all([getSyncLogs(), getSyncErrors()])
      setLogs(logRes)
      setErrors(errRes)
    } catch {
      toast.error('Failed to load sync data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  async function handleSync() {
    setSyncing(true)
    try {
      await runSync()
      toast.success('Sync triggered successfully')
      await loadAll()
    } catch {
      toast.error('Sync failed. Check logs for details.')
    } finally {
      setSyncing(false)
    }
  }

  async function handleRetry() {
    setRetrying(true)
    try {
      const result = await retrySyncErrors()
      toast.success(`Retried ${result.result.retried} errors: ${result.result.resolved} resolved, ${result.result.failed} failed`)
      await loadAll()
    } catch {
      toast.error('Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Data Sync</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>Sync accounting data from inventory & sales systems.</p>
        </div>
        <div className="flex items-center gap-2">
          {errors.length > 0 && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="flex items-center gap-2 px-3 h-9 text-sm font-medium rounded-md disabled:opacity-60"
              style={{ background: 'rgba(199,122,17,0.08)', border: '1px solid rgba(199,122,17,0.30)', color: 'var(--warning)' }}
            >
              {retrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Retry Failed ({errors.length})
            </button>
          )}
          <Button onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {syncing ? 'Syncing…' : 'Run Sync'}
          </Button>
        </div>
      </div>

      {syncing && (
        <AlertBanner tone="info">
          <span className="inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Sync in progress. This may take a few minutes…
          </span>
        </AlertBanner>
      )}

      {errors.length > 0 && (
        <Card className="overflow-hidden p-0" style={{ borderColor: 'rgba(192,57,43,0.30)' }}>
          <div
            className="px-5 py-3 border-b flex items-center gap-2"
            style={{ background: 'rgba(192,57,43,0.06)', borderColor: 'rgba(192,57,43,0.20)' }}
          >
            <AlertTriangle size={14} style={{ color: 'var(--danger)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>
              Failed records (<span className="mono">{errors.length}</span>)
            </h2>
          </div>
          <Table>
            <Thead>
              <Tr>
                <Th>Type</Th>
                <Th>Source ID</Th>
                <Th>Error</Th>
                <Th className="text-right">Retries</Th>
              </Tr>
            </Thead>
            <Tbody>
              {errors.map((err) => (
                <Tr key={err.id}>
                  <Td className="capitalize" style={{ color: 'var(--ink-2)' }}>{err.sync_type.replace(/_/g, ' ')}</Td>
                  <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>#{err.source_id}</Td>
                  <Td className="text-xs max-w-sm truncate" style={{ color: 'var(--danger)' }}>{err.error_message}</Td>
                  <Td className="text-right text-xs mono" style={{ color: 'var(--ink-2)' }}>{err.retry_count}/{err.max_retries}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <CardHeader className="flex flex-row items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Sync History</h2>
          <Button variant="link" size="sm" onClick={loadAll}>Refresh</Button>
        </CardHeader>
        {loading ? (
          <SkeletonTable rows={6} cols={5} />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={RefreshCw}
            title="No sync logs yet"
            description="Run a sync to import customers, suppliers, and posted bills from inventory."
            actionLabel="Run Sync"
            onAction={handleSync}
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Sync Type</Th>
                <Th>Last Synced</Th>
                <Th className="text-right">Records</Th>
                <Th>Status</Th>
                <Th>Error</Th>
              </Tr>
            </Thead>
            <Tbody>
              {logs.map((log) => (
                <Tr key={log.id}>
                  <Td className="font-medium capitalize" style={{ color: 'var(--ink)' }}>{log.sync_type.replace(/_/g, ' ')}</Td>
                  <Td style={{ color: 'var(--ink-2)' }}>{formatDate(log.last_synced_at)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{log.records_processed.toLocaleString()}</Td>
                  <Td><SyncStatusBadge status={log.status} /></Td>
                  <Td className="text-xs max-w-xs truncate" style={{ color: 'var(--danger)' }}>{log.error_message || '—'}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { RefreshCw, Loader2, CheckCircle, XCircle, Clock, RotateCcw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { runSync, getSyncLogs, getSyncErrors, retrySyncErrors, type SyncLog, type SyncError } from '../lib/api'
import { formatDate } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card, CardHeader } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'

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
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Data Sync</h1>
          <p className="text-sm text-slate-500 mt-0.5">Sync accounting data from inventory & sales systems</p>
        </div>
        <div className="flex items-center gap-2">
          {errors.length > 0 && (
            <button onClick={handleRetry} disabled={retrying}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-amber-700 border border-amber-300 bg-amber-50 rounded-lg hover:bg-amber-100 disabled:opacity-60 transition-colors">
              {retrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Retry Failed ({errors.length})
            </button>
          )}
          <Button onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {syncing ? 'Syncing...' : 'Run Sync'}
          </Button>
        </div>
      </div>

      {syncing && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center gap-3">
          <Loader2 size={16} className="animate-spin text-blue-600" />
          <p className="text-sm text-blue-700">Sync in progress. This may take a few minutes...</p>
        </div>
      )}

      {/* Sync Errors */}
      {errors.length > 0 && (
        <Card className="mb-4 overflow-hidden border-red-200">
          <div className="px-5 py-3 border-b border-red-100 bg-red-50 flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-600" />
            <h2 className="text-sm font-semibold text-red-800">Failed Records ({errors.length})</h2>
          </div>
          <Table>
            <Thead>
              <Tr className="bg-slate-50">
                <Th>Type</Th>
                <Th>Source ID</Th>
                <Th>Error</Th>
                <Th className="text-right">Retries</Th>
              </Tr>
            </Thead>
            <Tbody>
              {errors.map((err) => (
                <Tr key={err.id}>
                  <Td className="capitalize text-slate-500">{err.sync_type.replace(/_/g, ' ')}</Td>
                  <Td className="font-mono text-xs text-slate-500">#{err.source_id}</Td>
                  <Td className="text-xs text-red-600 max-w-sm truncate">{err.error_message}</Td>
                  <Td className="text-right text-xs text-slate-500">{err.retry_count}/{err.max_retries}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Sync History</h2>
          <Button variant="link" size="sm" onClick={loadAll}>Refresh</Button>
        </CardHeader>
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th>Sync Type</Th>
              <Th>Last Synced</Th>
              <Th className="text-right">Records</Th>
              <Th>Status</Th>
              <Th>Error</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-400 text-sm">No sync logs found. Run a sync to get started.</td></tr>
            ) : logs.map((log) => (
              <Tr key={log.id}>
                <Td className="font-medium text-slate-900 capitalize">{log.sync_type.replace(/_/g, ' ')}</Td>
                <Td className="text-slate-500">{formatDate(log.last_synced_at)}</Td>
                <Td className="text-right font-mono text-slate-500">{log.records_processed.toLocaleString()}</Td>
                <Td><SyncStatusBadge status={log.status} /></Td>
                <Td className="text-xs text-red-600 max-w-xs truncate">{log.error_message || '-'}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

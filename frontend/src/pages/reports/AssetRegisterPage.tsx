import { useState } from 'react'
import { Download, Landmark, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { getAssetRegister, type AssetRegisterRow } from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'

type AssetTotals = {
  acquisition_cost: string; cgst: string; sgst: string; igst: string
  accumulated_depreciation: string; net_book_value: string
}

export default function AssetRegisterPage() {
  const [rows, setRows] = useState<AssetRegisterRow[]>([])
  const [totals, setTotals] = useState<AssetTotals | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (dateFrom) params.start_date = dateFrom
      if (dateTo) params.end_date = dateTo
      const res = await getAssetRegister(params)
      setRows(res.rows)
      setTotals(res.totals)
      setFetched(true)
    } catch {
      toast.error('Failed to load asset register')
    } finally {
      setLoading(false)
    }
  }

  async function exportAs(fmt: 'csv' | 'xlsx') {
    try {
      const params: Record<string, string> = { export: fmt }
      if (dateFrom) params.start_date = dateFrom
      if (dateTo) params.end_date = dateTo
      const res = await api.get('/reports/asset-register/', { params, responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Asset_Register_${dateFrom || 'all'}_${dateTo || 'all'}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed')
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Asset Register</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Fixed assets with acquisition-time ITC, accumulated depreciation and net book value.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => exportAs('csv')} disabled={rows.length === 0}>
            <Download size={15} />CSV
          </Button>
          <Button variant="secondary" onClick={() => exportAs('xlsx')} disabled={rows.length === 0}>
            <Download size={15} />Excel
          </Button>
        </div>
      </div>

      {/* Acquisition-date filters — leave blank for the full register */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>Acquired From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-auto" />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-auto" />
        </div>
        <Button className="w-full sm:w-auto" onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={10} />
      ) : !fetched ? (
        <EmptyState
          icon={Landmark}
          title="Run the asset register"
          description="Click Run Report for the full fixed-asset register, or narrow it to acquisitions in a date range."
          actionLabel="Run Report"
          onAction={load}
        />
      ) : rows.length === 0 ? (
        <EmptyState variant="no-data" title="No assets found" description="Capitalise fixed assets from the Fixed Assets screen first." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">Asset No</Th>
                <Th className="text-left">Name</Th>
                <Th className="text-left">Class</Th>
                <Th className="text-left">Vendor</Th>
                <Th className="text-left">GSTIN</Th>
                <Th className="text-left">Acquired</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">CGST</Th>
                <Th className="text-right">SGST</Th>
                <Th className="text-right">IGST</Th>
                <Th className="text-right">Accum. Dep.</Th>
                <Th className="text-right">NBV</Th>
                <Th className="text-left">Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r, i) => (
                <Tr key={i}>
                  <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>{r.asset_no}</Td>
                  <Td className="font-medium max-w-[180px] truncate" style={{ color: 'var(--ink)' }} title={r.name}>{r.name}</Td>
                  <Td style={{ color: 'var(--ink-2)' }}>{r.asset_class}</Td>
                  <Td className="max-w-[150px] truncate" style={{ color: 'var(--ink-2)' }} title={r.party_name}>{r.party_name}</Td>
                  <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>{r.gstin || '-'}</Td>
                  <Td style={{ color: 'var(--ink-2)' }}>{formatDate(r.acquisition_date)}</Td>
                  <Td className="text-right mono">{formatCurrency(r.acquisition_cost)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(r.cgst)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(r.sgst)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(r.igst)}</Td>
                  <Td className="text-right mono" style={{ color: 'var(--ink-2)' }}>{formatCurrency(r.accumulated_depreciation)}</Td>
                  <Td className="text-right mono font-medium">{formatCurrency(r.net_book_value)}</Td>
                  <Td>
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize"
                      style={r.status === 'active'
                        ? { backgroundColor: '#eaf6f1', color: '#1a7a4e' }
                        : { backgroundColor: '#f1f5f9', color: '#475569' }}
                    >
                      {r.status.replace('_', ' ')}
                    </span>
                  </Td>
                </Tr>
              ))}
            </Tbody>
            {totals && (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--color-grey-light)' }} className="font-semibold">
                  <td colSpan={6} className="py-3 px-4 text-sm" style={{ color: 'var(--ink-2)' }}>Totals ({rows.length} assets)</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.acquisition_cost)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.cgst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.sgst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.igst)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.accumulated_depreciation)}</td>
                  <td className="py-3 px-4 text-right mono">{formatCurrency(totals.net_book_value)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </Table>
        </Card>
      )}
    </div>
  )
}

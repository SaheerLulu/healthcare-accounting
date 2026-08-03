import { useEffect, useState } from 'react'
import { Loader2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import {
  getTDSDeductions, getTDSChallans, autoGenerateChallan,
  type TDSDeduction, type TDSChallan,
} from '../lib/api'
import { formatCurrency, formatDate, getCurrentPeriod } from '../lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { PeriodPicker } from '../components/ui/period-picker'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'

const TDS_SECTIONS = ['194C', '194H', '194I', '194J', '194O', '194Q']
const TDS_STATUSES = ['pending', 'challan_paid', 'returned']

function TdsStatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, 'warning' | 'success' | 'info' | 'default'> = {
    pending: 'warning',
    challan_paid: 'success',
    returned: 'info',
  }
  return (
    <Badge variant={variantMap[status] || 'default'}>
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}

function DeductionsTab() {
  const [rows, setRows] = useState<TDSDeduction[]>([])
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState('')
  const [status, setStatus] = useState('')
  const [period, setPeriod] = useState('')

  async function load() {
    setLoading(true)
    const params: Record<string, string> = {}
    if (section) params.section = section
    if (status) params.status = status
    if (period) params.period = period
    try {
      const res = await getTDSDeductions(params)
      setRows(res.results)
    } catch { toast.error('Failed to load TDS deductions') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [section, status, period])

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={section} onChange={(e) => setSection(e.target.value)}
          className="w-full sm:w-auto px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
          <option value="">All Sections</option>
          {TDS_SECTIONS.map((s) => <option key={s} value={s}>Sec {s}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="w-full sm:w-auto px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 capitalize">
          <option value="">All Statuses</option>
          {TDS_STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</option>)}
        </select>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
        {(section || status || period) && (
          <button onClick={() => { setSection(''); setStatus(''); setPeriod('') }}
            className="text-xs text-slate-500 hover:text-slate-900 underline">Clear</button>
        )}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th>Deductee</Th>
              <Th>PAN</Th>
              <Th>Section</Th>
              <Th>Date</Th>
              <Th className="text-right">Payment Amt</Th>
              <Th className="text-right">TDS Rate</Th>
              <Th className="text-right">TDS Amount</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No TDS deductions found</td></tr>
            ) : rows.map((row) => (
              <Tr key={row.id}>
                <Td className="font-medium text-slate-900">{row.deductee_name}</Td>
                <Td className="font-mono text-xs text-slate-500">{row.deductee_pan || '-'}</Td>
                <Td><Badge variant="default">{row.section}</Badge></Td>
                <Td className="text-slate-500">{formatDate(row.transaction_date)}</Td>
                <Td className="text-right font-mono text-slate-900">{formatCurrency(row.gross_amount)}</Td>
                <Td className="text-right font-mono text-slate-500">{Number(row.tds_rate).toFixed(2)}%</Td>
                <Td className="text-right font-mono font-semibold text-slate-900">{formatCurrency(row.tds_amount)}</Td>
                <Td><TdsStatusBadge status={row.status} /></Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

function ChallansTab() {
  const [rows, setRows] = useState<TDSChallan[]>([])
  const [loading, setLoading] = useState(true)
  const [autoOpen, setAutoOpen] = useState(false)
  const [autoSection, setAutoSection] = useState('194Q')
  const [autoPeriod, setAutoPeriod] = useState(getCurrentPeriod())
  const [generating, setGenerating] = useState(false)

  async function loadChallans() {
    setLoading(true)
    try {
      const res = await getTDSChallans()
      setRows(res.results)
    } catch { toast.error('Failed to load challans') } finally { setLoading(false) }
  }

  useEffect(() => { loadChallans() }, [])

  async function handleAutoGenerate() {
    setGenerating(true)
    try {
      await autoGenerateChallan(autoSection, autoPeriod)
      toast.success('Challan generated successfully')
      setAutoOpen(false)
      loadChallans()
    } catch { toast.error('No pending deductions found or generation failed') } finally { setGenerating(false) }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Dialog open={autoOpen} onOpenChange={setAutoOpen}>
          <DialogTrigger asChild>
            <Button>
              <Zap size={14} /> Auto-Generate Challan
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Auto-Generate Challan</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Section</label>
                <select value={autoSection} onChange={(e) => setAutoSection(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
                  {TDS_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Period</label>
                <PeriodPicker value={autoPeriod} onChange={setAutoPeriod} />
              </div>
              <Button onClick={handleAutoGenerate} disabled={generating}>
                {generating && <Loader2 size={14} className="animate-spin" />}
                Generate
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th>Challan No</Th>
              <Th>Deposit Date</Th>
              <Th>Period</Th>
              <Th>Section</Th>
              <Th>BSR Code</Th>
              <Th className="text-right">Total TDS</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No challans found</td></tr>
            ) : rows.map((row) => (
              <Tr key={row.id}>
                <Td className="font-mono text-xs text-teal-600">{row.challan_no}</Td>
                <Td className="text-slate-500">{formatDate(row.deposit_date)}</Td>
                <Td className="text-slate-500">{row.period}</Td>
                <Td><Badge variant="default">{row.section}</Badge></Td>
                <Td className="font-mono text-xs text-slate-500">{row.bsr_code || '-'}</Td>
                <Td className="text-right font-mono font-semibold text-slate-900">{formatCurrency(row.total_tds_amount)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

export default function TDSPage() {
  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>TDS</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Tax Deducted at Source — Updated rates for FY 2025-26</p>
      </div>

      <Tabs defaultValue="deductions">
        <TabsList>
          {['deductions', 'challans'].map((tab) => (
            <TabsTrigger key={tab} value={tab} className="capitalize">
              {tab}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="deductions"><DeductionsTab /></TabsContent>
        <TabsContent value="challans"><ChallansTab /></TabsContent>
      </Tabs>
    </div>
  )
}

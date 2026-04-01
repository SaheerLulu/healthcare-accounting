import { useState } from 'react'
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { getDaybook, type DaybookDay, type DaybookEntry } from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'

const voucherLabel = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

function DaybookEntryRow({ entry }: { entry: DaybookEntry }) {
  const [expanded, setExpanded] = useState(false)
  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0)
  const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0)

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-slate-400">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className="text-sm font-mono text-teal-600 w-36">{entry.entry_no}</span>
        <Badge variant="default" className="text-xs">{voucherLabel(entry.voucher_type)}</Badge>
        <span className="text-sm text-slate-700 flex-1 truncate">{entry.narration || '-'}</span>
        <span className="text-sm font-mono text-slate-900 w-28 text-right">{formatCurrency(totalDebit)}</span>
        <span className="text-sm font-mono text-slate-900 w-28 text-right">{formatCurrency(totalCredit)}</span>
      </div>
      {expanded && (
        <div className="px-12 pb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left pb-1 font-medium">Account</th>
                <th className="text-right pb-1 font-medium">Debit</th>
                <th className="text-right pb-1 font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line, i) => (
                <tr key={i}>
                  <td className="py-0.5 text-slate-600">
                    <span className="font-mono text-slate-400 mr-2">{line.account_code}</span>
                    {line.account_name}
                  </td>
                  <td className="py-0.5 text-right font-mono text-slate-900">
                    {Number(line.debit) > 0 ? formatCurrency(line.debit) : '-'}
                  </td>
                  <td className="py-0.5 text-right font-mono text-slate-900">
                    {Number(line.credit) > 0 ? formatCurrency(line.credit) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function DaybookPage() {
  const today = new Date().toISOString().split('T')[0]
  const [days, setDays] = useState<DaybookDay[]>([])
  const [summary, setSummary] = useState({ total_entries: 0, total_debit: '0.00', total_credit: '0.00' })
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)

  async function load() {
    setLoading(true)
    try {
      const res = await getDaybook({ start_date: dateFrom, end_date: dateTo })
      setDays(res.days)
      setSummary(res.summary)
      setFetched(true)
    } catch {
      toast.error('Failed to load daybook')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Daybook</h1>
        <p className="text-sm text-slate-500 mt-0.5">Chronological register of all transactions</p>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto px-2.5 py-1.5" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto px-2.5 py-1.5" />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
      </div>

      {fetched && (
        <div className="flex items-center gap-6 mb-4 text-sm text-slate-600">
          <span>Entries: <span className="font-semibold text-slate-900">{summary.total_entries}</span></span>
          <span>Total Debit: <span className="font-mono font-semibold text-slate-900">{formatCurrency(summary.total_debit)}</span></span>
          <span>Total Credit: <span className="font-mono font-semibold text-slate-900">{formatCurrency(summary.total_credit)}</span></span>
        </div>
      )}

      {loading && (
        <div className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></div>
      )}

      {!loading && fetched && days.length === 0 && (
        <Card className="p-8 text-center text-slate-400 text-sm">No transactions found for the selected period</Card>
      )}

      {!loading && days.map((day) => (
        <Card key={day.date} className="overflow-hidden mb-4">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">{formatDate(day.date)}</span>
              <span className="text-xs text-slate-500">{day.entries.length} {day.entries.length === 1 ? 'entry' : 'entries'}</span>
            </div>
            <div className="flex gap-8 mt-1 text-xs text-slate-500">
              <span className="w-36">Entry No</span>
              <span>Type</span>
              <span className="flex-1">Narration</span>
              <span className="w-28 text-right">Debit</span>
              <span className="w-28 text-right">Credit</span>
            </div>
          </div>
          {day.entries.map((entry) => (
            <DaybookEntryRow key={entry.id} entry={entry} />
          ))}
        </Card>
      ))}

      {!loading && !fetched && (
        <Card className="p-8 text-center text-slate-400 text-sm">Select date range and run report</Card>
      )}
    </div>
  )
}

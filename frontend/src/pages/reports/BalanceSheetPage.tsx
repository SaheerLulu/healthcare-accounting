import { useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { getBalanceSheet, type BSReport, type BSGroupSection } from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card, CardContent } from '../../components/ui/card'
import { Table, Tbody, Tr, Td } from '../../components/ui/table'
import { AlertBanner } from '../../components/ui/AlertBanner'

const SECTION_COLORS = {
  blue: { bg: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.20)', fg: 'var(--info)' },
  red: { bg: 'rgba(192,57,43,0.06)', border: 'rgba(192,57,43,0.18)', fg: 'var(--danger)' },
  purple: { bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.20)', fg: '#7c3aed' },
} as const

function Section({
  title,
  section,
  color,
}: {
  title: string
  section: BSGroupSection
  color: keyof typeof SECTION_COLORS
}) {
  const c = SECTION_COLORS[color]
  return (
    <Card className="overflow-hidden p-0">
      <div className="px-4 sm:px-5 py-3 border-b" style={{ background: c.bg, borderColor: c.border }}>
        <h2 className="text-sm font-semibold" style={{ color: c.fg }}>{title}</h2>
      </div>
      <Table>
        <Tbody>
          {section.items.map((item, i) => (
            <Tr key={i}>
              <Td className="mono text-xs" style={{ color: 'var(--ink-3)' }}>{item.account_code}</Td>
              <Td style={{ color: 'var(--ink-2)' }}>{item.account_name}</Td>
              <Td className="text-right mono" style={{ color: 'var(--ink)' }}>{formatCurrency(item.balance)}</Td>
            </Tr>
          ))}
          {section.items.length === 0 && (
            <Tr><Td colSpan={3} className="py-6 text-center text-sm" style={{ color: 'var(--ink-3)' }}>No entries</Td></Tr>
          )}
        </Tbody>
        <tfoot>
          <tr style={{ borderTop: `2px solid ${c.border}`, background: c.bg }}>
            <td colSpan={2} className="py-3 px-5 text-sm font-semibold" style={{ color: c.fg }}>Total {title}</td>
            <td className="py-3 px-5 text-right mono font-bold" style={{ color: c.fg }}>{formatCurrency(section.total)}</td>
          </tr>
        </tfoot>
      </Table>
    </Card>
  )
}

export default function BalanceSheetPage() {
  const [report, setReport] = useState<BSReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [asOf, setAsOf] = useState(new Date().toISOString().split('T')[0])

  async function load() {
    setLoading(true)
    try {
      const res = await getBalanceSheet({ date: asOf })
      setReport(res)
    } catch {
      toast.error('Failed to load balance sheet')
    } finally {
      setLoading(false)
    }
  }

  const balanced = report ? report.is_balanced : false

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Balance Sheet</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>Financial position at a point in time.</p>
      </div>

      {report && (
        <AlertBanner
          tone={balanced ? 'success' : 'danger'}
          title={
            <span className="inline-flex items-center gap-1.5">
              {balanced ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {balanced ? 'Balanced' : 'Not Balanced'}
            </span>
          }
        >
          {balanced
            ? 'Assets equal Liabilities + Equity.'
            : 'Assets do not match Liabilities + Equity. Investigate journal entries before relying on these numbers.'}
        </AlertBanner>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-none">
          <label className="text-xs font-medium mono uppercase whitespace-nowrap" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>As of</label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-full sm:w-auto" />
        </div>
        <Button onClick={load} disabled={loading} className="w-full sm:w-auto">
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--brand)' }} />
        </div>
      )}

      {!loading && !report && (
        <Card className="flex items-center justify-center py-20 text-sm" style={{ color: 'var(--ink-3)' }}>
          Select a date and run report.
        </Card>
      )}

      {!loading && report && (
        <div className="flex flex-col gap-4">
          <Section title="Assets" section={report.assets} color="blue" />
          <Section title="Liabilities" section={report.liabilities} color="red" />
          <Section title="Equity" section={report.equity} color="purple" />

          <Card>
            <CardContent>
              <div className="flex items-center justify-between gap-3 py-2 border-b" style={{ borderColor: 'var(--line)' }}>
                <span className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>Total Assets</span>
                <span className="mono font-semibold whitespace-nowrap" style={{ color: 'var(--info)' }}>{formatCurrency(report.assets.total)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>Total Liabilities + Equity</span>
                <span className="mono font-semibold whitespace-nowrap" style={{ color: 'var(--ink)' }}>{formatCurrency(report.total_liabilities_equity)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

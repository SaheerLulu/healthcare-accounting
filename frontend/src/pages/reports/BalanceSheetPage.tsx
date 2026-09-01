import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { getBalanceSheet, type BSReport, type BSGroupSection } from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card, CardContent } from '../../components/ui/card'
import { Table, Tbody, Tr, Td } from '../../components/ui/table'
import { AlertBanner } from '../../components/ui/AlertBanner'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

const SECTION_COLORS = {
  blue: { bg: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.20)', fg: 'var(--info)' },
  red: { bg: 'rgba(192,57,43,0.06)', border: 'rgba(192,57,43,0.18)', fg: 'var(--danger)' },
  purple: { bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.20)', fg: '#7c3aed' },
} as const

/** The roving-tabindex props the page hands down to each section's rows. */
type RowProps = ReturnType<typeof useListKeyboardNav>['rowProps']

function Section({
  title,
  section,
  color,
  offset,
  rowProps,
  onOpen,
}: {
  title: string
  section: BSGroupSection
  color: keyof typeof SECTION_COLORS
  /** Where this section's first item sits in the page-wide row cursor. */
  offset: number
  rowProps: RowProps
  onOpen: (accountCode: string) => void
}) {
  const c = SECTION_COLORS[color]
  return (
    <Card className="overflow-hidden p-0">
      <div className="px-4 sm:px-5 py-3 border-b" style={{ background: c.bg, borderColor: c.border }}>
        <h2 className="text-sm font-semibold" style={{ color: c.fg }}>{title}</h2>
      </div>
      <Table label={title}>
        <Tbody>
          {section.items.map((item, i) => (
            <Tr
              key={i}
              className="cursor-pointer"
              onClick={() => onOpen(item.account_code)}
              aria-label={`${item.account_code} ${item.account_name}, ${formatCurrency(item.balance)} — open ledger`}
              {...rowProps(offset + i)}
            >
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
  const navigate = useNavigate()
  const [report, setReport] = useState<BSReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [asOf, setAsOf] = useState(new Date().toISOString().split('T')[0])
  const asOfRef = useRef<HTMLInputElement>(null)

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

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // Assets / Liabilities / Equity are three cards but one statement, so they
  // share ONE row cursor: ↑↓ read straight down the balance sheet across the
  // section breaks, Tab still steps past the whole thing, and Enter opens the
  // account's ledger as at the reporting date.
  const items = useMemo(
    () => (report
      ? [...report.assets.items, ...report.liabilities.items, ...report.equity.items]
      : []),
    [report],
  )
  const liabilitiesOffset = report ? report.assets.items.length : 0
  const equityOffset = liabilitiesOffset + (report ? report.liabilities.items.length : 0)

  function openLedger(accountCode: string) {
    // LedgerPage defaults `from` to the FY start when it is omitted, so the
    // as-of date only needs to cap the range.
    navigate(`/reports/ledger/${encodeURIComponent(accountCode)}?to=${encodeURIComponent(asOf)}`)
  }

  const list = useListKeyboardNav({
    count: items.length,
    onActivate: (i) => openLedger(items[i].account_code),
  })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+R', label: 'Run report', run: load, when: !loading },
    ],
    searchRef: asOfRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

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

      {/* Filter — a <form>, so Enter in the date runs the report rather than
          the button being the only way to fire it. */}
      <form
        className="flex items-center gap-2 sm:gap-3 flex-wrap"
        onSubmit={(e) => { e.preventDefault(); load() }}
      >
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-none">
          <label htmlFor="bs-as-of" className="text-xs font-medium mono uppercase whitespace-nowrap" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>As of</label>
          <Input id="bs-as-of" ref={asOfRef} data-autofocus type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-full sm:w-auto" />
        </div>
        <Button type="submit" chord="Alt+R" disabled={loading} className="w-full sm:w-auto">
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
      </form>

      {/* The statement replaces itself under a user whose focus never moves. */}
      <div className="sr-only" role="status" aria-live="polite">
        {loading
          ? 'Running balance sheet…'
          : report
            ? `Balance sheet as at ${asOf}. ${items.length} accounts. ${balanced ? 'Balanced.' : 'Not balanced.'}`
            : ''}
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
        <div className="flex flex-col gap-4" {...list.containerProps}>
          <Section title="Assets" section={report.assets} color="blue" offset={0} rowProps={list.rowProps} onOpen={openLedger} />
          <Section title="Liabilities" section={report.liabilities} color="red" offset={liabilitiesOffset} rowProps={list.rowProps} onOpen={openLedger} />
          <Section title="Equity" section={report.equity} color="purple" offset={equityOffset} rowProps={list.rowProps} onOpen={openLedger} />

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

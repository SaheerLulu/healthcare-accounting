import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Users,
  Building,
  Receipt,
  Banknote,
  Landmark,
  Scale,
  ArrowUpRight,
  AlertTriangle,
} from 'lucide-react'
import { getDashboard, type DashboardData } from '../lib/api'
import { formatCurrency, getCurrentFY, todayISO } from '../lib/utils'
import { Input } from '../components/ui/input'
import { KpiCard } from '../components/ui/KpiCard'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonCard, SkeletonTable } from '../components/ui/Skeletons'
import { useLocation as useAppLocation } from '../contexts/LocationContext'

const EMPTY: DashboardData = {
  total_revenue: 0,
  total_expenses: 0,
  net_profit: 0,
  total_receivables: 0,
  total_payables: 0,
  gst_payable: 0,
  cash_balance: 0,
  bank_balance: 0,
  total_assets: 0,
  monthly_data: [],
}

// Bounds for the date pickers. These make the native picker sane; they do NOT
// enforce anything on their own — see commitDate for the actual check.
const MIN_DATE = '2000-01-01'
const MAX_DATE = '2100-12-31'

function pctDelta(series: number[]): number {
  if (series.length < 2) return 0
  const last = series[series.length - 1]
  const prev = series[series.length - 2]
  if (!prev) return 0
  return ((last - prev) / Math.abs(prev)) * 100
}

// Nine cards in three rows of three: performance, then what is owed, then
// what is held. Deliberately NOT 4-up on xl — that would strand a tenth of a
// row — and the skeleton shares the class so the grid does not reflow when
// the data lands.
const KPI_GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Last calendar day (YYYY-MM-DD) of the month a monthly_data bucket labels —
 * the server formats those labels as "%b %Y" ("Aug 2026"). null when the label
 * is not in that form, which the caller treats as "assume complete" so an
 * unexpected label can never silently blank the trend.
 */
function bucketMonth(label: string): { first: string; last: string } | null {
  const [mon, yr] = String(label ?? '').trim().split(/\s+/)
  const mi = MONTH_ABBR.indexOf(mon)
  const year = Number(yr)
  if (mi < 0 || !Number.isInteger(year)) return null
  const mm = String(mi + 1).padStart(2, '0')
  const last = new Date(year, mi + 1, 0).getDate()
  return { first: `${year}-${mm}-01`, last: `${year}-${mm}-${String(last).padStart(2, '0')}` }
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const { activeLocationId } = useAppLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  // Default window = current financial year; any custom range is allowed.
  // The range lives in the URL because Layout keys PageTransition by store, so
  // switching stores REMOUNTS this page and every useState initialiser re-runs
  // — a range held only in state would silently snap back to the FY.
  // (PageTransition itself keys on pathname only, so writing search params
  // does not remount anything and cannot loop.)
  const fy = getCurrentFY()
  const [dateFrom, setDateFrom] = useState(searchParams.get('from') || fy.start)
  const [dateTo, setDateTo] = useState(searchParams.get('to') || fy.end)
  // Drafts are what the inputs display. A native date input commits a COMPLETE
  // value the moment the year segment takes its first digit ("0002-03-31"), so
  // binding the fetch to onChange fired a request — and re-rendered the input —
  // mid-keystroke. Only blur/Enter promotes a draft to the committed range.
  const [fromDraft, setFromDraft] = useState(dateFrom)
  const [toDraft, setToDraft] = useState(dateTo)
  const isDefaultFY = dateFrom === fy.start && dateTo === fy.end

  useEffect(() => {
    if (!dateFrom || !dateTo) return
    // Without this guard the LAST response to settle wins, not the last range
    // asked for — a slow wide range landing after a fast narrow one repaints
    // the page with figures the toolbar no longer describes.
    let cancelled = false
    setLoading(true)
    getDashboard({ start_date: dateFrom, end_date: dateTo })
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // activeLocationId stays in the deps deliberately: it is inert only because
    // Layout remounts this page on a store switch, and depending on that makes
    // correctness here hostage to an unrelated component.
  }, [activeLocationId, dateFrom, dateTo])

  function persistRange(from: string, to: string) {
    // Merge — replacing the whole param set would drop anything another feature
    // parked in the URL.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('from', from)
      next.set('to', to)
      return next
    }, { replace: true })
  }

  /**
   * Promote an edited date field to the committed range. min/max are set for
   * the picker's benefit only — outside a <form> constraint validation blocks
   * neither the value nor the change event, so the year-0002 case is caught by
   * calling checkValidity() explicitly here. An invalid or cleared field snaps
   * back to the committed value rather than firing a request for a range the
   * user never asked for.
   */
  function commitDate(which: 'from' | 'to', el: HTMLInputElement) {
    const committed = which === 'from' ? dateFrom : dateTo
    const value = el.value
    if (!value || !el.checkValidity()) {
      if (which === 'from') setFromDraft(committed)
      else setToDraft(committed)
      return
    }
    if (value === committed) return
    if (which === 'from') {
      setDateFrom(value)
      persistRange(value, dateTo)
    } else {
      setDateTo(value)
      persistRange(dateFrom, value)
    }
  }

  function resetToFY() {
    setFromDraft(fy.start)
    setToDraft(fy.end)
    setDateFrom(fy.start)
    setDateTo(fy.end)
    persistRange(fy.start, fy.end)
  }

  const monthly = data.monthly_data ?? []

  // Only WHOLE months feed the trends and sparklines. The trailing bucket is
  // the month in progress, so comparing it against a full previous month made a
  // flat 10L/month pharmacy read -93% on the 2nd and -45% on the 17th, every
  // month — and on the Expenses card (isPositiveGood: false) that fake collapse
  // rendered as a reassuring green. A range starting mid-month leaves the same
  // stub at the front, which turns month two into a fake boom.
  const asOf = data.balances_as_of || todayISO()
  const rangeStart = data.range_start ?? dateFrom
  const completeMonths = useMemo(() => {
    let lo = 0
    let hi = monthly.length
    while (hi > lo) {
      const b = bucketMonth(monthly[hi - 1].month)
      // An unparseable label is treated as complete — a caption we cannot read
      // must not silently blank the trends.
      if (b === null || b.last <= asOf) break
      hi -= 1
    }
    if (hi > lo) {
      const b = bucketMonth(monthly[lo].month)
      if (b !== null && rangeStart > b.first) lo += 1
    }
    return monthly.slice(lo, hi)
  }, [monthly, asOf, rangeStart])
  const partialMonths = monthly.length - completeMonths.length

  const revenueSeries = useMemo(() => completeMonths.map((m) => Number(m.revenue) || 0), [completeMonths])
  const expenseSeries = useMemo(() => completeMonths.map((m) => Number(m.expenses) || 0), [completeMonths])
  const profitSeries = useMemo(
    () => completeMonths.map((m) => (Number(m.revenue) || 0) - (Number(m.expenses) || 0)),
    [completeMonths]
  )

  const revTrend = pctDelta(revenueSeries)
  const expTrend = pctDelta(expenseSeries)
  const profitTrend = pctDelta(profitSeries)

  const netProfit = Number(data.net_profit) || 0
  const receivables = Number(data.total_receivables) || 0
  const payables = Number(data.total_payables) || 0
  const gstPayable = Number(data.gst_payable) || 0
  const cash = Number(data.cash_balance) || 0
  const bank = Number(data.bank_balance) || 0
  const totalAssets = Number(data.total_assets) || 0
  const hasMonthly = monthly.length > 0
  // One complete month gives nothing to compare against, so no trend is shown
  // rather than a flat 0%.
  const hasTrend = completeMonths.length >= 2
  const rangeLabel = `${data.range_start ?? dateFrom} → ${data.range_end ?? dateTo}`
  const balancesLabel = data.balances_as_of ?? data.range_end ?? dateTo

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between flex-wrap">
        <div>
          <h1 style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Dashboard</h1>
          {/* Reads back the window the SERVER used, not the one typed: it
              clamps and swaps out-of-order dates, and silently disagreeing with
              the figures below is how a range bug stays invisible. */}
          <p className="mt-0.5" style={{ color: 'var(--ink-2)' }}>
            {isDefaultFY ? 'Current financial year — at a glance' : rangeLabel}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end flex-wrap">
          {/* Stacks label-over-field on phones — two native date pickers
              side by side do not survive a 320px viewport. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>From</label>
            <Input
              type="date"
              value={fromDraft}
              min={MIN_DATE}
              max={MAX_DATE}
              onChange={(e) => setFromDraft(e.target.value)}
              onBlur={(e) => commitDate('from', e.currentTarget)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDate('from', e.currentTarget) } }}
              className="w-auto"
            />
            <label className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>To</label>
            <Input
              type="date"
              value={toDraft}
              min={MIN_DATE}
              max={MAX_DATE}
              onChange={(e) => setToDraft(e.target.value)}
              onBlur={(e) => commitDate('to', e.currentTarget)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDate('to', e.currentTarget) } }}
              className="w-auto"
            />
            {!isDefaultFY && (
              <button
                onClick={resetToFY}
                className="text-xs px-2 py-1.5 rounded-lg border hover:bg-slate-50"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
                title="Reset to the current financial year"
              >
                This FY
              </button>
            )}
          </div>
          <div
            className="mono uppercase pb-1.5"
            style={{
              fontSize: 10,
              color: 'var(--ink-3)',
              letterSpacing: '0.12em',
              fontWeight: 600,
            }}
          >
            {loading ? 'Loading…' : `Live · ${monthly.length} mo of data`}
          </div>
        </div>
      </div>

      {/* KPI grid. The skeleton replaces the CARDS only — it used to replace
          the whole page, toolbar included, so every keystroke in a date field
          unmounted the field being typed into. */}
      {loading ? (
        <div className={KPI_GRID}>
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
      <div className={KPI_GRID}>
        <KpiCard
          title="Revenue"
          value={formatCurrency(data.total_revenue)}
          subtitle={isDefaultFY ? 'FY-to-date' : 'Selected period'}
          icon={TrendingUp}
          color="var(--success)"
          bgColor="rgba(31,138,76,0.10)"
          trend={
            hasTrend
              ? { direction: revTrend > 0 ? 'up' : revTrend < 0 ? 'down' : 'flat', value: revTrend, isPositiveGood: true }
              : undefined
          }
          sparklineData={hasTrend ? revenueSeries : undefined}
          onClick={() => navigate('/reports/profit-loss')}
        />
        <KpiCard
          title="Expenses"
          value={formatCurrency(data.total_expenses)}
          subtitle={isDefaultFY ? 'FY-to-date' : 'Selected period'}
          icon={TrendingDown}
          color="var(--danger)"
          bgColor="rgba(192,57,43,0.10)"
          trend={
            hasTrend
              ? { direction: expTrend > 0 ? 'up' : expTrend < 0 ? 'down' : 'flat', value: expTrend, isPositiveGood: false }
              : undefined
          }
          sparklineData={hasTrend ? expenseSeries : undefined}
          onClick={() => navigate('/reports/profit-loss')}
        />
        <KpiCard
          title="Net profit"
          value={formatCurrency(data.net_profit)}
          subtitle={netProfit >= 0 ? 'Surplus' : 'Deficit'}
          icon={Wallet}
          color={netProfit >= 0 ? 'var(--brand)' : 'var(--danger)'}
          bgColor={netProfit >= 0 ? 'rgba(15,157,154,0.10)' : 'rgba(192,57,43,0.10)'}
          trend={
            hasTrend
              ? { direction: profitTrend > 0 ? 'up' : profitTrend < 0 ? 'down' : 'flat', value: profitTrend, isPositiveGood: true }
              : undefined
          }
          sparklineData={hasTrend ? profitSeries : undefined}
          onClick={() => navigate('/reports/profit-loss')}
        />
        <KpiCard
          title="Receivables"
          value={formatCurrency(receivables)}
          subtitle={`Outstanding as of ${balancesLabel}`}
          icon={Users}
          color="var(--info)"
          bgColor="rgba(37,99,235,0.10)"
          onClick={() => navigate('/receivables')}
        />
        <KpiCard
          title="Payables"
          value={formatCurrency(payables)}
          subtitle={`Owed as of ${balancesLabel}`}
          icon={Building}
          color="var(--warning)"
          bgColor="rgba(199,122,17,0.10)"
          onClick={() => navigate('/payables')}
        />
        <KpiCard
          title="GST payable"
          value={formatCurrency(gstPayable)}
          subtitle="Net liability"
          icon={Receipt}
          color="#7c3aed"
          bgColor="rgba(124,58,237,0.10)"
          onClick={() => navigate('/gst/gstr3b')}
        />
        {/* Cash, bank and total assets are as-of balances like Receivables/
            Payables, not period flows — they do not move with the From/To
            window except through its end date. A negative cash or bank figure
            is real (an overdraft, or a cash ledger posted below zero), so it
            turns red rather than being clamped away. */}
        <KpiCard
          title="Cash balance"
          value={formatCurrency(cash)}
          subtitle={`${cash < 0 ? 'Overdrawn' : 'In hand'} as of ${balancesLabel}`}
          icon={Banknote}
          color={cash < 0 ? 'var(--danger)' : 'var(--success)'}
          bgColor={cash < 0 ? 'rgba(192,57,43,0.10)' : 'rgba(31,138,76,0.10)'}
          onClick={() => navigate('/reports/cash-book')}
        />
        <KpiCard
          title="Bank balance"
          value={formatCurrency(bank)}
          subtitle={`${bank < 0 ? 'Overdrawn' : 'Available'} as of ${balancesLabel}`}
          icon={Landmark}
          color={bank < 0 ? 'var(--danger)' : 'var(--info)'}
          bgColor={bank < 0 ? 'rgba(192,57,43,0.10)' : 'rgba(37,99,235,0.10)'}
          onClick={() => navigate('/reports/bank-book')}
        />
        <KpiCard
          title="Total assets"
          value={formatCurrency(totalAssets)}
          subtitle={`Book value as of ${balancesLabel}`}
          icon={Scale}
          color="var(--brand)"
          bgColor="rgba(15,157,154,0.10)"
          onClick={() => navigate('/reports/balance-sheet')}
        />
      </div>
      )}

      {/* Chart + attention queue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl p-4 sm:p-5 card-shadow">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 style={{ color: 'var(--ink)' }}>Monthly revenue vs expenses</h3>
            {/* The caption used to read "Trailing N mo" off the bar count, which
                claims the chart spans the range even when the server capped the
                buckets — say which of how many are actually plotted instead. */}
            <span
              className="mono uppercase"
              style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.1em' }}
            >
              {data.monthly_truncated
                ? `${monthly.length} of ${data.monthly_months_total ?? monthly.length} mo`
                : `Trailing ${monthly.length} mo`}
              {partialMonths > 0 && ` · ${partialMonths} partial`}
            </span>
          </div>
          {loading ? (
            <SkeletonTable rows={6} cols={4} />
          ) : !hasMonthly ? (
            <EmptyState variant="no-data" title="No monthly data yet" description="Post journal entries to see monthly revenue and expense trends." />
          ) : (
            <div className="h-[220px] sm:h-[300px]">
              {/* ResponsiveContainer only tracks width, so the chart height comes
                  from this wrapper — 300px crowds out everything else on a phone. */}
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 0, right: 0, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: 'var(--ink-2)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--ink-2)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), '']}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid var(--line)',
                      background: 'var(--surface-0)',
                      fontSize: '12px',
                      color: 'var(--ink)',
                    }}
                    cursor={{ fill: 'rgba(15,157,154,0.06)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', color: 'var(--ink-2)' }} />
                  <Bar dataKey="revenue" name="Revenue" fill="var(--brand)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="var(--danger)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Skeletoned while loading rather than left showing the previous
            range's items — "All caught up" for an unfetched range is a lie. */}
        {loading ? (
          <SkeletonCard />
        ) : (
          <AttentionQueue
            receivables={receivables}
            payables={payables}
            gstPayable={gstPayable}
            onViewReceivables={() => navigate('/receivables')}
            onViewPayables={() => navigate('/payables')}
            onViewGst={() => navigate('/gst/gstr3b')}
          />
        )}
      </div>
    </div>
  )
}

interface AttentionQueueProps {
  receivables: number
  payables: number
  gstPayable: number
  onViewReceivables: () => void
  onViewPayables: () => void
  onViewGst: () => void
}

function AttentionQueue({
  receivables,
  payables,
  gstPayable,
  onViewReceivables,
  onViewPayables,
  onViewGst,
}: AttentionQueueProps) {
  const items: Array<{ key: string; label: string; amount: number; tone: 'warning' | 'danger' | 'info'; onClick: () => void }> = []
  if (receivables > 0) items.push({ key: 'rec', label: 'Receivables outstanding', amount: receivables, tone: 'warning', onClick: onViewReceivables })
  if (payables > 0) items.push({ key: 'pay', label: 'Payables due', amount: payables, tone: 'info', onClick: onViewPayables })
  if (gstPayable > 0) items.push({ key: 'gst', label: 'GST payable this period', amount: gstPayable, tone: 'danger', onClick: onViewGst })

  return (
    <div className="rounded-xl p-4 sm:p-5 card-shadow">
      <div className="flex items-baseline justify-between gap-2 mb-4">
        <h3 style={{ color: 'var(--ink)' }}>Attention queue</h3>
        <AlertTriangle className="w-4 h-4" style={{ color: 'var(--warning)' }} />
      </div>
      {items.length === 0 ? (
        <EmptyState
          variant="no-notifications"
          title="All caught up"
          description="No outstanding items right now."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const toneFg =
              it.tone === 'danger' ? 'var(--danger)' : it.tone === 'warning' ? 'var(--warning)' : 'var(--info)'
            return (
              <li key={it.key}>
                <button
                  onClick={it.onClick}
                  className="w-full attention-row rounded-md p-3 flex items-center justify-between gap-3 hover:translate-x-0.5 transition-transform"
                  style={{ background: 'var(--surface-1)' }}
                >
                  <div className="text-left min-w-0">
                    <div className="text-xs mono uppercase" style={{ color: toneFg, letterSpacing: '0.08em' }}>
                      {it.tone === 'danger' ? 'Tax' : it.tone === 'warning' ? 'AR' : 'AP'}
                    </div>
                    <div className="text-sm mt-0.5" style={{ color: 'var(--ink)' }}>
                      {it.label}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="mono kpi-value text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(it.amount)}
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5" style={{ color: 'var(--ink-3)' }} />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

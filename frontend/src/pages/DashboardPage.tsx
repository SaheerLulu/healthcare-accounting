import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  ArrowUpRight,
  AlertTriangle,
} from 'lucide-react'
import { getDashboard, type DashboardData } from '../lib/api'
import { formatCurrency } from '../lib/utils'
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
  monthly_data: [],
}

function pctDelta(series: number[]): number {
  if (series.length < 2) return 0
  const last = series[series.length - 1]
  const prev = series[series.length - 2]
  if (!prev) return 0
  return ((last - prev) / Math.abs(prev)) * 100
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const { activeLocationId } = useAppLocation()

  useEffect(() => {
    setLoading(true)
    getDashboard()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [activeLocationId])

  const monthly = data.monthly_data ?? []

  const revenueSeries = useMemo(() => monthly.map((m) => Number(m.revenue) || 0), [monthly])
  const expenseSeries = useMemo(() => monthly.map((m) => Number(m.expenses) || 0), [monthly])
  const profitSeries = useMemo(
    () => monthly.map((m) => (Number(m.revenue) || 0) - (Number(m.expenses) || 0)),
    [monthly]
  )

  const revTrend = pctDelta(revenueSeries)
  const expTrend = pctDelta(expenseSeries)
  const profitTrend = pctDelta(profitSeries)

  const netProfit = Number(data.net_profit) || 0
  const receivables = Number(data.total_receivables) || 0
  const payables = Number(data.total_payables) || 0
  const gstPayable = Number(data.gst_payable) || 0
  const hasMonthly = monthly.length > 0

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="space-y-1.5">
          <div className="h-7 w-48 rounded animate-shimmer" />
          <div className="h-4 w-72 rounded animate-shimmer" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <SkeletonTable rows={6} cols={4} />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Dashboard</h1>
          <p className="mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Current financial year — at a glance
          </p>
        </div>
        <div
          className="mono uppercase"
          style={{
            fontSize: 10,
            color: 'var(--ink-3)',
            letterSpacing: '0.12em',
            fontWeight: 600,
          }}
        >
          Live · {monthly.length} mo of data
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          title="Revenue"
          value={formatCurrency(data.total_revenue)}
          subtitle="FY-to-date"
          icon={TrendingUp}
          color="var(--success)"
          bgColor="rgba(31,138,76,0.10)"
          trend={
            hasMonthly
              ? { direction: revTrend > 0 ? 'up' : revTrend < 0 ? 'down' : 'flat', value: revTrend, isPositiveGood: true }
              : undefined
          }
          sparklineData={hasMonthly ? revenueSeries : undefined}
        />
        <KpiCard
          title="Expenses"
          value={formatCurrency(data.total_expenses)}
          subtitle="FY-to-date"
          icon={TrendingDown}
          color="var(--danger)"
          bgColor="rgba(192,57,43,0.10)"
          trend={
            hasMonthly
              ? { direction: expTrend > 0 ? 'up' : expTrend < 0 ? 'down' : 'flat', value: expTrend, isPositiveGood: false }
              : undefined
          }
          sparklineData={hasMonthly ? expenseSeries : undefined}
        />
        <KpiCard
          title="Net profit"
          value={formatCurrency(data.net_profit)}
          subtitle={netProfit >= 0 ? 'Surplus' : 'Deficit'}
          icon={Wallet}
          color={netProfit >= 0 ? 'var(--brand)' : 'var(--danger)'}
          bgColor={netProfit >= 0 ? 'rgba(15,157,154,0.10)' : 'rgba(192,57,43,0.10)'}
          trend={
            hasMonthly
              ? { direction: profitTrend > 0 ? 'up' : profitTrend < 0 ? 'down' : 'flat', value: profitTrend, isPositiveGood: true }
              : undefined
          }
          sparklineData={hasMonthly ? profitSeries : undefined}
        />
        <KpiCard
          title="Receivables"
          value={formatCurrency(receivables)}
          subtitle="Outstanding from customers"
          icon={Users}
          color="var(--info)"
          bgColor="rgba(37,99,235,0.10)"
          onClick={() => navigate('/receivables')}
        />
        <KpiCard
          title="Payables"
          value={formatCurrency(payables)}
          subtitle="Owed to suppliers"
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
      </div>

      {/* Chart + attention queue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl p-5 card-shadow">
          <div className="flex items-baseline justify-between mb-4">
            <h3 style={{ color: 'var(--ink)' }}>Monthly revenue vs expenses</h3>
            <span
              className="mono uppercase"
              style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.1em' }}
            >
              Trailing {monthly.length} mo
            </span>
          </div>
          {!hasMonthly ? (
            <EmptyState variant="no-data" title="No monthly data yet" description="Post journal entries to see monthly revenue and expense trends." />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
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
          )}
        </div>

        <AttentionQueue
          receivables={receivables}
          payables={payables}
          gstPayable={gstPayable}
          onViewReceivables={() => navigate('/receivables')}
          onViewPayables={() => navigate('/payables')}
          onViewGst={() => navigate('/gst/gstr3b')}
        />
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
    <div className="rounded-xl p-5 card-shadow">
      <div className="flex items-baseline justify-between mb-4">
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
                  className="w-full attention-row rounded-md p-3 flex items-center justify-between hover:translate-x-0.5 transition-transform"
                  style={{ background: 'var(--surface-1)' }}
                >
                  <div className="text-left">
                    <div className="text-xs mono uppercase" style={{ color: toneFg, letterSpacing: '0.08em' }}>
                      {it.tone === 'danger' ? 'Tax' : it.tone === 'warning' ? 'AR' : 'AP'}
                    </div>
                    <div className="text-sm mt-0.5" style={{ color: 'var(--ink)' }}>
                      {it.label}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
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

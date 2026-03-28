import { useEffect, useState } from 'react'
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
  DollarSign,
  Users,
  Building,
  Receipt,
  Loader2,
} from 'lucide-react'
import { getDashboard, type DashboardData } from '../lib/api'
import { formatCurrency } from '../lib/utils'
import { Card, CardContent } from '../components/ui/card'

interface KPICardProps {
  title: string
  value: string
  icon: React.ReactNode
  color: string
  bg: string
}

function KPICard({ title, value, icon, color, bg }: KPICardProps) {
  return (
    <Card className="flex items-center gap-4">
      <CardContent className="flex items-center gap-4 w-full">
        <div className={`w-11 h-11 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
          <span className={color}>{icon}</span>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{title}</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

const EMPTY: DashboardData = {
  total_revenue: 0,
  total_expenses: 0,
  net_profit: 0,
  total_receivables: 0,
  total_payables: 0,
  gst_payable: 0,
  monthly_data: [],
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const netProfit = Number(data.net_profit)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={32} className="animate-spin text-teal-600" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Current Financial Year Overview</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        <KPICard
          title="Total Revenue"
          value={formatCurrency(data.total_revenue)}
          icon={<TrendingUp size={20} />}
          color="text-emerald-600"
          bg="bg-emerald-50"
        />
        <KPICard
          title="Total Expenses"
          value={formatCurrency(data.total_expenses)}
          icon={<TrendingDown size={20} />}
          color="text-red-600"
          bg="bg-red-50"
        />
        <KPICard
          title="Net Profit"
          value={formatCurrency(data.net_profit)}
          icon={<DollarSign size={20} />}
          color={netProfit >= 0 ? 'text-teal-600' : 'text-red-600'}
          bg={netProfit >= 0 ? 'bg-teal-50' : 'bg-red-50'}
        />
        <KPICard
          title="Total Receivables"
          value={formatCurrency(data.total_receivables)}
          icon={<Users size={20} />}
          color="text-blue-600"
          bg="bg-blue-50"
        />
        <KPICard
          title="Total Payables"
          value={formatCurrency(data.total_payables)}
          icon={<Building size={20} />}
          color="text-amber-600"
          bg="bg-amber-50"
        />
        <KPICard
          title="GST Payable"
          value={formatCurrency(data.gst_payable)}
          icon={<Receipt size={20} />}
          color="text-purple-600"
          bg="bg-purple-50"
        />
      </div>

      {/* Chart */}
      <Card>
        <CardContent>
          <h2 className="text-sm font-semibold text-slate-900 mb-4">
            Monthly Revenue vs Expenses
          </h2>
          {(data.monthly_data ?? []).length === 0 ? (
            <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
              No monthly data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.monthly_data ?? []} margin={{ top: 0, right: 0, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), '']}
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="revenue" name="Revenue" fill="#0F9D9A" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

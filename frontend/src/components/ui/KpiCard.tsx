import type { LucideIcon } from 'lucide-react'
import { MiniSparkline } from './MiniSparkline'
import { TrendBadge } from './TrendBadge'

interface TrendData {
  direction: 'up' | 'down' | 'flat'
  value: number
  isPositiveGood?: boolean
}

interface Thresholds {
  warning?: number
  danger?: number
  direction?: 'above' | 'below'
}

interface Props {
  title: string
  value: string
  subtitle?: string
  icon: LucideIcon
  color: string
  bgColor: string
  trend?: TrendData
  sparklineData?: number[]
  thresholds?: Thresholds
  numericValue?: number
  isActive?: boolean
  onClick?: () => void
}

type ThresholdLevel = 'ok' | 'warning' | 'danger'

function getThresholdLevel(numericValue: number | undefined, thresholds: Thresholds | undefined): ThresholdLevel | null {
  if (numericValue == null || !thresholds) return null
  const { warning, danger, direction = 'above' } = thresholds
  const check = direction === 'above'
    ? (v: number, t: number) => v >= t
    : (v: number, t: number) => v <= t
  if (danger != null && check(numericValue, danger)) return 'danger'
  if (warning != null && check(numericValue, warning)) return 'warning'
  return 'ok'
}

const LEVEL_COLORS: Record<ThresholdLevel, { fg: string; bg: string; border: string }> = {
  danger: { fg: 'var(--danger)', bg: 'rgba(192,57,43,0.12)', border: 'var(--danger)' },
  warning: { fg: 'var(--warning)', bg: 'rgba(199,122,17,0.12)', border: 'var(--warning)' },
  ok: { fg: 'var(--success)', bg: 'rgba(31,138,76,0.10)', border: 'var(--success)' },
}

export function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  bgColor,
  trend,
  sparklineData,
  thresholds,
  numericValue,
  isActive,
  onClick,
}: Props) {
  const level = getThresholdLevel(numericValue, thresholds)
  const active = level && level !== 'ok' ? LEVEL_COLORS[level] : null
  const iconBg = active ? active.bg : bgColor
  const iconFg = active ? active.fg : color
  const labelColor = active ? active.fg : undefined

  return (
    <div
      onClick={onClick}
      className={`rounded-xl p-4 card-shadow transition-all ${
        onClick ? 'cursor-pointer card-hover' : ''
      } ${isActive ? 'ring-2' : ''}`}
      style={{
        backgroundColor: 'var(--surface-0)',
        ...(active ? { borderLeft: `3px solid ${active.border}` } : {}),
        ...(isActive ? { boxShadow: 'inset 0 0 0 2px var(--brand)' } : {}),
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: iconBg }}
            >
              <Icon className="w-4 h-4" style={{ color: iconFg }} />
            </div>
            <p
              className="text-[10px] font-medium uppercase tracking-wide truncate"
              style={{ color: labelColor || 'var(--ink-3)', fontWeight: active ? 600 : 500, letterSpacing: '0.06em' }}
            >
              {title}
            </p>
          </div>
          <p className="text-xl font-bold kpi-value mono" style={{ color: 'var(--ink)' }}>
            {value}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {subtitle && (
              <p className="text-[10px]" style={{ color: 'var(--ink-2)' }}>
                {subtitle}
              </p>
            )}
            {trend && trend.direction !== 'flat' && (
              <TrendBadge value={trend.value} isPositiveGood={trend.isPositiveGood} />
            )}
          </div>
        </div>
        {sparklineData && sparklineData.length >= 2 && (
          <MiniSparkline data={sparklineData} color={iconFg} width={56} height={28} />
        )}
      </div>
    </div>
  )
}

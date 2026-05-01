import type { ReactNode } from 'react'
import { CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react'

type Tone = 'success' | 'warning' | 'danger' | 'info'

interface Props {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  className?: string
  action?: ReactNode
}

const TONE_STYLE: Record<Tone, { fg: string; bg: string; border: string; icon: typeof CheckCircle2 }> = {
  success: { fg: 'var(--success)', bg: 'rgba(31,138,76,0.08)', border: 'rgba(31,138,76,0.30)', icon: CheckCircle2 },
  warning: { fg: 'var(--warning)', bg: 'rgba(199,122,17,0.08)', border: 'rgba(199,122,17,0.30)', icon: AlertTriangle },
  danger: { fg: 'var(--danger)', bg: 'rgba(192,57,43,0.07)', border: 'rgba(192,57,43,0.25)', icon: AlertCircle },
  info: { fg: 'var(--info)', bg: 'rgba(37,99,235,0.07)', border: 'rgba(37,99,235,0.25)', icon: Info },
}

export function AlertBanner({ tone = 'info', title, children, action, className = '' }: Props) {
  const t = TONE_STYLE[tone]
  const Icon = t.icon

  return (
    <div
      className={`px-4 py-3 rounded-md flex items-start gap-3 ${className}`}
      style={{ background: t.bg, border: `1px solid ${t.border}` }}
    >
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: t.fg }} />
      <div className="flex-1 min-w-0 text-sm" style={{ color: t.fg }}>
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? 'mt-0.5' : ''} style={{ color: tone === 'info' ? 'var(--ink-2)' : t.fg, opacity: 0.9 }}>{children}</div>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}
